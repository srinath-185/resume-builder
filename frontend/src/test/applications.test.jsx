import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ApplicationsPage from '@/modules/Applications/ApplicationsPage';
import ApplicationReviewPage from '@/screens/ApplicationReview/ApplicationReviewPage';
import { DOCUMENT } from './fixtures';
import { mockApi, renderPage } from './utils';

beforeEach(() => {
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
});

const LISTING = { id: 'j1', title: 'Senior Backend Engineer', company: 'Globex', location: 'Chennai', url: 'https://jobs.test/1', description: 'Build payments in Node.js and Kafka.' };

function review(overrides = {}) {
  const variant = {
    id: 'v1',
    generation: 1,
    status: 'DRAFT',
    templateId: 'classic',
    document: { ...DOCUMENT, summary: 'Tailored summary about Kafka.' },
    coverNote: 'I build payment services.',
    formAnswers: [{ question: 'Why are you a good fit?', answer: 'Payments experience.' }],
    changes: [{ path: 'summary', before: 'Builds payment services.', after: 'Tailored summary about Kafka.', reason: 'Targets the payments role' }],
    keywordCoverage: { keywords: ['Node.js', 'Kafka', 'Kubernetes'], before: 33, after: 67, missing: ['Kubernetes'] },
    factCheck: { passed: true, violations: [] },
    generatedBy: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    updatedAt: '2026-10-01T10:00:00Z',
    ...overrides.variant,
  };
  return {
    application: { id: 'a1', status: 'REVIEW_PENDING', jobListingId: 'j1', history: [{ from: 'MATCHED', to: 'TAILORING', at: '2026-10-01T09:00:00Z' }], updatedAt: '2026-10-01T10:00:00Z', ...overrides.application },
    listing: LISTING,
    variant,
    master: { resumeId: 'r1', document: DOCUMENT },
  };
}

describe('ApplicationReviewPage', () => {
  it('shows changes with reasons, coverage and fact-check, then approves', async () => {
    let current = review();
    const { calls } = mockApi({
      'GET /applications/a1': () => current,
      'POST /applications/a1/approve': () => {
        current = review({ application: { status: 'APPROVED' } });
        return current.application;
      },
    });
    renderPage(<ApplicationReviewPage />, { route: '/applications/a1', path: '/applications/:id' });
    const user = userEvent.setup();

    expect(await screen.findByText('Senior Backend Engineer — Globex')).toBeInTheDocument();
    expect(screen.getByText('Targets the payments role')).toBeInTheDocument();
    expect(screen.getByText('Tailored summary about Kafka.')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes')).toBeInTheDocument();
    expect(screen.getByText('Fact-check passed')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some(call => call.key === 'POST /applications/a1/approve')).toBe(true));
    expect(await screen.findByRole('button', { name: 'Apply for me' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('blocks approval while the fact-check fails and highlights the problem in the editor', async () => {
    mockApi({
      'GET /applications/a1': review({
        variant: { factCheck: { passed: false, violations: [{ path: 'experience[0].bullets[0]', kind: 'new_number', value: '60' }] } },
      }),
    });
    renderPage(<ApplicationReviewPage />, { route: '/applications/a1', path: '/applications/:id' });
    const user = userEvent.setup();
    expect(await screen.findByText('Fix these before approving')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'Edit tailored resume' }));
    expect(screen.getAllByText(/Number not in your resume: “60”/).length).toBeGreaterThan(1);
  });

  it('saves edits to the draft and re-checks', async () => {
    const { calls } = mockApi({ 'GET /applications/a1': review(), 'PUT /applications/a1/variant': () => review() });
    renderPage(<ApplicationReviewPage />, { route: '/applications/a1', path: '/applications/:id' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Edit tailored resume' }));
    const summary = screen.getByLabelText('Summary');
    await user.clear(summary);
    await user.type(summary, 'Edited summary');
    await user.click(screen.getByRole('button', { name: 'Save and re-check' }));
    await waitFor(() => expect(calls.find(call => call.key === 'PUT /applications/a1/variant')?.body.document.summary).toBe('Edited summary'));
  });

  it('regenerates with instructions', async () => {
    const { calls } = mockApi({ 'GET /applications/a1': review(), 'POST /applications/a1/regenerate': { id: 'a1', status: 'TAILORING' } });
    renderPage(<ApplicationReviewPage />, { route: '/applications/a1', path: '/applications/:id' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Regenerate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Draft a new version' });
    await user.type(within(dialog).getByLabelText('What should change? (optional)'), 'Shorter');
    await user.click(within(dialog).getByRole('button', { name: 'Regenerate' }));
    await waitFor(() => expect(calls.find(call => call.key === 'POST /applications/a1/regenerate').body).toEqual({ instructions: 'Shorter' }));
  });

  it('explains why an apply needs attention and offers a retry', async () => {
    const { calls } = mockApi({
      'GET /applications/a1': review({ application: { status: 'NEEDS_REVIEW', method: 'ats-form', lastError: 'Some required questions have no approved answer\n• Expected salary' } }),
      'POST /applications/a1/apply': { id: 'a1', status: 'APPLYING' },
    });
    renderPage(<ApplicationReviewPage />, { route: '/applications/a1', path: '/applications/:id' });
    const user = userEvent.setup();
    expect(await screen.findByText('This needs you')).toBeInTheDocument();
    expect(screen.getByText(/Expected salary/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try applying again' }));
    await waitFor(() => expect(calls.some(call => call.key === 'POST /applications/a1/apply')).toBe(true));
  });
});

describe('ApplicationsPage', () => {
  it('opens on the review queue and switches tabs', async () => {
    const { calls } = mockApi({
      'GET /applications': ({ url }) => (url.search === '?status=REVIEW_PENDING' ? [{ id: 'a1', status: 'REVIEW_PENDING', history: [], autoTailored: true, updatedAt: '2026-10-01T10:00:00Z' }] : []),
    });
    renderPage(<ApplicationsPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('auto-drafted')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Applied' }));
    await waitFor(() => expect(calls.at(-1).search).toBe('?status=APPLIED'));
  });
});
