import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fromResumeForm, toResumeForm } from '@/common/resume/resumeForm';
import ProfilePage, { fromProfileForm, previewHiringQueries, toProfileForm } from '@/modules/Profile/ProfilePage';
import ResumesPage from '@/modules/Resumes/ResumesPage';
import ResumeReviewPage from '@/screens/ResumeReview/ResumeReviewPage';
import { DOCUMENT, PROFILE, RESUME, TEMPLATES } from './fixtures';
import { apiError, mockApi, renderPage } from './utils';

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:preview');
  globalThis.URL.revokeObjectURL = vi.fn();
});

describe('resume form conversion', () => {
  it('round-trips a document through the form model', () => {
    expect(fromResumeForm(toResumeForm(DOCUMENT))).toEqual({
      ...DOCUMENT,
      experience: DOCUMENT.experience.map(role => ({ ...role, location: undefined })),
      education: DOCUMENT.education.map(entry => ({ ...entry, startDate: undefined })),
    });
  });

  it('splits bullets by line, strips bullet characters and drops empty rows', () => {
    const form = toResumeForm(DOCUMENT);
    form.experience[0].bullets = '• First\n\n- Second  \n';
    form.experience.push({ company: '', title: '', bullets: '', startDate: '', endDate: '', location: '' });
    form.skills = 'Go, , Rust';
    const document = fromResumeForm(form);
    expect(document.experience).toHaveLength(1);
    expect(document.experience[0].bullets).toEqual(['First', 'Second']);
    expect(document.skills).toEqual(['Go', 'Rust']);
  });
});

