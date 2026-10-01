import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { AuditLogRepository } from '../../repositories';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { minimalPdf, SAMPLE_PARSE_REPLY, SAMPLE_RESUME_TEXT } from '../helpers/fixtures';
import { drainQueues, setupApplication } from '../helpers/test-app';

describe('Resumes and profile (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let groq: FakeLlmProvider;
  let user: TestUser;

  before(async () => {
    ({ app, client } = await setupApplication());
    groq = new FakeLlmProvider('groq', [SAMPLE_PARSE_REPLY]);
    await useFakeLlm(app, groq);
  });

  beforeEach(async () => {
    groq.script([SAMPLE_PARSE_REPLY]);
    user = await givenUser(client);
  });

  after(async () => {
    await app.stop();
  });

  function upload(content: Buffer, fileName: string, as = user) {
    return client.post('/api/resumes').set(as.auth).attach('file', content, fileName);
  }

  it('uploads a text resume, parses it in the background and seeds the profile', async () => {
    const created = await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'priya.txt').expect(200);
    expect(created.body.data).to.containDeep({ fileName: 'priya.txt', parseStatus: 'PENDING', isPrimary: true });
    expect(created.body.data).to.not.have.property('extractedText');
    expect(created.body.data).to.not.have.property('fileKey');

    await drainQueues(app);
    const resume = (await client.get(`/api/resumes/${created.body.data.id}`).set(user.auth).expect(200)).body.data;
    expect(resume.parseStatus).to.equal('PARSED');
    expect(resume.parsedBy).to.eql({ provider: 'groq', model: 'groq-large' });
    expect(resume.document.experience[0].company).to.equal('Acme Payments');
    expect(groq.calls[0].request.messages[0].content).to.match(/Priya Raman/);

    const profile = (await client.get('/api/profile').set(user.auth).expect(200)).body.data;
    expect(profile).to.containDeep({
      targetTitles: ['Senior Software Engineer', 'Software Engineer'],
      location: 'Chennai, India',
      primaryResumeId: resume.id,
      autoTailorThreshold: 75,
    });
    expect(profile.skills).to.containEql('TypeScript');
    expect(profile.yearsExperience).to.be.greaterThanOrEqual(8);
  });

  it('extracts text from a PDF upload', async () => {
    const created = await upload(minimalPdf(SAMPLE_RESUME_TEXT.split('\n').filter(Boolean)), 'priya.pdf').expect(200);
    expect(created.body.data.mimeType).to.equal('application/pdf');
    await drainQueues(app);
    const download = await client.get(`/api/resumes/${created.body.data.id}/file`).set(user.auth).expect(200);
    expect(download.headers['content-type']).to.match(/application\/pdf/);
  });

  it('rejects unsupported and empty files', async () => {
    const exe = await upload(Buffer.from('MZ\u0090\u0000binary'), 'evil.exe').expect(422);
    expect(exe.body.error.code).to.equal('FILE_INVALID');
    const empty = await upload(Buffer.from('too short'), 'empty.txt').expect(422);
    expect(empty.body.error.code).to.equal('RESUME_TEXT_EMPTY');
  });

  it('marks the resume FAILED with the reason when no model can parse it', async () => {
    groq.script(['this is not json']);
    const created = await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'bad.txt').expect(200);
    await drainQueues(app);
    const resume = (await client.get(`/api/resumes/${created.body.data.id}`).set(user.auth)).body.data;
    expect(resume.parseStatus).to.equal('FAILED');
    expect(resume.parseError).to.match(/^LLM_UNAVAILABLE/);
  });

  it('saves validated corrections and requires force to reparse over them', async () => {
    const created = await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'p.txt').expect(200);
    await drainQueues(app);
    const id = created.body.data.id;
    const document = (await client.get(`/api/resumes/${id}`).set(user.auth)).body.data.document;

    await client.patch(`/api/resumes/${id}/document`).set(user.auth).send({ contact: {} }).expect(422);
    document.summary = 'Backend engineer focused on payments.';
    const saved = await client.patch(`/api/resumes/${id}/document`).set(user.auth).send(document).expect(200);
    expect(saved.body.data).to.containDeep({ userEdited: true, document: { summary: 'Backend engineer focused on payments.' } });

    const blocked = await client.post(`/api/resumes/${id}/reparse`).set(user.auth).expect(400);
    expect(blocked.body.error.code).to.equal('RESUME_HAS_EDITS');
    await client.post(`/api/resumes/${id}/reparse?force=true`).set(user.auth).expect(200);
    await drainQueues(app);
    expect((await client.get(`/api/resumes/${id}`).set(user.auth)).body.data.userEdited).to.be.false();
  });

  it('moves primary on delete and audits each step', async () => {
    const first = (await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'a.txt')).body.data;
    const second = (await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'b.txt')).body.data;
    await drainQueues(app);
    expect(second.isPrimary).to.be.false();
    await client.del(`/api/resumes/${first.id}`).set(user.auth).expect(204);
    const list = (await client.get('/api/resumes').set(user.auth)).body.data;
    expect(list.map((r: { id: string; isPrimary: boolean }) => [r.id, r.isPrimary])).to.eql([[second.id, true]]);

    const actions = (await (await app.getRepository(AuditLogRepository)).find({ where: { userId: user.id } })).map(a => a.action);
    expect(actions).to.containEql('RESUME_UPLOADED');
    expect(actions).to.containEql('RESUME_PARSED');
    expect(actions).to.containEql('RESUME_DELETED');
  });

  it('hides other users’ resumes', async () => {
    const created = (await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'mine.txt')).body.data;
    const stranger = await givenUser(client);
    const response = await client.get(`/api/resumes/${created.id}`).set(stranger.auth).expect(404);
    expect(response.body.error.code).to.equal('RESUME_NOT_FOUND');
    await client.del(`/api/resumes/${created.id}`).set(stranger.auth).expect(404);
    expect((await client.get('/api/resumes').set(stranger.auth)).body.data).to.eql([]);
  });

  it('updates the profile and keeps user edits when a later resume is parsed', async () => {
    await client
      .put('/api/profile')
      .set(user.auth)
      .send({ targetTitles: ['Staff Engineer', ' staff engineer '], location: '', dailyCaps: { tailor: 3 } })
      .expect(200);
    await upload(Buffer.from(SAMPLE_RESUME_TEXT), 'p.txt');
    await drainQueues(app);
    const profile = (await client.get('/api/profile').set(user.auth)).body.data;
    expect(profile.targetTitles).to.eql(['Staff Engineer']);
    expect(profile.dailyCaps).to.eql({ tailor: 3, apply: 15, outreach: 10 });
    await client.put('/api/profile').set(user.auth).send({ unknownField: 1 }).expect(422);
  });
});
