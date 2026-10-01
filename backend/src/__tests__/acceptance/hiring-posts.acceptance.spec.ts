import { Client, expect } from '@loopback/testlab';
import { ResumeBuilderApplication } from '../../application';
import { HiringPostService } from '../../services/outreach/hiring-post.service';
import { PostConnectorRegistryService } from '../../services/outreach/post-connector-registry.service';
import { HiringPostConnector, PostConnectorInfo, RawPost } from '../../services/outreach/post-connectors';
import { givenUser, TestUser } from '../helpers/auth.helper';
import { FakeLlmProvider, useFakeLlm } from '../helpers/fake-llm';
import { givenParsedResume, LlmScript } from '../helpers/tailoring.helper';
import { drainQueues, setupApplication } from '../helpers/test-app';

class FakePostConnector implements HiringPostConnector {
  readonly queries: string[] = [];
  constructor(
    readonly info: PostConnectorInfo,
    private posts: RawPost[],
  ) {}
  isConfigured(): boolean {
    return true;
  }
  async search(query: string): Promise<RawPost[]> {
    this.queries.push(query);
    return this.posts;
  }
}

describe('Hiring posts and contacts (acceptance)', () => {
  let app: ResumeBuilderApplication;
  let client: Client;
  let user: TestUser;
  let serp: FakePostConnector;
  let apify: FakePostConnector;

  before(async () => {
    ({ app, client } = await setupApplication());
    await useFakeLlm(app, new FakeLlmProvider('groq', [new LlmScript().reply]));
  });

  beforeEach(async () => {
    serp = new FakePostConnector({ key: 'serpapi-posts', label: 's', description: 's', official: true }, [
      { source: 'serpapi-posts', url: 'https://www.linkedin.com/posts/jane_hiring-1?utm=x', author: 'Jane Doe', text: 'We are hiring! Mail talent@globex.io' },
      { source: 'serpapi-posts', url: 'https://www.linkedin.com/posts/ravi_hiring-2', author: 'Ravi', text: 'Hiring SREs, DM me' },
    ]);
    apify = new FakePostConnector({ key: 'apify-linkedin-posts', label: 'a', description: 'a', official: false }, []);
    (await app.get<PostConnectorRegistryService>('services.PostConnectorRegistryService')).replace([serp, apify]);
    user = await givenUser(client);
    await givenParsedResume(app, client, user);
  });

  after(async () => {
    await app.stop();
  });

  it('previews queries with location, without it, and with a custom template', async () => {
    let queries = (await client.get('/api/hiring-posts/queries').set(user.auth).expect(200)).body.data.queries;
    expect(queries).to.eql(['"hiring" AND "Senior Software Engineer" AND "Chennai, India"', '"hiring" AND "Software Engineer" AND "Chennai, India"']);

    await client.put('/api/profile').set(user.auth).send({ location: null }).expect(200);
    queries = (await client.get('/api/hiring-posts/queries').set(user.auth)).body.data.queries;
    expect(queries[0]).to.equal('"hiring" AND "Senior Software Engineer"');

    await client.put('/api/profile').set(user.auth).send({ hiringQueryTemplate: '"we are hiring" AND "{title}"' }).expect(200);
    queries = (await client.get('/api/hiring-posts/queries').set(user.auth)).body.data.queries;
    expect(queries[0]).to.equal('"we are hiring" AND "Senior Software Engineer"');

    const invalid = await client.put('/api/profile').set(user.auth).send({ hiringQueryTemplate: '"hiring"' }).expect(422);
    expect(invalid.body.error.code).to.equal('HIRING_QUERY_INVALID');
  });

  it('searches enabled sources, dedupes posts and creates contacts from emails', async () => {
    const service = await app.get<HiringPostService>('services.HiringPostService');
    const summary = await service.search({ userId: user.id });
    expect(summary).to.containDeep({ found: 4, created: 2, contactsCreated: 1, errors: [] });
    expect(apify.queries).to.have.length(0);

    const again = await service.search({ userId: user.id });
    expect(again.created).to.equal(0);

    const posts = (await client.get('/api/hiring-posts').set(user.auth).expect(200)).body.data;
    expect(posts.map((p: { postUrl: string }) => p.postUrl).sort()).to.eql([
      'https://www.linkedin.com/posts/jane_hiring-1',
      'https://www.linkedin.com/posts/ravi_hiring-2',
    ]);
    const contacts = (await client.get('/api/contacts').set(user.auth)).body.data;
    expect(contacts).to.containDeep([{ email: 'talent@globex.io', name: 'Jane Doe', source: 'POST', doNotContact: false }]);
  });

  it('runs a manual search through the queue and rate-limits repeats', async () => {
    const started = (await client.post('/api/hiring-posts/search').set(user.auth).expect(200)).body.data;
    expect(started.queries).to.have.length(2);
    await drainQueues(app);
    expect(serp.queries).to.have.length(2);
    const again = await client.post('/api/hiring-posts/search').set(user.auth).expect(429);
    expect(again.body.error.code).to.equal('DISCOVERY_TOO_SOON');
  });

  it('opts into the unofficial source', async () => {
    const sources = (await client.get('/api/hiring-posts/sources').set(user.auth)).body.data;
    expect(sources.map((s: { key: string; enabled: boolean }) => [s.key, s.enabled])).to.eql([
      ['serpapi-posts', true],
      ['apify-linkedin-posts', false],
    ]);
    await client.put('/api/hiring-posts/sources/apify-linkedin-posts').set(user.auth).send({ enabled: true }).expect(200);
    await (await app.get<HiringPostService>('services.HiringPostService')).search({ userId: user.id });
    expect(apify.queries).to.have.length(2);
  });

  it('manages contacts with do-not-contact and duplicates', async () => {
    const created = (await client.post('/api/contacts').set(user.auth).send({ email: 'Lead@Hooli.io', name: 'Lead' }).expect(200)).body.data;
    expect(created.email).to.equal('lead@hooli.io');
    const duplicate = await client.post('/api/contacts').set(user.auth).send({ email: 'lead@hooli.io' }).expect(409);
    expect(duplicate.body.error.code).to.equal('CONTACT_EXISTS');
    const blocked = (await client.patch(`/api/contacts/${created.id}`).set(user.auth).send({ doNotContact: true }).expect(200)).body.data;
    expect(blocked.doNotContact).to.be.true();

    const stranger = await givenUser(client);
    await client.patch(`/api/contacts/${created.id}`).set(stranger.auth).send({ doNotContact: false }).expect(404);
    await client.del(`/api/contacts/${created.id}`).set(user.auth).expect(204);
  });

  it('updates post status', async () => {
    await (await app.get<HiringPostService>('services.HiringPostService')).search({ userId: user.id });
    const [post] = (await client.get('/api/hiring-posts').set(user.auth)).body.data;
    await client.patch(`/api/hiring-posts/${post.id}`).set(user.auth).send({ status: 'IGNORED' }).expect(200);
    expect((await client.get('/api/hiring-posts?status=IGNORED').set(user.auth)).body.data).to.have.length(1);
  });
});
