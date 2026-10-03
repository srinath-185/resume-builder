import { expect } from '@loopback/testlab';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import { AdzunaConnector } from '../../../services/jobs/connectors/adzuna.connector';
import { createApifyLinkedInConnector, renderActorInput } from '../../../services/jobs/connectors/apify.connector';
import { JSearchConnector } from '../../../services/jobs/connectors/jsearch.connector';
import { ApifyLinkedInPostsConnector } from '../../../services/outreach/post-connectors';

function http(name: string, body: unknown, captured: Array<{ url: string; init?: RequestInit }>): ResilientHttpClient {
  return new ResilientHttpClient({
    name,
    retries: 0,
    fetchImpl: async (url, init) => {
      captured.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
}

const query = { title: 'Backend Engineer', location: 'Chennai', remoteOnly: false, limit: 10 };

describe('Job source connectors', () => {
  afterEach(() => {
    for (const key of ['JSEARCH_API_KEY', 'ADZUNA_APP_ID', 'ADZUNA_APP_KEY', 'APIFY_TOKEN', 'APIFY_LINKEDIN_ACTOR', 'APIFY_LINKEDIN_INPUT']) delete process.env[key];
  });

  it('JSearch: queries "<title> in <location>" and maps apply options', async () => {
    process.env.JSEARCH_API_KEY = 'rapid';
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const connector = new JSearchConnector(
      http('jsearch', {
        data: [
          {
            job_id: 'j1',
            job_title: 'Backend Engineer',
            employer_name: 'Globex',
            job_city: 'Chennai',
            job_country: 'IN',
            job_apply_link: 'https://globex.test/apply',
            job_description: '<p>Node &amp; Mongo</p>',
            job_posted_at_datetime_utc: '2026-09-29T00:00:00Z',
            apply_options: [
              { publisher: 'LinkedIn', apply_link: 'https://linkedin.test/1', is_direct: false },
              { publisher: 'Bad', apply_link: 'javascript:alert(1)' },
            ],
          },
          { job_id: 'j2', job_title: 'Missing employer' },
        ],
      }, captured),
    );
    const jobs = await connector.search(query);
    const url = new URL(captured[0].url);
    expect(url.searchParams.get('query')).to.equal('Backend Engineer in Chennai');
    expect((captured[0].init?.headers as Record<string, string>)['X-RapidAPI-Key']).to.equal('rapid');
    expect(jobs).to.have.length(1);
    expect(jobs[0]).to.containDeep({ externalId: 'j1', company: 'Globex', location: 'Chennai, IN', description: 'Node & Mongo' });
    expect(jobs[0].applyOptions).to.eql([{ publisher: 'LinkedIn', url: 'https://linkedin.test/1', isDirect: false }]);
  });

  it('Adzuna: requires both credentials and maps results', async () => {
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const connector = new AdzunaConnector(
      http('adzuna', { results: [{ id: 7, title: '<strong>Backend</strong> Engineer', company: { display_name: 'Initech' }, location: { display_name: 'Chennai' }, redirect_url: 'https://adzuna.test/7', description: 'Go' }] }, captured),
    );
    expect(connector.isConfigured()).to.be.false();
    process.env.ADZUNA_APP_ID = 'id';
    process.env.ADZUNA_APP_KEY = 'key';
    const jobs = await connector.search(query);
    expect(captured[0].url).to.startWith('https://api.adzuna.com/v1/api/jobs/in/search/1?');
    expect(jobs[0]).to.containDeep({ externalId: '7', title: 'Backend Engineer', company: 'Initech' });
  });

  it('Apify: renders the input template safely and maps varied field names', async () => {
    expect(renderActorInput('{"q":"{{title}}","where":"{{location}}","n":"{{limit}}"}', { ...query, title: 'C++ "Dev"' })).to.eql({ q: 'C++ "Dev"', where: 'Chennai', n: 10 });

    process.env.APIFY_TOKEN = 'apify';
    process.env.APIFY_LINKEDIN_ACTOR = 'someone/linkedin-jobs';
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const connector = createApifyLinkedInConnector(
      http('apify-linkedin', [{ jobId: 'L1', title: 'Backend Engineer', companyName: 'Hooli', location: 'Chennai', jobUrl: 'https://linkedin.test/L1', descriptionText: 'Kafka' }], captured),
    );
    const jobs = await connector.search(query);
    expect(captured[0].url).to.startWith('https://api.apify.com/v2/acts/someone~linkedin-jobs/run-sync-get-dataset-items');
    expect(JSON.parse(String(captured[0].init?.body))).to.eql({ title: 'Backend Engineer', location: 'Chennai', rows: 10 });
    expect(jobs[0]).to.containDeep({ source: 'apify-linkedin', externalId: 'L1', company: 'Hooli', description: 'Kafka' });
    expect(connector.info.official).to.be.false();
  });
});

describe('Apify LinkedIn posts connector', () => {
  afterEach(() => {
    for (const key of ['APIFY_TOKEN', 'APIFY_LINKEDIN_POSTS_ACTOR', 'APIFY_LINKEDIN_POSTS_INPUT']) delete process.env[key];
  });

  it('sends the boolean query and maps harvestapi/linkedin-post-search output', async () => {
    process.env.APIFY_TOKEN = 'apify';
    process.env.APIFY_LINKEDIN_POSTS_ACTOR = 'harvestapi/linkedin-post-search';
    const captured: Array<{ url: string; init?: RequestInit }> = [];
    const connector = new ApifyLinkedInPostsConnector(
      http('apify-linkedin-posts', [
        {
          linkedinUrl: 'https://www.linkedin.com/posts/jane_hiring-123',
          content: 'We are hiring a MERN developer in Coimbatore. Mail jobs@acme.io',
          author: { name: 'Jane Doe', linkedinUrl: 'https://www.linkedin.com/in/jane' },
          postedAt: { date: '2026-10-01T10:00:00.000Z', timestamp: 1790848800000 },
        },
        { linkedinUrl: 'https://www.linkedin.com/posts/empty-1' },
      ], captured),
    );
    expect(connector.isConfigured()).to.be.true();
    const posts = await connector.search('"hiring" AND "MERN Developer"', 5);
    expect(captured[0].url).to.match(/acts\/harvestapi~linkedin-post-search\/run-sync-get-dataset-items/);
    expect(JSON.parse(String(captured[0].init?.body))).to.eql({ searchQueries: ['"hiring" AND "MERN Developer"'], maxPosts: 5 });
    expect(posts).to.have.length(1);
    expect(posts[0]).to.containDeep({ url: 'https://www.linkedin.com/posts/jane_hiring-123', author: 'Jane Doe', authorUrl: 'https://www.linkedin.com/in/jane' });
    expect(posts[0].postedAt?.toISOString()).to.equal('2026-10-01T10:00:00.000Z');
  });
});
