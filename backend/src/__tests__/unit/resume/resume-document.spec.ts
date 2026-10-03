import { expect } from '@loopback/testlab';
import { normalizeSkills, ResumeDocumentSchema, resumeToText, toMonthIndex, yearsOfExperience } from '../../../domain/resume-document';
import { detectType } from '../../../services/common/file-upload.service';
import { StorageService } from '../../../services/common/storage.service';
import { normaliseText, TextExtractionService } from '../../../services/resume/text-extraction.service';
import { minimalPdf, SAMPLE_PARSE_REPLY, SAMPLE_RESUME_DOCUMENT, SAMPLE_RESUME_TEXT } from '../../helpers/fixtures';

describe('ResumeDocument', () => {
  const now = new Date('2026-10-01T00:00:00Z');

  it('accepts model output with nulls and normalises them away', () => {
    const parsed = ResumeDocumentSchema.parse(JSON.parse(SAMPLE_PARSE_REPLY));
    expect(parsed.summary).to.be.undefined();
    expect(parsed.experience[0].location).to.be.undefined();
    expect(parsed.projects).to.eql([]);
  });

  it('rejects a document without a contact name', () => {
    expect(ResumeDocumentSchema.safeParse({ contact: {} }).success).to.be.false();
  });

  it('parses month indexes', () => {
    expect(toMonthIndex('2021-03', now)).to.equal(2021 * 12 + 2);
    expect(toMonthIndex('2019', now)).to.equal(2019 * 12);
    expect(toMonthIndex('Present', now)).to.equal(2026 * 12 + 9);
    expect(toMonthIndex('sometime', now)).to.be.undefined();
  });

  it('computes years of experience without double-counting overlaps', () => {
    expect(yearsOfExperience(SAMPLE_RESUME_DOCUMENT, now)).to.equal(8);
    const overlapping = {
      ...SAMPLE_RESUME_DOCUMENT,
      experience: [
        { ...SAMPLE_RESUME_DOCUMENT.experience[0], startDate: '2020-01', endDate: '2022-01' },
        { ...SAMPLE_RESUME_DOCUMENT.experience[1], startDate: '2021-01', endDate: '2023-01' },
      ],
    };
    expect(yearsOfExperience(overlapping, now)).to.equal(3);
  });

  it('renders to plain text with every section', () => {
    const text = resumeToText(SAMPLE_RESUME_DOCUMENT);
    expect(text).to.match(/Senior Software Engineer — Acme Payments \(2021-03 – Present\)/);
    expect(text).to.match(/SKILLS\nNode\.js, TypeScript/);
  });
});

describe('Upload helpers', () => {
  it('detects file types by content, not by name alone', () => {
    expect(detectType(minimalPdf(['x']), 'cv.docx')).to.equal('pdf');
    expect(detectType(Buffer.from('PK\u0003\u0004rest'), 'cv.docx')).to.equal('docx');
    expect(detectType(Buffer.from('PK\u0003\u0004rest'), 'cv.zip')).to.be.undefined();
    expect(detectType(Buffer.from('hello'), 'cv.txt')).to.equal('txt');
    expect(detectType(Buffer.from([0x00, 0x01, 0x02]), 'cv.txt')).to.be.undefined();
    expect(detectType(Buffer.from('MZ...'), 'cv.exe')).to.be.undefined();
  });

  it('normalises extracted whitespace', () => {
    expect(normaliseText('a\t\tb  c\r\n\r\n\r\n\r\nd \n e')).to.equal('a b c\n\nd\ne');
  });

  it('refuses storage keys that escape the root', async () => {
    const storage = new StorageService();
    await expect(storage.put('../etc/passwd', Buffer.from('x'))).to.be.rejectedWith(/Invalid storage key/);
    await expect(storage.get('/abs/path')).to.be.rejectedWith(/Invalid storage key/);
  });
});

describe('TextExtractionService', () => {
  const service = new TextExtractionService();

  it('extracts text from a PDF', async () => {
    const text = await service.extract(minimalPdf(SAMPLE_RESUME_TEXT.split('\n').filter(Boolean).slice(0, 8)), 'pdf');
    expect(text).to.match(/Priya Raman/);
    expect(text).to.match(/Acme Payments/);
  });

  it('falls back to pdf.js when pdftotext is not installed, even after fetch is initialised', async () => {
    process.env.PDFTOTEXT_PATH = '/nonexistent/pdftotext';
    new Response('initialise web streams, as any LLM call would');
    try {
      const text = await service.extract(minimalPdf(['Fallback Extraction Works', 'Line two of the fallback test document here']), 'pdf');
      expect(text).to.match(/Fallback Extraction Works/);
    } finally {
      delete process.env.PDFTOTEXT_PATH;
    }
  });

  it('extracts plain text', async () => {
    expect(await service.extract(Buffer.from(SAMPLE_RESUME_TEXT), 'txt')).to.match(/Anna University/);
  });

  it('rejects files with no readable text', async () => {
    await expect(service.extract(minimalPdf(['']), 'pdf')).to.be.rejectedWith(/No readable text/);
  });
});

describe('normalizeSkills', () => {
  it('splits category lines into one skill each', () => {
    expect(normalizeSkills(['Frontend: React.js, React 18, Redux Toolkit', 'Languages: JavaScript (ES6+), TypeScript, SQL'])).to.deepEqual([
      'React.js',
      'React 18',
      'Redux Toolkit',
      'JavaScript (ES6+)',
      'TypeScript',
      'SQL',
    ]);
  });

  it('keeps commas inside brackets and removes duplicates case-insensitively', () => {
    expect(normalizeSkills(['JavaScript (ES6+, ESNext)', 'Redis', 'Databases: MongoDB; redis'])).to.deepEqual(['JavaScript (ES6+, ESNext)', 'Redis', 'MongoDB']);
  });

  it('lets a grouped long skills line pass the schema', () => {
    const line = 'Backend: Node.js, Express.js, LoopBack 4, REST APIs, RESTful Services, Swagger/OpenAPI, JWT Authentication, RBAC, Webhooks';
    const parsed = ResumeDocumentSchema.parse({ contact: { name: 'A' }, skills: [line] });
    expect(parsed.skills).to.containEql('Swagger/OpenAPI');
    expect(parsed.skills.every(skill => skill.length <= 80)).to.be.true();
  });
});
