// Drives the real API end to end: register → upload → parse → listing → tailor → review → approve → apply.
const fs = require('fs');
const { MongoClient, ObjectId } = require(require('path').resolve(__dirname, '../../backend/node_modules/mongodb'));
const { SAMPLE_RESUME_TEXT } = require(require('path').resolve(__dirname, '../../backend/dist/__tests__/helpers/fixtures'));

const API = 'http://127.0.0.1:3101/api';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let token;

async function call(method, path, body, raw = false) {
  const headers = token ? { authorization: `Bearer ${token}` } : {};
  const init = { method, headers };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(API + path, init);
  if (raw) return { status: res.status, type: res.headers.get('content-type'), bytes: (await res.arrayBuffer()).byteLength };
  const json = res.status === 204 ? {} : await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json.error)}`);
  return json.data;
}

async function until(label, fn, done, timeoutMs = 60000) {
  const start = Date.now();
  for (;;) {
    const value = await fn();
    if (done(value)) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}: ${JSON.stringify(value).slice(0, 300)}`);
    await sleep(500);
  }
}

(async () => {
  const step = (name, detail = '') => console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`);
  console.log('health', JSON.stringify(await call('GET', '/health')));

  const auth = await call('POST', '/auth/register', { email: `smoke-${Date.now()}@example.test`, password: 'smoke password 1', name: 'Priya Raman' });
  token = auth.token;
  step('registered', auth.user.email);

  const form = new FormData();
  form.append('file', new Blob([SAMPLE_RESUME_TEXT], { type: 'text/plain' }), 'priya.txt');
  const uploaded = await call('POST', '/resumes', form);
  const parsed = await until('parse', () => call('GET', `/resumes/${uploaded.id}`), r => r.parseStatus !== 'PENDING' && r.parseStatus !== 'PARSING');
  if (parsed.parseStatus !== 'PARSED') throw new Error(`parse failed: ${parsed.parseError}`);
  step('resume parsed by real Mongo-backed API', `${parsed.parsedBy.provider}/${parsed.parsedBy.model}, ${parsed.document.experience.length} roles`);

  const profile = await call('GET', '/profile');
  step('profile seeded', `${profile.targetTitles.join(' | ')} · ${profile.location}`);
  const pdf = await call('GET', `/resumes/${uploaded.id}/pdf?template=modern`, undefined, true);
  step('master PDF rendered', `${pdf.status} ${pdf.type} ${pdf.bytes} bytes`);

  const siteUrl = fs.readFileSync('/tmp/rb-smoke/site-url', 'utf8');
  const mongo = await MongoClient.connect('mongodb://127.0.0.1:27999/rb_smoke');
  const listing = await mongo.db('rb_smoke').collection('job_listings').insertOne({
    userId: new ObjectId(auth.user.id), fingerprint: 'smoke-1', source: 'jsearch', seenOn: ['jsearch'], externalId: 'smoke-1',
    title: 'Senior Backend Engineer', company: 'Globex', location: 'Chennai', url: `${siteUrl}/job/ok`, applyUrl: `${siteUrl}/job/ok`,
    applyOptions: [], description: 'Build payment services in Node.js with Kafka. Kubernetes required. Redis is a plus.',
    status: 'NEW', matchStatus: 'SCORED', matchScore: 90, matchedSkills: [], missingSkills: [], createdAt: new Date(), updatedAt: new Date(),
  });
  await mongo.close();
  const jobs = await call('GET', '/jobs');
  step('listing visible through /jobs', `${jobs.total} job(s), score ${jobs.items[0].matchScore}`);

  const application = await call('POST', `/jobs/${listing.insertedId}/tailor`, { instructions: 'Emphasise payments' });
  const review = await until('tailoring', () => call('GET', `/applications/${application.id}`), r => r.application.status !== 'TAILORING');
  if (review.application.status !== 'REVIEW_PENDING') throw new Error(`tailoring ended in ${review.application.status}: ${review.application.lastError}`);
  step('tailored draft ready for review', `fact-check ${review.variant.factCheck.passed ? 'passed' : 'FAILED'}, coverage ${review.variant.keywordCoverage.before}%→${review.variant.keywordCoverage.after}%, ${review.variant.changes.length} changes`);

  const list = await call('GET', '/applications?status=REVIEW_PENDING');
  if (list[0].jobTitle !== 'Senior Backend Engineer' || list[0].company !== 'Globex') {
    const debug = await MongoClient.connect('mongodb://127.0.0.1:27999/rb_smoke');
    const db = debug.db('rb_smoke');
    const appDoc = await db.collection('JobApplication').findOne({}) ?? await db.collection('job_applications').findOne({});
    const listingDoc = await db.collection('job_listings').findOne({});
    console.log('collections:', (await db.listCollections().toArray()).map(c => c.name).join(','));
    console.log('application doc:', JSON.stringify(appDoc));
    console.log('listing doc keys:', Object.keys(listingDoc), 'userId type', listingDoc.userId && listingDoc.userId.constructor.name);
    await debug.close();
    throw new Error(`list join broken: ${JSON.stringify(list[0]).slice(0, 200)}`);
  }
  step('applications list carries job details', `${list[0].jobTitle} at ${list[0].company}`);

  let refused = '';
  try {
    await call('POST', `/applications/${application.id}/apply`);
  } catch (error) {
    refused = error.message;
  }
  if (!/RESUME_VARIANT_NOT_APPROVED/.test(refused)) throw new Error('apply before approval was not refused');
  step('apply refused before approval');

  await call('POST', `/applications/${application.id}/approve`);
  await call('POST', `/applications/${application.id}/apply`);
  const applied = await until('apply', () => call('GET', `/applications/${application.id}`), r => r.application.status !== 'APPLYING', 120000);
  step('assisted apply finished', `${applied.application.status} via ${applied.application.method}${applied.application.lastError ? ` (${applied.application.lastError})` : ''}`);
  console.log('site submissions:', fs.readFileSync('/tmp/rb-smoke/site-submissions', 'utf8'));

  const tailoredPdf = await call('GET', `/applications/${application.id}/resume.pdf`, undefined, true);
  const shot = await call('GET', `/applications/${application.id}/screenshot.png`, undefined, true);
  step('artifacts', `tailored PDF ${tailoredPdf.bytes} bytes, screenshot ${shot.type} ${shot.bytes} bytes`);

  const llm = await call('GET', '/llm/status');
  step('LLM usage recorded', llm.usageToday.map(row => `${row.task}:${row.calls}`).join(', '));
  console.log('SMOKE PASSED');
})().catch(error => {
  console.error('SMOKE FAILED', error.message);
  process.exit(1);
});
