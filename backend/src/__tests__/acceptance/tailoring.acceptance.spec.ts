import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { AuditLogRepository, JdKeywordCacheRepository } from '../../repositories';
import { JobDiscoveryService } from '../../services/jobs/job-discovery.service';
import { ApplicationService } from '../../services/tailoring/application.service';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeConnector, givenJob, useFakeConnectors } from '../helpers/fake-connector';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { faithfulTailoring, givenListing, givenParsedResume, LlmScript } from '../helpers/tailoring.helper';
import { drainQueues, setupApplication } from '../helpers/test-app';

describe('Tailoring, review and approval (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let script: LlmScript;
  let groq: FakeLlmProvider;

  before(async () => {
    ({ app, client } = await setupApplication());
  });

  beforeEach(async () => {
    script = new LlmScript();
    groq = new FakeLlmProvider('groq', [script.reply]);
    await useFakeLlm(app, groq);
    user = await givenUser(client);
    await givenParsedResume(app, client, user);
  });

  after(async () => {
    await app.stop();
  });

  async function tailor(listingId: string, body: object = {}) {
    const response = await client.post(`/api/jobs/${listingId}/tailor`).set(user.auth).send(body).expect(200);
    expect(response.body.data.status).to.equal('TAILORING');
    await drainQueues(app);
    return response.body.data.id as string;
  }

  it('drafts a tailored resume for review, then approves it', async () => {
    const listing = await givenListing(app, user.id);
    const applicationId = await tailor(listing.id!);

    const review = (await client.get(`/api/applications/${applicationId}`).set(user.auth).expect(200)).body.data;
    expect(review.application.status).to.equal('REVIEW_PENDING');
    expect(review.listing.description).to.match(/Kafka/);
    expect(review.master.document.contact.name).to.equal('Priya Raman');
    expect(review.variant).to.containDeep({
      status: 'DRAFT',
      generation: 1,
      templateId: 'classic',
      factCheck: { passed: true, violations: [] },
      keywordCoverage: { keywords: ['Node.js', 'Kafka', 'Kubernetes', 'Redis'], before: 75, after: 75, missing: ['Kubernetes'] },
      generatedBy: { provider: 'groq', model: 'groq-large' },
    });
    expect(review.variant.changes.map((c: { path: string }) => c.path)).to.eql(['summary', 'skills', 'experience[0].bullets']);
    expect(review.variant.changes[0].reason).to.equal('Targets the payments backend role');
    expect(review.variant).to.not.have.property('pdfKey');

    const pdf = await client.get(`/api/applications/${applicationId}/resume.pdf`).set(user.auth).expect(200);
    expect(pdf.headers['content-type']).to.equal('application/pdf');

    const approved = (await client.post(`/api/applications/${applicationId}/approve`).set(user.auth).expect(200)).body.data;
    expect(approved).to.containDeep({ status: 'APPROVED', approvedCoverNote: faithfulTailoring().coverNote });
    expect(approved).to.not.have.property('approvedPdfKey');

    const materials = await (await app.get<ApplicationService>('services.ApplicationService')).approvedMaterials(user.id, applicationId);
    expect(materials.pdf.subarray(0, 5).toString()).to.equal('%PDF-');
    expect(materials.fileName).to.match(/^resume-Globex-.*-Senior-Backend-Engineer\.pdf$/);

    const second = await client.post(`/api/applications/${applicationId}/approve`).set(user.auth).expect(400);
    expect(second.body.error.code).to.equal('INVALID_STATUS_TRANSITION');

    const actions = (await (await app.getRepository(AuditLogRepository)).find({ where: { userId: user.id } })).map(a => a.action);
    expect(actions).to.containEql('RESUME_VARIANT_GENERATED');
    expect(actions).to.containEql('RESUME_VARIANT_APPROVED');
  });

  it('caches job keywords by fingerprint across users', async () => {
    const listing = await givenListing(app, user.id, { company: 'SharedCo' });
    await tailor(listing.id!);
    const other = await givenUser(client);
    await givenParsedResume(app, client, other);
    const otherListing = await givenListing(app, other.id, { company: 'SharedCo' });
    groq.calls.length = 0;
    await client.post(`/api/jobs/${otherListing.id}/tailor`).set(other.auth).expect(200);
    await drainQueues(app);
    expect(groq.calls.map(call => call.request.task)).to.eql(['RESUME_TAILOR']);
    expect(await (await app.getRepository(JdKeywordCacheRepository)).count({ fingerprint: listing.fingerprint })).to.eql({ count: 1 });
  });

  it('blocks approval while the fact-check fails, then allows it after the user fixes the draft', async () => {
    const invented = faithfulTailoring();
    invented.document.experience.push({ company: 'Google', title: 'Staff Engineer', startDate: '2015-01', endDate: '2018-01', bullets: ['Scaled search by 300%'], location: undefined });
    script.tailorReply = JSON.stringify(invented);
    const applicationId = await tailor((await givenListing(app, user.id)).id!);

    const review = (await client.get(`/api/applications/${applicationId}`).set(user.auth)).body.data;
    expect(review.variant.factCheck.passed).to.be.false();
    expect(review.variant.factCheck.violations.map((v: { kind: string }) => v.kind).sort()).to.eql(['new_number', 'unknown_role']);

    const blocked = await client.post(`/api/applications/${applicationId}/approve`).set(user.auth).expect(400);
    expect(blocked.body.error.code).to.equal('RESUME_TAILOR_FACT_VIOLATION');
    expect(blocked.body.error.details).to.have.length(2);

    const fixed = review.variant.document;
    fixed.experience = fixed.experience.filter((role: { company: string }) => role.company !== 'Google');
    const edited = (await client.put(`/api/applications/${applicationId}/variant`).set(user.auth).send({ document: fixed, coverNote: 'Edited note' }).expect(200)).body.data;
    expect(edited.variant).to.containDeep({ userEdited: true, coverNote: 'Edited note', factCheck: { passed: true } });

    const approved = await client.post(`/api/applications/${applicationId}/approve`).set(user.auth).expect(200);
    expect(approved.body.data.approvedCoverNote).to.equal('Edited note');
  });

  it('rejects, regenerates with instructions and supersedes the old draft', async () => {
    const applicationId = await tailor((await givenListing(app, user.id)).id!);
    await client.post(`/api/applications/${applicationId}/reject`).set(user.auth).send({ reason: 'Too generic' }).expect(200);
    await client.post(`/api/applications/${applicationId}/regenerate`).set(user.auth).send({ instructions: 'Emphasise payments' }).expect(200);
    await drainQueues(app);

    expect(groq.calls.at(-1)!.request.messages[0].content).to.match(/Emphasise payments/);
    const review = (await client.get(`/api/applications/${applicationId}`).set(user.auth)).body.data;
    expect(review.variant).to.containDeep({ generation: 2, status: 'DRAFT', instructions: 'Emphasise payments' });
    expect(review.application.history.map((h: { to: string }) => h.to)).to.eql(['TAILORING', 'REVIEW_PENDING', 'REJECTED', 'TAILORING', 'REVIEW_PENDING']);
  });

  it('records TAILOR_FAILED with the reason when no model produces a valid draft', async () => {
    script.tailorReply = 'I cannot do that';
    const applicationId = await tailor((await givenListing(app, user.id)).id!);
    const { application } = (await client.get(`/api/applications/${applicationId}`).set(user.auth)).body.data;
    expect(application.status).to.equal('TAILOR_FAILED');
    expect(application.lastError).to.match(/^LLM_UNAVAILABLE/);
    script.tailorReply = JSON.stringify(faithfulTailoring());
    await client.post(`/api/applications/${applicationId}/regenerate`).set(user.auth).expect(200);
    await drainQueues(app);
    expect((await client.get(`/api/applications/${applicationId}`).set(user.auth)).body.data.application.status).to.equal('REVIEW_PENDING');
  });

  it('enforces the daily tailoring cap', async () => {
    await client.put('/api/profile').set(user.auth).send({ dailyCaps: { tailor: 1 } }).expect(200);
    await tailor((await givenListing(app, user.id)).id!);
    const capped = await client.post(`/api/jobs/${(await givenListing(app, user.id)).id}/tailor`).set(user.auth).expect(400);
    expect(capped.body.error.code).to.equal('TAILOR_DAILY_CAP_REACHED');
  });

  it('refuses to hand out materials before approval', async () => {
    const applicationId = await tailor((await givenListing(app, user.id)).id!);
    const service = await app.get<ApplicationService>('services.ApplicationService');
    await expect(service.approvedMaterials(user.id, applicationId)).to.be.rejectedWith(/Approve the tailored resume/);
  });

  it('lets the user mark an approved application as applied manually', async () => {
    const applicationId = await tailor((await givenListing(app, user.id)).id!);
    await client.post(`/api/applications/${applicationId}/mark-applied`).set(user.auth).expect(400);
    await client.post(`/api/applications/${applicationId}/approve`).set(user.auth).expect(200);
    const applied = (await client.post(`/api/applications/${applicationId}/mark-applied`).set(user.auth).expect(200)).body.data;
    expect(applied).to.containDeep({ status: 'APPLIED', method: 'MANUAL' });
    const list = (await client.get('/api/applications?status=APPLIED').set(user.auth)).body.data;
    expect(list.map((a: { id: string }) => a.id)).to.eql([applicationId]);
    expect(list[0]).to.containDeep({ jobTitle: 'Senior Backend Engineer', location: 'Chennai' });
    expect(list[0].company).to.startWith('Globex');
    expect(list[0]).to.not.have.property('approvedPdfKey');
  });

  it('auto-drafts for high-scoring discovered jobs but still waits for review', async () => {
    await useFakeConnectors(app, new FakeConnector('jsearch', [givenJob({ company: 'AutoCo' })]));
    const discovery = await app.get<JobDiscoveryService>('services.JobDiscoveryService');
    await discovery.discover({ userId: user.id });
    await drainQueues(app);
    const [application] = (await client.get('/api/applications').set(user.auth)).body.data;
    expect(application).to.containDeep({ status: 'REVIEW_PENDING', autoTailored: true });
  });

  it('hides other users’ applications', async () => {
    const applicationId = await tailor((await givenListing(app, user.id)).id!);
    const stranger = await givenUser(client);
    const response = await client.get(`/api/applications/${applicationId}`).set(stranger.auth).expect(404);
    expect(response.body.error.code).to.equal('APPLICATION_NOT_FOUND');
    await client.post(`/api/applications/${applicationId}/approve`).set(stranger.auth).expect(404);
  });
});
