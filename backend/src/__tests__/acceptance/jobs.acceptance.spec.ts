import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { JobListing } from '../../models';
import { JobListingRepository } from '../../repositories';
import { HIGH_MATCH_HANDLER, HighMatchHandler } from '../../services/jobs/job-match.service';
import { JobDiscoveryService } from '../../services/jobs/job-discovery.service';
import { LlmRequest } from '../../services/llm/llm.types';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeConnector, givenJob, useFakeConnectors } from '../helpers/fake-connector';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { SAMPLE_PARSE_REPLY, SAMPLE_RESUME_TEXT } from '../helpers/fixtures';
import { drainQueues, setupApplication } from '../helpers/test-app';

class RecordingHighMatch implements HighMatchHandler {
  calls: Array<{ userId: string; titles: string[] }> = [];
  async onHighMatch(userId: string, listings: JobListing[]): Promise<void> {
    this.calls.push({ userId, titles: listings.map(listing => listing.title) });
  }
}

/** Scores jobs by position: first gets 90, second 60, … */
function scoringReply(request: LlmRequest): string {
  if (request.task === 'RESUME_PARSE') return SAMPLE_PARSE_REPLY;
  const ids = [...request.messages[0].content.matchAll(/### Job (\d+)/g)].map(match => match[1]);
  return JSON.stringify({ results: ids.map((id, i) => ({ id, score: 90 - i * 30, reason: `reason ${id}`, matchedSkills: ['Node.js'], missingSkills: [] })) });
}

describe('Job discovery and matching (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let jsearch: FakeConnector;
  let adzuna: FakeConnector;
  let linkedin: FakeConnector;
  const highMatch = new RecordingHighMatch();

  before(async () => {
    ({ app, client } = await setupApplication(application => application.bind(HIGH_MATCH_HANDLER).to(highMatch)));
    await useFakeLlm(app, new FakeLlmProvider('groq', [scoringReply]));
  });

  beforeEach(async () => {
    highMatch.calls = [];
    jsearch = new FakeConnector('jsearch', [
      givenJob({ title: 'Senior Backend Engineer', company: 'Globex Pvt Ltd' }),
      givenJob({ title: 'Platform Engineer', company: 'Initech', description: 'Node.js, TypeScript, Redis, AWS, Docker' }),
      givenJob({ title: 'Pastry Chef', company: 'Bakery', description: 'Croissants and baguettes.' }),
    ]);
    adzuna = new FakeConnector('adzuna', [givenJob({ title: 'Sr. Backend Engineer', company: 'Globex', location: 'Chennai', applyOptions: [{ publisher: 'Adzuna', url: 'https://adzuna.test/9' }] })]);
    linkedin = new FakeConnector('apify-linkedin', [givenJob({ title: 'Linkedin Only Role', company: 'Hooli' })], false);
    await useFakeConnectors(app, jsearch, adzuna, linkedin);

    user = await givenUser(client);
    await client.post('/api/resumes').set(user.auth).attach('file', Buffer.from(SAMPLE_RESUME_TEXT), 'p.txt').expect(200);
    await drainQueues(app);
  });

  after(async () => {
    await app.stop();
  });

  async function runDiscovery() {
    const discovery = await app.get<JobDiscoveryService>('services.JobDiscoveryService');
    const summary = await discovery.discover({ userId: user.id });
    await drainQueues(app);
    return summary;
  }

  it('lists sources with unofficial scrapers disabled by default', async () => {
    const sources = (await client.get('/api/job-sources').set(user.auth).expect(200)).body.data;
    expect(sources.map((s: { key: string; enabled: boolean; configured: boolean }) => [s.key, s.enabled, s.configured])).to.eql([
      ['jsearch', true, true],
      ['adzuna', true, true],
      ['apify-linkedin', false, true],
    ]);
  });

  it('searches with profile titles and location, merges duplicates across sources, pre-filters and scores', async () => {
    const summary = await runDiscovery();
    expect(jsearch.queries.map(q => [q.title, q.location])).to.eql([
      ['Senior Software Engineer', 'Chennai, India'],
      ['Software Engineer', 'Chennai, India'],
    ]);
    expect(linkedin.queries).to.have.length(0);
    expect(summary).to.containDeep({ found: 3, created: 3, queuedForScoring: 2, filteredOut: 1 });

    const all = await (await app.getRepository(JobListingRepository)).find({ where: { userId: user.id } });
    const globex = all.find(listing => listing.company.startsWith('Globex'))!;
    expect(globex.seenOn.sort()).to.eql(['adzuna', 'jsearch']);
    expect(globex.applyOptions.map(option => option.publisher).sort()).to.eql(['Adzuna', 'LinkedIn']);
    expect(all.find(listing => listing.title === 'Pastry Chef')!.matchStatus).to.equal('FILTERED_OUT');

    const listed = (await client.get('/api/jobs').set(user.auth).expect(200)).body.data;
    expect(listed.total).to.equal(2);
    expect(listed.items[0]).to.containDeep({ matchStatus: 'SCORED', matchScore: 90, matchReason: 'reason 1' });
    expect(listed.items[0]).to.not.have.property('description');
    expect(highMatch.calls).to.eql([{ userId: user.id, titles: [listed.items[0].title] }]);
  });

  it('does not create duplicates on a second run', async () => {
    await runDiscovery();
    const second = await runDiscovery();
    expect(second.created).to.equal(0);
    expect((await client.get('/api/jobs?includeFiltered=true').set(user.auth)).body.data.total).to.equal(3);
  });

  it('records a failing source without failing discovery', async () => {
    adzuna.failWith = new Error('adzuna responded 503');
    const summary = await runDiscovery();
    expect(summary.errors).to.eql([
      { source: 'adzuna', message: 'adzuna responded 503' },
      { source: 'adzuna', message: 'adzuna responded 503' },
    ]);
    const sources = (await client.get('/api/job-sources').set(user.auth)).body.data;
    expect(sources.find((s: { key: string }) => s.key === 'adzuna').lastError).to.equal('adzuna responded 503');
  });

  it('enables an unofficial source on request', async () => {
    await client.put('/api/job-sources/apify-linkedin').set(user.auth).send({ enabled: true }).expect(200);
    await runDiscovery();
    expect(linkedin.queries.length).to.be.greaterThan(0);
    await client.put('/api/job-sources/monster').set(user.auth).send({ enabled: true }).expect(404);
  });

  it('updates status, filters by it and rescoring requeues', async () => {
    await runDiscovery();
    const [top] = (await client.get('/api/jobs').set(user.auth)).body.data.items;
    await client.patch(`/api/jobs/${top.id}/status`).set(user.auth).send({ status: 'SHORTLISTED' }).expect(200);
    const shortlisted = (await client.get('/api/jobs?status=SHORTLISTED').set(user.auth)).body.data;
    expect(shortlisted.items.map((j: { id: string }) => j.id)).to.eql([top.id]);
    await client.patch(`/api/jobs/${top.id}/status`).set(user.auth).send({ status: 'APPLIED' }).expect(422);

    const rescored = await client.post(`/api/jobs/${top.id}/rescore`).set(user.auth).expect(200);
    expect(rescored.body.data.matchStatus).to.equal('PENDING');
    await drainQueues(app);
    expect((await client.get(`/api/jobs/${top.id}`).set(user.auth)).body.data.matchStatus).to.equal('SCORED');
  });

  it('guards the manual trigger', async () => {
    const stranger = await givenUser(client);
    const incomplete = await client.post('/api/jobs/discover').set(stranger.auth).expect(400);
    expect(incomplete.body.error.code).to.equal('PROFILE_INCOMPLETE');

    await client.post('/api/jobs/discover').set(user.auth).expect(200);
    await drainQueues(app);
    const tooSoon = await client.post('/api/jobs/discover').set(user.auth).expect(429);
    expect(tooSoon.body.error.code).to.equal('DISCOVERY_TOO_SOON');
  });

  it('queues scheduled runs only for users that are due', async () => {
    const discovery = await app.get<JobDiscoveryService>('services.JobDiscoveryService');
    await runDiscovery();
    expect(await discovery.enqueueDueUsers(new Date())).to.not.containEql(user.id);
    await drainQueues(app);
    const sevenHoursLater = new Date(Date.now() + 7 * 3_600_000);
    expect(await discovery.enqueueDueUsers(sevenHoursLater)).to.containEql(user.id);
    await drainQueues(app);
    const noTitles = await givenUser(client);
    expect(await discovery.enqueueDueUsers(sevenHoursLater)).to.not.containEql(noTitles.id);
  });

  it('hides other users’ jobs', async () => {
    await runDiscovery();
    const [top] = (await client.get('/api/jobs').set(user.auth)).body.data.items;
    const stranger = await givenUser(client);
    const response = await client.get(`/api/jobs/${top.id}`).set(stranger.auth).expect(404);
    expect(response.body.error.code).to.equal('JOB_NOT_FOUND');
  });
});
