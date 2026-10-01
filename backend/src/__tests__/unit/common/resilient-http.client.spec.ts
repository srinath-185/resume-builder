import { expect } from '@loopback/testlab';
import { UpstreamHttpError } from '../../../common/errors';
import { buildUrl, FetchFn, parseRetryAfter, ResilientHttpClient } from '../../../common/http/resilient-http.client';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function scriptedFetch(responses: Array<Response | Error>): { fetchImpl: FetchFn; calls: () => number } {
  let index = 0;
  return {
    fetchImpl: async () => {
      const next = responses[Math.min(index, responses.length - 1)];
      index++;
      if (next instanceof Error) throw next;
      return next.clone();
    },
    calls: () => index,
  };
}

const noSleep = async (): Promise<void> => undefined;

describe('ResilientHttpClient', () => {
  it('returns parsed JSON on success', async () => {
    const { fetchImpl } = scriptedFetch([jsonResponse(200, { ok: true })]);
    const client = new ResilientHttpClient({ name: 'test', fetchImpl, sleep: noSleep });
    const response = await client.request<{ ok: boolean }>({ url: 'https://example.test/x' });
    expect(response.data).to.eql({ ok: true });
  });

  it('retries 5xx and network errors, then succeeds', async () => {
    const { fetchImpl, calls } = scriptedFetch([jsonResponse(503, {}), new TypeError('socket hang up'), jsonResponse(200, { ok: 1 })]);
    const client = new ResilientHttpClient({ name: 'test', fetchImpl, sleep: noSleep, retries: 2 });
    const response = await client.request<{ ok: number }>({ url: 'https://example.test/x' });
    expect(response.data.ok).to.equal(1);
    expect(calls()).to.equal(3);
  });

  it('does not retry a 4xx client error', async () => {
    const { fetchImpl, calls } = scriptedFetch([jsonResponse(401, { error: 'bad key' })]);
    const client = new ResilientHttpClient({ name: 'test', fetchImpl, sleep: noSleep, retries: 3 });
    const error = await client.request({ url: 'https://example.test/x' }).catch(e => e as UpstreamHttpError);
    expect(error).to.be.instanceOf(UpstreamHttpError);
    expect((error as UpstreamHttpError).upstreamStatus).to.equal(401);
    expect(calls()).to.equal(1);
  });

  it('honours Retry-After on 429', async () => {
    const waits: number[] = [];
    const { fetchImpl } = scriptedFetch([jsonResponse(429, {}, { 'retry-after': '2' }), jsonResponse(200, {})]);
    const client = new ResilientHttpClient({
      name: 'test',
      fetchImpl,
      sleep: async ms => {
        waits.push(ms);
      },
    });
    await client.request({ url: 'https://example.test/x' });
    expect(waits).to.eql([2000]);
  });

  it('surfaces the final status after exhausting retries', async () => {
    const { fetchImpl, calls } = scriptedFetch([jsonResponse(429, { e: 1 })]);
    const client = new ResilientHttpClient({ name: 'groq', fetchImpl, sleep: noSleep, retries: 1 });
    const error = (await client.request({ url: 'https://example.test/x' }).catch(e => e)) as UpstreamHttpError;
    expect(error.isRateLimited).to.be.true();
    expect(calls()).to.equal(2);
  });

  it('opens the breaker after repeated failures and then fails fast', async () => {
    const { fetchImpl, calls } = scriptedFetch([jsonResponse(500, {})]);
    const client = new ResilientHttpClient({
      name: 'flaky',
      fetchImpl,
      sleep: noSleep,
      retries: 0,
      breaker: { volumeThreshold: 2, errorThresholdPercentage: 50, resetTimeoutMs: 60_000 },
    });
    for (let i = 0; i < 3; i++) await client.request({ url: 'https://example.test/x' }).catch(() => undefined);
    const before = calls();
    const error = (await client.request({ url: 'https://example.test/x' }).catch(e => e)) as UpstreamHttpError;
    expect(error.breakerOpen).to.be.true();
    expect(calls()).to.equal(before);
  });

  it('computes jittered exponential backoff within bounds', () => {
    const client = new ResilientHttpClient({ name: 't', baseDelayMs: 100, maxDelayMs: 1000, random: () => 1 });
    expect(client.backoffMs(0)).to.equal(100);
    expect(client.backoffMs(3)).to.equal(800);
    expect(client.backoffMs(10)).to.equal(1000);
  });

  it('builds query strings and parses Retry-After', () => {
    expect(buildUrl('https://a.test/p', { q: 'x y', skip: undefined, n: 2 })).to.equal('https://a.test/p?q=x+y&n=2');
    expect(parseRetryAfter('3')).to.equal(3000);
    expect(parseRetryAfter(null)).to.be.undefined();
  });
});
