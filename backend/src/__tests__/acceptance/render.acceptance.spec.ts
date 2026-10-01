import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { SAMPLE_PARSE_REPLY, SAMPLE_RESUME_TEXT } from '../helpers/fixtures';
import { drainQueues, setupApplication } from '../helpers/test-app';

/** supertest buffers binary bodies only with an explicit parser. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function binaryParser(res: any, done: (err: Error | null, body: unknown) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

describe('Resume rendering (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let groq: FakeLlmProvider;

  before(async () => {
    ({ app, client } = await setupApplication());
    groq = new FakeLlmProvider('groq', [SAMPLE_PARSE_REPLY]);
    await useFakeLlm(app, groq);
    user = await givenUser(client);
  });

  after(async () => {
    await app.stop();
  });

  it('lists templates', async () => {
    const response = await client.get('/api/resume-templates').set(user.auth).expect(200);
    expect(response.body.data.map((t: { id: string }) => t.id)).to.eql(['classic', 'modern', 'compact']);
  });

  it('renders a parsed resume as an inline PDF', async () => {
    const created = (await client.post('/api/resumes').set(user.auth).attach('file', Buffer.from(SAMPLE_RESUME_TEXT), 'priya.txt')).body.data;
    await drainQueues(app);
    const response = await client
      .get(`/api/resumes/${created.id}/pdf?template=modern`)
      .set(user.auth)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(response.headers['content-type']).to.equal('application/pdf');
    expect(response.headers['content-disposition']).to.match(/^inline; filename="priya.pdf"/);
    expect((response.body as Buffer).subarray(0, 5).toString()).to.equal('%PDF-');
  });

  it('refuses to render before parsing and rejects unknown templates', async () => {
    groq.script(['not json']);
    const created = (await client.post('/api/resumes').set(user.auth).attach('file', Buffer.from(SAMPLE_RESUME_TEXT), 'x.txt')).body.data;
    await drainQueues(app);
    const unparsed = await client.get(`/api/resumes/${created.id}/pdf`).set(user.auth).expect(400);
    expect(unparsed.body.error.code).to.equal('RESUME_NOT_PARSED');

    groq.script([SAMPLE_PARSE_REPLY]);
    await client.post(`/api/resumes/${created.id}/reparse`).set(user.auth).expect(200);
    await drainQueues(app);
    const unknown = await client.get(`/api/resumes/${created.id}/pdf?template=fancy`).set(user.auth).expect(404);
    expect(unknown.body.error.code).to.equal('TEMPLATE_NOT_FOUND');
  });
});
