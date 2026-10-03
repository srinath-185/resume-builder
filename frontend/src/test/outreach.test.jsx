import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import ComposePage from '@/modules/Outreach/ComposePage';
import ContactsPage from '@/modules/Outreach/ContactsPage';
import HiringPostsPage from '@/modules/Outreach/HiringPostsPage';
import OutreachPage from '@/modules/Outreach/OutreachPage';
import MailSettingsPage from '@/modules/Settings/MailSettingsPage';
import { apiError, mockApi, renderPage } from './utils';

const APPROVED_APP = { id: 'a1', status: 'APPROVED', jobTitle: 'Senior Backend Engineer', company: 'Globex', history: [], updatedAt: '2026-10-01T10:00:00Z' };
const DRAFT = { id: 'm1', status: 'DRAFT', toEmail: 'talent@globex.io', subject: 'Application: SRE', body: 'Hi Asha,\n\nNote', sequence: 1, attachmentName: 'resume-Globex.pdf', createdAt: '2026-10-01T10:00:00Z', updatedAt: '2026-10-01T10:00:00Z' };

describe('ComposePage', () => {
  it('drafts an email for an approved application and opens it in the outbox', async () => {
    const { calls } = mockApi({
      'GET /applications': [APPROVED_APP, { ...APPROVED_APP, id: 'a2', status: 'REVIEW_PENDING', jobTitle: 'Not approved' }],
      'GET /contacts': [],
      'GET /outreach-templates': [{ id: 't1', name: 'Application note' }],
      'GET /mail-connector': { connected: true },
      'POST /outreach': { ...DRAFT },
    });
    const { router } = renderPage(<ComposePage />, { route: '/outreach/new?applicationId=a1&email=talent@globex.io&name=Asha&hiringPostId=p1', path: '/outreach/new', extraRoutes: [{ path: '/outreach', element: <p>outbox</p> }] });
    const user = userEvent.setup();

    const job = await screen.findByLabelText('Job');
    expect(within(job).queryByText(/Not approved/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Personalise with AI/));
    await user.click(screen.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(router.state.location.search).toBe('?open=m1'));
    expect(calls.find(call => call.key === 'POST /outreach').body).toEqual({ applicationId: 'a1', email: 'talent@globex.io', name: 'Asha', hiringPostId: 'p1', personalise: true });
  });

  it('explains that approval comes first', async () => {
    mockApi({ 'GET /applications': [], 'GET /contacts': [], 'GET /outreach-templates': [], 'GET /mail-connector': { connected: false } });
    renderPage(<ComposePage />);
    expect(await screen.findByText(/Approve a tailored resume first/)).toBeInTheDocument();
    expect(screen.getByText(/Connect your mailbox before sending/)).toBeInTheDocument();
  });
});

describe('OutreachPage', () => {
  it('reviews a draft, saves edits and sends', async () => {
    let message = { ...DRAFT };
    const { calls } = mockApi({
      'GET /outreach': () => [message],
      'GET /outreach/m1': () => message,
      'PUT /outreach/m1': ({ body }) => (message = { ...message, ...body, updatedAt: '2026-10-01T10:01:00Z' }),
      'POST /outreach/m1/send': () => (message = { ...message, status: 'QUEUED' }),
    });
    renderPage(<OutreachPage />, { route: '/outreach?open=m1', path: '/outreach' });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Email to talent@globex.io' });
    expect(within(dialog).getByText('resume-Globex.pdf')).toBeInTheDocument();
    const subject = within(dialog).getByLabelText('Subject');
    await user.clear(subject);
    await user.type(subject, 'Edited subject');
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(calls.map(call => call.key)).toEqual(expect.arrayContaining(['PUT /outreach/m1', 'POST /outreach/m1/send'])));
    expect(calls.find(call => call.key === 'PUT /outreach/m1').body.subject).toBe('Edited subject');
    expect(await within(dialog).findByText('Sending…')).toBeInTheDocument();
  });

  it('shows why a send was refused', async () => {
    mockApi({ 'GET /outreach': [DRAFT], 'GET /outreach/m1': DRAFT, 'POST /outreach/m1/send': apiError(400, 'OUTREACH_DUPLICATE') });
    renderPage(<OutreachPage />, { route: '/outreach?open=m1', path: '/outreach' });
    const user = userEvent.setup();
    const dialog = await screen.findByRole('dialog', { name: 'Email to talent@globex.io' });
    await user.click(within(dialog).getByRole('button', { name: 'Send' }));
    expect(await within(dialog).findByText('You already emailed this person about this job.')).toBeInTheDocument();
  });
});

