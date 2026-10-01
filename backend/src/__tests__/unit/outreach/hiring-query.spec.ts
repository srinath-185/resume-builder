import { expect } from '@loopback/testlab';
import { ResilientHttpClient } from '../../../common/http/resilient-http.client';
import {
  authorFromTitle,
  buildHiringQuery,
  canonicalPostUrl,
  DEFAULT_HIRING_QUERY_TEMPLATE,
  extractEmails,
  toGoogleQuery,
  validateHiringTemplate,
} from '../../../domain/hiring-query';
import { SerpApiPostsConnector } from '../../../services/outreach/post-connectors';

describe('Hiring post query builder', () => {
  it('builds "hiring" AND "<title>" AND "<location>"', () => {
    expect(buildHiringQuery(DEFAULT_HIRING_QUERY_TEMPLATE, 'Backend Engineer', 'Chennai')).to.equal('"hiring" AND "Backend Engineer" AND "Chennai"');
  });

  for (const empty of [undefined, null, '', '   ']) {
    it(`drops the location clause when location is ${JSON.stringify(empty)}`, () => {
      expect(buildHiringQuery(DEFAULT_HIRING_QUERY_TEMPLATE, 'Backend Engineer', empty)).to.equal('"hiring" AND "Backend Engineer"');
    });
  }

  it('drops only clauses that use {location} in a custom template', () => {
    const template = '("hiring" OR "we are hiring") AND "{title}" AND "{location}" AND "remote OK"';
    expect(buildHiringQuery(template, 'SRE', '')).to.equal('("hiring" OR "we are hiring") AND "SRE" AND "remote OK"');
  });

  it('strips quotes and backslashes from values so they cannot break the query', () => {
    expect(buildHiringQuery(DEFAULT_HIRING_QUERY_TEMPLATE, 'C++ "Dev"\\', 'New  York')).to.equal('"hiring" AND "C++ Dev" AND "New York"');
  });

  it('validates templates', () => {
    expect(validateHiringTemplate('"hiring" AND "{location}"')).to.match(/must contain \{title\}/);
    expect(validateHiringTemplate('"{title}" {company}')).to.match(/Unknown placeholder\(s\): \{company\}/);
    expect(validateHiringTemplate(DEFAULT_HIRING_QUERY_TEMPLATE)).to.be.undefined();
  });

  it('converts to a Google query', () => {
    expect(toGoogleQuery('"hiring" AND "SRE"')).to.equal('"hiring" "SRE"');
  });
});

describe('Post parsing helpers', () => {
  it('extracts recruiter emails and ignores no-reply and example addresses', () => {
    expect(extractEmails('Send CVs to Talent@Globex.io. Questions: noreply@globex.io, test@example.com, hr@globex.io')).to.eql(['talent@globex.io', 'hr@globex.io']);
  });

  it('reads the author from Google result titles', () => {
    expect(authorFromTitle('Jane Doe on LinkedIn: We are hiring backend engineers')).to.equal('Jane Doe');
    expect(authorFromTitle("Ravi Kumar's Post - LinkedIn")).to.equal('Ravi Kumar');
    expect(authorFromTitle('LinkedIn')).to.be.undefined();
  });

  it('canonicalises post URLs', () => {
    expect(canonicalPostUrl('https://www.linkedin.com/posts/jane_hiring-activity-123/?utm_source=x#c')).to.equal('https://www.linkedin.com/posts/jane_hiring-activity-123');
  });
});

describe('SerpApiPostsConnector', () => {
  afterEach(() => delete process.env.SERPAPI_KEY);

  it('searches LinkedIn posts through Google and keeps only post URLs', async () => {
    process.env.SERPAPI_KEY = 'serp';
    const urls: string[] = [];
    const connector = new SerpApiPostsConnector(
      new ResilientHttpClient({
        name: 'serpapi',
        retries: 0,
        fetchImpl: async url => {
          urls.push(url);
          return new Response(
            JSON.stringify({
              organic_results: [
                { title: 'Jane Doe on LinkedIn: Hiring SREs', link: 'https://www.linkedin.com/posts/jane_hiring-1', snippet: 'Email cv@acme.io' },
                { title: 'Acme careers', link: 'https://acme.io/careers', snippet: 'not a post' },
              ],
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
      }),
    );
    const posts = await connector.search('"hiring" AND "SRE" AND "Pune"', 10);
    expect(new URL(urls[0]).searchParams.get('q')).to.equal('site:linkedin.com/posts "hiring" "SRE" "Pune"');
    expect(posts).to.have.length(1);
    expect(posts[0]).to.containDeep({ author: 'Jane Doe', url: 'https://www.linkedin.com/posts/jane_hiring-1' });
    expect(posts[0].text).to.match(/cv@acme\.io/);
  });
});
