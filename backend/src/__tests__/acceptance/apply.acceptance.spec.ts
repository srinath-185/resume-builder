import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { PortalSessionRepository } from '../../repositories';
import { findChrome } from '../../services/apply/browser.service';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeJobSite } from '../helpers/fake-job-site';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { faithfulTailoring, givenListing, givenParsedResume, LlmScript } from '../helpers/tailoring.helper';
import { drainQueues, setupApplication } from '../helpers/test-app';

describe('Assisted apply (acceptance)', function () {
  this.timeout(120_000);
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let site: FakeJobSite;
  let base: string;
  const chrome = findChrome();

  before(async () => {
    site = new FakeJobSite();
    base = await site.start();
    process.env.APPLY_FORM_HOSTS = '127.0.0.1';
    ({ app, client } = await setupApplication());
  });

  beforeEach(async () => {
    const script = new LlmScript();
    await useFakeLlm(app, new FakeLlmProvider('groq', [script.reply]));
    user = await givenUser(client);
    await givenParsedResume(app, client, user);
  });

  after(async () => {
    delete process.env.APPLY_FORM_HOSTS;
    await app.stop();
    await site.stop();
  });

  async function approvedFor(applyUrl: string): Promise<string> {
    const listing = await givenListing(app, user.id, { applyUrl, url: applyUrl });
    const id = (await client.post(`/api/jobs/${listing.id}/tailor`).set(user.auth).expect(200)).body.data.id;
    await drainQueues(app);
    await client.post(`/api/applications/${id}/approve`).set(user.auth).expect(200);
    return id;
  }

  async function applyAndWait(id: string) {
    const started = (await client.post(`/api/applications/${id}/apply`).set(user.auth).expect(200)).body.data;
    expect(started.status).to.equal('APPLYING');
    await drainQueues(app);
    return (await client.get(`/api/applications/${id}`).set(user.auth)).body.data.application;
  }

  it('refuses to apply before approval', async () => {
    const listing = await givenListing(app, user.id);
    const id = (await client.post(`/api/jobs/${listing.id}/tailor`).set(user.auth)).body.data.id;
    await drainQueues(app);
    const response = await client.post(`/api/applications/${id}/apply`).set(user.auth).expect(400);
    expect(response.body.error.code).to.equal('RESUME_VARIANT_NOT_APPROVED');
  });

  it('leaves non-automated sites (e.g. Naukri) to the user', async () => {
    const id = await approvedFor('https://www.naukri.com/job-listings-123');
    const application = await applyAndWait(id);
    expect(application).to.containDeep({ status: 'NEEDS_REVIEW', method: 'MANUAL' });
    expect(application.lastError).to.match(/not automated/);
  });

  (chrome ? it : it.skip)('fills and submits a form with the approved PDF and answers', async () => {
    const id = await approvedFor(`${base}/job/ok`);
    const application = await applyAndWait(id);
    expect(application).to.containDeep({ status: 'APPLIED', method: 'ats-form' });
    expect(application.appliedAt).to.be.a.String();

    const [submission] = site.submissions;
    expect(submission).to.match(/name="first_name"\r\n\r\nPriya\r\n/);
    expect(submission).to.match(/name="last_name"\r\n\r\nRaman\r\n/);
    expect(submission).to.match(/name="email"\r\n\r\npriya\.raman@example\.test\r\n/);
    expect(submission).to.match(/name="resume"; filename="resume-[^"]+\.pdf"\r\nContent-Type: application\/pdf\r\n\r\n%PDF-/);
    expect(submission).to.containEql(faithfulTailoring().coverNote);
    expect(submission).to.containEql('I lead Node.js payment services today.');
    expect(submission).to.not.match(/name="newsletter"/);

    const shot = await client.get(`/api/applications/${id}/screenshot.png`).set(user.auth).expect(200);
    expect(shot.headers['content-type']).to.equal('image/png');
  });

  (chrome ? it : it.skip)('stops for review when a required question has no approved answer', async () => {
    const before = site.submissions.length;
    const id = await approvedFor(`${base}/apply/salary`);
    const application = await applyAndWait(id);
    expect(application.status).to.equal('NEEDS_REVIEW');
    expect(application.lastError).to.match(/no approved answer[\s\S]*expected salary/);
    expect(site.submissions.length).to.equal(before);

    const retried = await client.post(`/api/applications/${id}/apply`).set(user.auth).expect(200);
    expect(retried.body.data.status).to.equal('APPLYING');
    await drainQueues(app);
  });

  (chrome ? it : it.skip)('stops for review on a CAPTCHA without submitting', async () => {
    const before = site.submissions.length;
    const application = await applyAndWait(await approvedFor(`${base}/apply/captcha`));
    expect(application.status).to.equal('NEEDS_REVIEW');
    expect(application.lastError).to.match(/CAPTCHA/);
    expect(site.submissions.length).to.equal(before);
  });

  (chrome ? it : it.skip)('applies right after approval when the profile opts in', async () => {
    await client.put('/api/profile').set(user.auth).send({ autoApplyOnApprove: true }).expect(200);
    const id = await approvedFor(`${base}/job/ok`);
    await drainQueues(app);
    expect((await client.get(`/api/applications/${id}`).set(user.auth)).body.data.application.status).to.equal('APPLIED');
  });

  it('enforces the daily apply cap', async () => {
    await client.put('/api/profile').set(user.auth).send({ dailyCaps: { apply: 0 } }).expect(200);
    const id = await approvedFor('https://www.naukri.com/job-listings-9');
    const response = await client.post(`/api/applications/${id}/apply`).set(user.auth).expect(400);
    expect(response.body.error.code).to.equal('APPLY_DAILY_CAP_REACHED');
  });

  it('stores LinkedIn sessions encrypted and validates input', async () => {
    await client.put('/api/portal-sessions/naukri').set(user.auth).send({ liAt: 'x'.repeat(20) }).expect(422);
    await client.put('/api/portal-sessions/linkedin').set(user.auth).send({}).expect(422);
    const saved = (await client.put('/api/portal-sessions/linkedin').set(user.auth).send({ liAt: 'AQEDAS-secret-cookie-value' }).expect(200)).body.data;
    expect(saved).to.containDeep({ portal: 'linkedin', cookieCount: 1, status: 'VALID' });
    expect(JSON.stringify(saved)).to.not.containEql('secret-cookie');
    const stored = await (await app.getRepository(PortalSessionRepository)).findOne({ where: { userId: user.id } });
    expect(stored!.encryptedCookies).to.not.containEql('secret-cookie');
    await client.del('/api/portal-sessions/linkedin').set(user.auth).expect(204);
  });

  it('asks for a LinkedIn session before Easy Apply', async () => {
    if (!chrome) return;
    const application = await applyAndWait(await approvedFor('https://www.linkedin.com/jobs/view/4000000000'));
    expect(application.status).to.equal('NEEDS_REVIEW');
    expect(application.lastError).to.match(/Save your LinkedIn session/);
  });
});
