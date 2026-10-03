import { expect } from '@loopback/testlab';
import { jobFingerprint, normaliseCompany, normaliseLocation, normaliseTitle, safeUrl, searchTitle, stripHtml, toDate } from '../../../domain/job-normalise';
import { containsTerm, keywordScore } from '../../../domain/keyword-match';

describe('Job normalisation', () => {
  it('treats the same job from different portals as one fingerprint', () => {
    const a = jobFingerprint({ company: 'Globex Technologies Pvt. Ltd.', title: 'Sr. Backend Engineer (Remote)', location: 'Bangalore, Karnataka, India' });
    const b = jobFingerprint({ company: 'globex', title: 'Senior Backend Engineer', location: 'Bengaluru' });
    expect(a).to.equal(b);
  });

  it('keeps different roles and cities apart', () => {
    const base = { company: 'Globex', title: 'Backend Engineer', location: 'Chennai' };
    expect(jobFingerprint(base)).to.not.equal(jobFingerprint({ ...base, title: 'Frontend Engineer' }));
    expect(jobFingerprint(base)).to.not.equal(jobFingerprint({ ...base, location: 'Pune' }));
  });

  it('normalises parts', () => {
    expect(normaliseCompany('Acme Corp, Inc.')).to.equal('acme');
    expect(normaliseTitle('Jr. Dev [Contract]')).to.equal('junior dev');
    expect(normaliseLocation(undefined)).to.equal('');
  });

  it('strips HTML and decodes entities', () => {
    expect(stripHtml('<p>Build APIs &amp; services</p><ul><li>Node</li><li>Go</li></ul>')).to.equal('Build APIs & services\n- Node\n- Go');
  });

  it('accepts only http(s) URLs', () => {
    expect(safeUrl('https://a.test/x')).to.equal('https://a.test/x');
    expect(safeUrl('javascript:alert(1)')).to.be.undefined();
    expect(safeUrl(42)).to.be.undefined();
  });

  it('parses dates in several shapes', () => {
    expect(toDate('2026-09-30T10:00:00Z')?.toISOString()).to.equal('2026-09-30T10:00:00.000Z');
    expect(toDate(1_790_000_000)?.getUTCFullYear()).to.equal(2026);
    expect(toDate('not a date')).to.be.undefined();
  });
});

describe('Keyword pre-filter', () => {
  it('matches terms with symbols as whole terms', () => {
    expect(containsTerm('experience with node.js and c++', 'Node.js')).to.be.true();
    expect(containsTerm('experience with c++', 'C')).to.be.false();
    expect(containsTerm('we use c#', 'c#')).to.be.true();
    expect(containsTerm('javascript', 'java')).to.be.false();
  });

  it('scores skills and title overlap', () => {
    const result = keywordScore('Node.js TypeScript MongoDB required', 'Senior Backend Engineer', ['Node.js', 'TypeScript', 'Go', 'Rust'], ['Backend Engineer']);
    expect(result.matched).to.eql(['Node.js', 'TypeScript']);
    expect(result.missing).to.eql(['Go', 'Rust']);
    expect(result.score).to.equal(Math.round(100 * (0.7 * 0.5 + 0.3 * 1)));
  });

  it('scores zero with no skills and unrelated title', () => {
    expect(keywordScore('anything', 'Chef', [], ['Engineer']).score).to.equal(0);
  });
});

describe('searchTitle', () => {
  it('reduces resume headings to a job-board query', () => {
    expect(searchTitle('MERN Stack Developer — Payroll & HRMS SaaS Platform')).to.equal('MERN Stack Developer');
    expect(searchTitle('Backend Developer — GoldArk (Gold Savings App)')).to.equal('Backend Developer');
    expect(searchTitle('Software Engineer at Acme')).to.equal('Software Engineer');
    expect(searchTitle('Senior Engineer | Payments')).to.equal('Senior Engineer');
  });

  it('keeps hyphenated titles intact', () => {
    expect(searchTitle('Full-Stack Developer (Contract)')).to.equal('Full-Stack Developer');
  });
});