describe('HiringPostsPage', () => {
  it('shows the queries, posts with emails, and links an email to compose', async () => {
    mockApi({
      'GET /hiring-posts/queries': { queries: ['"hiring" AND "SRE" AND "Pune"'] },
      'GET /hiring-posts/sources': [{ key: 'serpapi-posts', label: 'Google', description: 'd', official: true, configured: true, enabled: true }],
      'GET /hiring-posts': { items: [{ id: 'p1', author: 'Jane Doe', title: 'SRE', text: 'We are hiring SREs', extractedEmails: ['jobs@acme.io'], postUrl: 'https://linkedin.test/posts/1', status: 'NEW' }], total: 1, page: 1, limit: 10 },
    });
    const { router } = renderPage(<HiringPostsPage />, { route: '/hiring-posts', path: '/hiring-posts', extraRoutes: [{ path: '/outreach/new', element: <p>compose</p> }] });
    const user = userEvent.setup();
    expect(await screen.findByText('"hiring" AND "SRE" AND "Pune"')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'jobs@acme.io' }));
    await waitFor(() => expect(router.state.location.search).toBe('?email=jobs%40acme.io&name=Jane%20Doe&hiringPostId=p1'));
  });

  it('searches stored posts and pages through them', async () => {
    const post = n => ({ id: `p${n}`, author: `Author ${n}`, text: `Post ${n}`, extractedEmails: [], postUrl: `https://linkedin.test/posts/${n}`, status: 'NEW' });
    const { calls } = mockApi({
      'GET /hiring-posts/queries': { queries: [] },
      'GET /hiring-posts/sources': [{ key: 'serpapi-posts', label: 'Google', description: 'd', official: true, configured: true, enabled: true }],
      'GET /hiring-posts': ({ url }) => {
        const page = Number(url.searchParams.get('page'));
        return { items: [post(page)], total: 15, page, limit: 10 };
      },
    });
    renderPage(<HiringPostsPage />, { route: '/hiring-posts', path: '/hiring-posts' });
    const user = userEvent.setup();
    expect(await screen.findByText('Post 1')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Post 2')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Search posts' }), 'react');
    await waitFor(() => expect(calls.filter(call => call.key === 'GET /hiring-posts').at(-1).search).toBe('?status=NEW&q=react&page=1&limit=10'));
  });

  it('disables searching and explains why when no post source can run', async () => {
    mockApi({
      'GET /hiring-posts/queries': { queries: ['"hiring" AND "SRE"'] },
      'GET /hiring-posts/sources': [{ key: 'serpapi-posts', label: 'Google', description: 'd', official: true, configured: false, enabled: true }],
      'GET /hiring-posts': { items: [], total: 0, page: 1, limit: 10 },
    });
    renderPage(<HiringPostsPage />, { route: '/hiring-posts', path: '/hiring-posts' });
    expect(await screen.findByText(/No post source can run yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search posts' })).toBeDisabled();
  });
});

describe('ContactsPage', () => {
  it('adds a contact and marks one do-not-contact', async () => {
    const contacts = [{ id: 'c1', email: 'a@globex.io', name: 'Asha', source: 'POST', doNotContact: false }];
    const { calls } = mockApi({
      'GET /contacts': () => contacts,
      'POST /contacts': ({ body }) => {
        contacts.push({ id: 'c2', source: 'MANUAL', doNotContact: false, ...body });
        return contacts.at(-1);
      },
      'PATCH /contacts/c1': ({ body }) => Object.assign(contacts[0], body),
    });
    renderPage(<ContactsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Add contact' }));
    await user.type(screen.getByLabelText('Email'), 'lead@hooli.io');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('lead@hooli.io')).toBeInTheDocument();
    expect(calls.find(call => call.key === 'POST /contacts').body).toEqual({ email: 'lead@hooli.io' });

    const row = screen.getByText('a@globex.io').closest('tr');
    await user.click(within(row).getByRole('button', { name: 'Edit' }));
    await user.click(screen.getByLabelText('Do not contact'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.find(call => call.key === 'PATCH /contacts/c1').body).toEqual({ name: 'Asha', company: null, doNotContact: true }));
  });
});

describe('MailSettingsPage', () => {
  it('starts Google sign-in and verifies SMTP', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: window.location.origin });
    const { calls } = mockApi({
      'GET /mail-connector': { connected: false, gmailAvailable: true },
      'POST /mail-connector/gmail/start': { url: 'https://accounts.google.test/auth' },
      'PUT /mail-connector/smtp': apiError(400, 'MAIL_CONNECT_FAILED', 'SMTP login failed'),
    });
    renderPage(<MailSettingsPage />, { route: '/settings/mail?gmail=error', path: '/settings/mail' });
    const user = userEvent.setup();
    expect(await screen.findByText(/Gmail sign-in did not complete/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://accounts.google.test/auth'));

    await user.type(screen.getByLabelText('Username'), 'priya');
    await user.type(screen.getByLabelText('Password or App Password'), 'app-pass');
    await user.type(screen.getByLabelText('Send as (email)'), 'priya@example.test');
    await user.click(screen.getByRole('button', { name: 'Verify and save' }));
    expect(await screen.findByText("Couldn't connect to your mailbox.")).toBeInTheDocument();
    expect(calls.find(call => call.key === 'PUT /mail-connector/smtp').body).toEqual({ host: 'smtp.gmail.com', port: 465, secure: true, user: 'priya', pass: 'app-pass', senderEmail: 'priya@example.test' });
  });
});
