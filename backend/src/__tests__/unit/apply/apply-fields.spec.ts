import { expect } from '@loopback/testlab';
import { applicantFrom, chooseStrategy, classifyField, matchAnswer, valueFor } from '../../../domain/apply-fields';
import { SAMPLE_RESUME_DOCUMENT } from '../../helpers/fixtures';

describe('Apply field mapping', () => {
  it('classifies common fields by label and type', () => {
    expect(classifyField('First Name *', 'text')).to.equal('firstName');
    expect(classifyField('last_name', 'text')).to.equal('lastName');
    expect(classifyField('Name', 'text')).to.equal('fullName');
    expect(classifyField('Anything', 'email')).to.equal('email');
    expect(classifyField('Mobile number', 'text')).to.equal('phone');
    expect(classifyField('LinkedIn Profile', 'url')).to.equal('linkedin');
    expect(classifyField('Cover Letter', 'textarea')).to.equal('coverLetter');
    expect(classifyField('Resume/CV', 'file')).to.equal('resume');
    expect(classifyField('Cover letter upload', 'file')).to.equal('question');
    expect(classifyField('What is your notice period?', 'text')).to.equal('question');
  });

  it('matches approved answers by question overlap only when close enough', () => {
    const answers = [
      { question: 'Why are you a good fit?', answer: 'Payments experience.' },
      { question: 'How many years of Node.js experience do you have?', answer: '8 years' },
    ];
    expect(matchAnswer('Why are you a good fit for this role? *', answers)).to.equal('Payments experience.');
    expect(matchAnswer('Years of experience with Node.js', answers)).to.equal('8 years');
    expect(matchAnswer('What is your expected salary?', answers)).to.be.undefined();
  });

  it('builds applicant data from the approved resume', () => {
    const data = applicantFrom({ ...SAMPLE_RESUME_DOCUMENT, contact: { ...SAMPLE_RESUME_DOCUMENT.contact, links: ['https://linkedin.com/in/priya', 'https://priya.dev'] } }, 'Note', []);
    expect(data).to.containDeep({ firstName: 'Priya', lastName: 'Raman', linkedin: 'https://linkedin.com/in/priya', website: 'https://priya.dev', coverLetter: 'Note' });
    expect(valueFor('phone', 'Phone', data)).to.equal('+91 98765 43210');
    expect(valueFor('resume', 'Resume', data)).to.be.undefined();
  });

  it('automates only known applicant-tracking systems and LinkedIn Easy Apply', () => {
    expect(chooseStrategy('https://boards.greenhouse.io/acme/jobs/1')).to.equal('ats-form');
    expect(chooseStrategy('https://jobs.lever.co/acme/123/apply')).to.equal('ats-form');
    expect(chooseStrategy('https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1')).to.equal('ats-form');
    expect(chooseStrategy('https://www.linkedin.com/jobs/view/123')).to.equal('linkedin-easy-apply');
    expect(chooseStrategy('https://www.naukri.com/job-listings-1')).to.equal('manual');
    expect(chooseStrategy('https://in.indeed.com/viewjob?jk=1')).to.equal('manual');
    expect(chooseStrategy('javascript:alert(1)')).to.equal('manual');
    expect(chooseStrategy('http://127.0.0.1:9999/apply', ['127.0.0.1'])).to.equal('ats-form');
  });
});
