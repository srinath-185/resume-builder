import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import JobSourcesPage from '@/modules/Jobs/JobSourcesPage';
import JobsPage from '@/modules/Jobs/JobsPage';
import { apiError, mockApi, renderPage } from './utils';

const JOB = {
  id: 'j1',
  title: 'Senior Backend Engineer',
  company: 'Globex',
  location: 'Chennai',
  seenOn: ['jsearch', 'adzuna'],
  status: 'NEW',
  matchStatus: 'SCORED',
  matchScore: 88,
  matchReason: 'Strong Node.js and payments fit',
  matchedSkills: ['Node.js'],
  missingSkills: ['Kubernetes'],
  applyOptions: [{ publisher: 'LinkedIn', url: 'https://linkedin.test/1' }],
  url: 'https://jobs.test/1',
  description: 'Build payment services.',
};

describe('JobsPage', () => {
  it('lists scored jobs and filters by status and search', async () => {
    const { calls } = mockApi({ 'GET /jobs': { items: [JOB], total: 1, page: 1, limit: 20 } });
    renderPage(<JobsPage />);
    const user = userEvent.setup();
    expect(await screen.findByText('Senior Backend Engineer')).toBeInTheDocument();
    expect(screen.getByText('88')).toBeInTheDocument();
    expect(screen.getByText('jsearch, adzuna')).toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Shortlisted' }));
    await user.type(screen.getByLabelText('Search jobs'), 'glob');
    await waitFor(() => expect(calls.at(-1).search).toBe('?status=SHORTLISTED&q=glob&page=1&limit=20'));
  });

  it('shows details, gaps and apply links in the job view', async () => {
    mockApi({ 'GET /jobs': { items: [JOB], total: 1, page: 1, limit: 20 }, 'GET /jobs/j1': JOB });
    renderPage(<JobsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByText('Senior Backend Engineer'));
    const dialog = await screen.findByRole('dialog', { name: 'Senior Backend Engineer — Globex' });
    expect(within(dialog).getByText('Kubernetes')).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: /LinkedIn/ })).toHaveAttribute('href', 'https://linkedin.test/1');
  });

  it('starts tailoring with instructions and opens the review', async () => {
    const { calls } = mockApi({
      'GET /jobs': { items: [JOB], total: 1, page: 1, limit: 20 },
      'POST /jobs/j1/tailor': { id: 'a1', status: 'TAILORING' },
    });
    const { router } = renderPage(<JobsPage />, { route: '/jobs', path: '/jobs', extraRoutes: [{ path: '/applications/:id', element: <p>review</p> }] });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tailor resume' }));
    await user.type(screen.getByLabelText('Instructions (optional)'), 'Emphasise payments');
    await user.click(screen.getByRole('button', { name: 'Draft tailored resume' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/applications/a1'));
    expect(calls.find(call => call.key === 'POST /jobs/j1/tailor').body).toEqual({ instructions: 'Emphasise payments' });
  });

  it('shows the cap error when tailoring is refused', async () => {
    mockApi({ 'GET /jobs': { items: [JOB], total: 1, page: 1, limit: 20 }, 'POST /jobs/j1/tailor': apiError(400, 'TAILOR_DAILY_CAP_REACHED') });
    renderPage(<JobsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Tailor resume' }));
    await user.click(screen.getByRole('button', { name: 'Draft tailored resume' }));
    expect(await screen.findByText("You've reached today's tailoring limit.")).toBeInTheDocument();
  });

  it('reports a rate-limited manual search', async () => {
    mockApi({ 'GET /jobs': { items: [], total: 0, page: 1, limit: 20 }, 'POST /jobs/discover': apiError(429, 'DISCOVERY_TOO_SOON') });
    renderPage(<JobsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search now' }));
    expect(await screen.findByText(/A search ran recently/)).toBeInTheDocument();
  });

  it('clears the searching banner when the run finishes and reports a failed source', async () => {
    let finished = false;
    mockApi({
      'GET /jobs': { items: [], total: 0, page: 1, limit: 20 },
      'GET /job-sources': () => [
        finished
          ? { key: 'jsearch', label: 'JSearch', configured: true, enabled: true, lastRunAt: new Date().toISOString(), lastFound: 0, lastError: 'jsearch responded 404' }
          : { key: 'jsearch', label: 'JSearch', configured: true, enabled: true },
      ],
      'POST /jobs/discover': () => {
        finished = true;
        return { jobId: 'd1' };
      },
    });
    renderPage(<JobsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search now' }));
    expect(await screen.findByText('JSearch failed: jsearch responded 404')).toBeInTheDocument();
    expect(screen.queryByText(/Searching…/)).not.toBeInTheDocument();
  });
});

describe('JobSourcesPage', () => {
  it('toggles a source and disables unconfigured ones', async () => {
    const sources = [
      { key: 'jsearch', label: 'JSearch', description: 'Aggregator', official: true, configured: true, enabled: true },
      { key: 'apify-linkedin', label: 'LinkedIn (via Apify)', description: 'Scraper', official: false, configured: false, enabled: false },
    ];
    const { calls } = mockApi({ 'GET /job-sources': () => sources, 'PUT /job-sources/jsearch': ({ body }) => ({ ...sources[0], ...body }) });
    renderPage(<JobSourcesPage />);
    const user = userEvent.setup();
    expect(await screen.findByLabelText('Use LinkedIn (via Apify)')).toBeDisabled();
    await user.click(screen.getByLabelText('Use JSearch'));
    await waitFor(() => expect(calls.find(call => call.key === 'PUT /job-sources/jsearch').body).toEqual({ enabled: false }));
  });
});
