import { expect } from '@loopback/testlab';
import { ApplicationStatus, canTransition, TRANSITIONS } from '../../../domain/application-status';
import { diffResumes, keywordCoverage } from '../../../domain/resume-diff';
import { ResumeDocument } from '../../../domain/resume-document';
import { factCheck, numbersIn } from '../../../domain/resume-fact-check';
import { SAMPLE_RESUME_DOCUMENT as MASTER, SAMPLE_RESUME_TEXT as MASTER_TEXT } from '../../helpers/fixtures';

function tailored(mutate: (doc: ResumeDocument) => void): ResumeDocument {
  const copy = JSON.parse(JSON.stringify(MASTER)) as ResumeDocument;
  mutate(copy);
  return copy;
}

describe('factCheck', () => {
  it('passes rephrasing, reordering and dropping content', () => {
    const doc = tailored(d => {
      d.summary = 'Backend engineer focused on Node.js payment services and Kafka pipelines.';
      d.skills = ['Kafka', 'Node.js', 'Redis'];
      d.experience[0].bullets = ['Designed idempotent payout APIs used by 1,200 merchants', 'Led the settlement service migration to Node.js, cutting batch time by 40%'];
      d.experience[1].bullets = [];
    });
    expect(factCheck(MASTER, MASTER_TEXT, doc)).to.eql({ passed: true, violations: [] });
  });

  it('flags an invented employer and changed dates', () => {
    const doc = tailored(d => {
      d.experience.push({ company: 'Google', title: 'Staff Engineer', startDate: '2016-01', endDate: '2018-01', bullets: [], location: undefined });
      d.experience[0].startDate = '2020-03';
    });
    const kinds = factCheck(MASTER, MASTER_TEXT, doc).violations.map(v => [v.kind, v.value]);
    expect(kinds).to.containDeep([['changed_dates', '2020-03 – Present'], ['unknown_role', 'Staff Engineer at Google']]);
  });

  it('flags a renamed title even at the right company', () => {
    const doc = tailored(d => (d.experience[0].title = 'Principal Engineer'));
    expect(factCheck(MASTER, MASTER_TEXT, doc).violations[0]).to.containDeep({ kind: 'unknown_role', path: 'experience[0]' });
  });

  it('flags inflated or new numbers', () => {
    const doc = tailored(d => {
      d.experience[0].bullets[0] = 'Led migration of the settlement service to Node.js, cutting batch time by 60%';
      d.summary = 'Engineer with 10+ years of experience.';
    });
    const values = factCheck(MASTER, MASTER_TEXT, doc).violations.filter(v => v.kind === 'new_number').map(v => v.value);
    expect(values.sort()).to.eql(['10', '60']);
  });

  it('flags skills, certifications and education the master never mentions', () => {
    const doc = tailored(d => {
      d.skills.push('Kubernetes');
      d.certifications.push({ name: 'AWS Solutions Architect', issuer: undefined, date: undefined });
      d.education[0].degree = 'M.Tech';
    });
    const kinds = factCheck(MASTER, MASTER_TEXT, doc).violations.map(v => v.kind).sort();
    expect(kinds).to.eql(['unknown_certification', 'unknown_education', 'unsupported_skill']);
  });

  it('accepts a skill that appears only in a master bullet', () => {
    const doc = tailored(d => d.skills.push('GitHub Actions'));
    expect(factCheck(MASTER, MASTER_TEXT, doc).passed).to.be.true();
  });

  it('flags changed contact details', () => {
    const doc = tailored(d => (d.contact.email = 'someone.else@example.test'));
    expect(factCheck(MASTER, MASTER_TEXT, doc).violations[0]).to.containDeep({ kind: 'changed_contact', path: 'contact.email' });
  });

  it('normalises numbers', () => {
    expect([...numbersIn('1,200 merchants, 40% faster, v2.5.')].sort()).to.eql(['1200', '2.5', '40']);
  });
});

describe('diffResumes and keywordCoverage', () => {
  it('reports changed sections, removed roles and attaches reasons', () => {
    const doc = tailored(d => {
      d.summary = 'New summary';
      d.skills = ['Kafka', ...d.skills.filter(s => s !== 'Kafka')];
      d.experience = [d.experience[0]];
      d.experience[0].bullets = [...d.experience[0].bullets].reverse();
    });
    const changes = diffResumes(MASTER, doc, [{ path: 'skills', reason: 'Job asks for Kafka first' }]);
    expect(changes.map(c => c.path)).to.eql(['summary', 'skills', 'experience[0].bullets', 'experience[1]']);
    expect(changes[1].reason).to.equal('Job asks for Kafka first');
    expect(changes[3]).to.containDeep({ before: 'Software Engineer at Brightlabs', after: undefined });
  });

  it('reports no changes for an identical copy', () => {
    expect(diffResumes(MASTER, tailored(() => undefined))).to.eql([]);
  });

  it('measures keyword coverage before and after', () => {
    const doc = tailored(d => (d.summary = 'Uses GraphQL daily'));
    const coverage = keywordCoverage(['Node.js', 'Kafka', 'GraphQL', 'Kubernetes', 'node.js'], MASTER, doc);
    expect(coverage).to.eql({ keywords: ['Node.js', 'Kafka', 'GraphQL', 'Kubernetes'], before: 50, after: 75, missing: ['Kubernetes'] });
  });
});

describe('Application status machine', () => {
  it('only reaches APPROVED from REVIEW_PENDING and APPLYING from approved states', () => {
    const into = (target: ApplicationStatus) => (Object.keys(TRANSITIONS) as ApplicationStatus[]).filter(from => canTransition(from, target)).sort();
    expect(into(ApplicationStatus.APPROVED)).to.eql([ApplicationStatus.REVIEW_PENDING]);
    expect(into(ApplicationStatus.APPLYING)).to.eql([ApplicationStatus.APPROVED, ApplicationStatus.FAILED, ApplicationStatus.NEEDS_REVIEW].sort());
  });

  it('treats APPLIED as terminal', () => {
    expect(TRANSITIONS[ApplicationStatus.APPLIED]).to.eql([]);
  });
});