describe('ResumesPage', () => {
  it('uploads a file and shows parsing progress until parsed', async () => {
    let status = 'PENDING';
    const { calls } = mockApi({
      'GET /resumes': () => [{ ...RESUME, parseStatus: status }],
      'POST /resumes': () => ({ ...RESUME, parseStatus: 'PENDING' }),
    });
    renderPage(<ResumesPage />);
    expect(await screen.findByText(/Reading your resume/)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.upload(screen.getByLabelText('Choose resume file'), new File(['%PDF-1.4'], 'cv.pdf', { type: 'application/pdf' }));
    await waitFor(() => expect(calls.some(call => call.key === 'POST /resumes')).toBe(true));

    status = 'PARSED';
    await waitFor(() => expect(screen.queryByText(/Reading your resume/)).not.toBeInTheDocument(), { timeout: 6000 });
    expect(screen.getByText('Parsed')).toBeInTheDocument();
  });

  it('shows the error for an unsupported file', async () => {
    mockApi({ 'GET /resumes': [], 'POST /resumes': apiError(422, 'FILE_INVALID') });
    renderPage(<ResumesPage />);
    const user = userEvent.setup({ applyAccept: false });
    await user.upload(await screen.findByLabelText('Choose resume file'), new File(['MZ'], 'x.exe'));
    expect(await screen.findByText(/isn't supported/)).toBeInTheDocument();
  });
});

describe('ResumeReviewPage', () => {
  it('saves corrections as a structured document', async () => {
    const { calls } = mockApi({
      'GET /resumes/r1': RESUME,
      'GET /resume-templates': TEMPLATES,
      'PATCH /resumes/r1/document': ({ body }) => ({ ...RESUME, document: body, userEdited: true }),
    });
    vi.spyOn(globalThis, 'fetch');
    renderPage(<ResumeReviewPage />, { route: '/resumes/r1', path: '/resumes/:id' });
    const user = userEvent.setup();

    const summary = await screen.findByLabelText('Summary');
    await user.clear(summary);
    await user.type(summary, 'Backend engineer for payments.');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls.some(call => call.key === 'PATCH /resumes/r1/document')).toBe(true));
    const sent = calls.find(call => call.key === 'PATCH /resumes/r1/document').body;
    expect(sent.summary).toBe('Backend engineer for payments.');
    expect(sent.experience[0].bullets).toEqual(DOCUMENT.experience[0].bullets);
    expect(await screen.findByText(/Saved/)).toBeInTheDocument();
  });

  it('asks before reparsing over corrections', async () => {
    const { calls } = mockApi({
      'GET /resumes/r1': { ...RESUME, userEdited: true },
      'GET /resume-templates': TEMPLATES,
      'POST /resumes/r1/reparse': ({ url }) => (url.search.includes('force=true') ? { ...RESUME, parseStatus: 'PENDING' } : apiError(400, 'RESUME_HAS_EDITS')),
    });
    renderPage(<ResumeReviewPage />, { route: '/resumes/r1', path: '/resumes/:id' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Read file again' }));
    const dialog = await screen.findByRole('dialog', { name: 'Replace your corrections?' });
    await user.click(within(dialog).getByRole('button', { name: 'Read again and replace' }));
    await waitFor(() => expect(calls.filter(call => call.key === 'POST /resumes/r1/reparse').map(call => call.search)).toEqual(['', '?force=true']));
  });
});

describe('ProfilePage', () => {
  it('converts lists, nulls empty fields and keeps caps', () => {
    const values = { ...toProfileForm(PROFILE), location: '  ', targetTitles: 'A, B\nC', hiringQueryTitle: ' ', hiringQueryLocation: '' };
    expect(fromProfileForm(values)).toMatchObject({
      targetTitles: ['A', 'B', 'C'],
      location: null,
      hiringQueryTemplate: null,
      hiringQueryTitle: null,
      hiringQueryLocation: null,
      dailyCaps: { tailor: 10, apply: 15, outreach: 10 },
    });
  });

  it('previews hiring queries from the boxes, falling back to the profile', () => {
    const base = { targetTitles: 'Backend Developer, MERN Developer', location: 'Coimbatore' };
    expect(previewHiringQueries(base)).toEqual(['"hiring" AND "Backend Developer" AND "Coimbatore"', '"hiring" AND "MERN Developer" AND "Coimbatore"']);
    expect(previewHiringQueries({ ...base, hiringQueryTitle: 'Node.js Developer', hiringQueryLocation: 'Bengaluru' })).toEqual(['"hiring" AND "Node.js Developer" AND "Bengaluru"']);
    expect(previewHiringQueries({ ...base, location: '' })).toEqual(['"hiring" AND "Backend Developer"', '"hiring" AND "MERN Developer"']);
    expect(previewHiringQueries({ targetTitles: 'MERN Stack Developer — Payroll & HRMS SaaS Platform\nBackend Developer — GoldArk (Gold Savings App)', location: 'Coimbatore, Tamil Nadu' })).toEqual([
      '"hiring" AND "MERN Stack Developer" AND "Coimbatore"',
      '"hiring" AND "Backend Developer" AND "Coimbatore"',
    ]);
    expect(previewHiringQueries({ ...base, location: '', remoteOnly: true })[0]).toBe('"hiring" AND "Backend Developer" AND "remote"');
  });

  it('saves the hiring-post title and location boxes', async () => {
    const { calls } = mockApi({ 'GET /profile': PROFILE, 'GET /resume-templates': TEMPLATES, 'PUT /profile': ({ body }) => ({ ...PROFILE, ...body }) });
    renderPage(<ProfilePage />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Title to search'), 'Node.js Developer, MERN Developer');
    await user.type(screen.getByLabelText('Location to search'), 'Bengaluru');
    expect(screen.getByText('"hiring" AND "MERN Developer" AND "Bengaluru"')).toBeInTheDocument();
    await user.click(screen.getByLabelText('Start the assisted apply as soon as I approve a tailored resume'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some(call => call.key === 'PUT /profile')).toBe(true));
    expect(calls.find(call => call.key === 'PUT /profile').body).toMatchObject({
      hiringQueryTemplate: null,
      hiringQueryTitle: 'Node.js Developer, MERN Developer',
      hiringQueryLocation: 'Bengaluru',
      autoApplyOnApprove: true,
      location: 'Chennai',
    });
  });
});
