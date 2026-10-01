import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { APP_ROUTES } from '@/app/routes';
import { RequireRole } from '@/app/router';
import AppLayout from '@/layouts/AppLayout';
import UsersPage from '@/modules/Admin/UsersPage';
import MailSettingsPage from '@/modules/Settings/MailSettingsPage';
import { apiError, mockApi, renderPage } from './utils';

const asRole = role => ({ token: 't', user: { id: 'me', name: 'Me', email: 'me@example.test', role } });
const usersRoute = APP_ROUTES.find(route => route.path === '/admin/users');

describe('Administration navigation', () => {
  it('hides the administration section from regular users', async () => {
    mockApi({ 'GET /auth/me': asRole('user').user });
    renderPage(<AppLayout />, { auth: asRole('user') });
    expect(await screen.findByRole('link', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByText('Administration')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();
  });

  it('shows it once /auth/me reports an admin role, even if the stored session predates it', async () => {
    mockApi({ 'GET /auth/me': asRole('admin').user });
    const { store } = renderPage(<AppLayout />, { auth: asRole(undefined) });
    expect(await screen.findByRole('link', { name: 'Users' })).toBeInTheDocument();
    expect(store.getState().auth.user.role).toBe('admin');
  });

  it('renders "not found" for an admin page opened by a regular user', () => {
    renderPage(<RequireRole route={usersRoute}>{usersRoute.element}</RequireRole>, { auth: asRole('user') });
    expect(screen.getByText('Page not found')).toBeInTheDocument();
  });
});

describe('UsersPage', () => {
  const people = [
    { id: 'me', name: 'Me', email: 'me@example.test', role: 'admin', status: 'active' },
    { id: 'u1', name: 'Priya', email: 'priya@example.test', role: 'user', status: 'active' },
    { id: 'a2', name: 'Other admin', email: 'boss@example.test', role: 'admin', status: 'active' },
  ];

  it('lets an admin disable a user but not touch their own or another admin account', async () => {
    const { calls } = mockApi({
      'GET /admin/users': { items: people, total: 3, page: 1, limit: 25 },
      'PATCH /admin/users/u1/status': { ...people[1], status: 'disabled' },
    });
    renderPage(<UsersPage />, { auth: asRole('admin') });
    const user = userEvent.setup();

    const rows = await screen.findAllByRole('row');
    const row = email => rows.find(element => within(element).queryByText(email));
    expect(within(row('me@example.test')).queryByRole('button')).toBeNull();
    expect(within(row('boss@example.test')).queryByRole('button')).toBeNull();
    // Only a superadmin gets the role picker.
    expect(screen.queryByLabelText('Role of priya@example.test')).not.toBeInTheDocument();

    await user.click(within(row('priya@example.test')).getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(calls.some(call => call.key === 'PATCH /admin/users/u1/status')).toBe(true));
    expect(calls.find(call => call.key === 'PATCH /admin/users/u1/status').body).toEqual({ status: 'disabled' });
  });

  it('lets a superadmin change roles and shows the API refusal', async () => {
    const { calls } = mockApi({
      'GET /admin/users': { items: people, total: 3, page: 1, limit: 25 },
      'PATCH /admin/users/a2/role': apiError(422, 'ADMIN_SELF_CHANGE'),
    });
    renderPage(<UsersPage />, { auth: asRole('superadmin') });
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByLabelText('Role of boss@example.test'), 'user');
    expect(await screen.findByText("You can't change your own role or status.")).toBeInTheDocument();
    expect(calls.find(call => call.key === 'PATCH /admin/users/a2/role').body).toEqual({ role: 'user' });
  });
});

describe('Gmail sign-in confirmation', () => {
  it('claims the pending grant with the session, then drops it from the address bar', async () => {
    const { calls } = mockApi({
      'GET /mail-connector': { connected: true, gmailAvailable: true, provider: 'GMAIL', senderEmail: 'me@gmail.test' },
      'POST /mail-connector/gmail/confirm': { connected: true, gmailAvailable: true, provider: 'GMAIL', senderEmail: 'me@gmail.test' },
    });
    const { router } = renderPage(<MailSettingsPage />, { route: '/settings/mail?gmail=confirm&pending=v1%3Asealed', path: '/settings/mail' });
    expect(await screen.findByText('Gmail connected.')).toBeInTheDocument();
    expect(calls.filter(call => call.key === 'POST /mail-connector/gmail/confirm').map(call => call.body)).toEqual([{ pending: 'v1:sealed' }]);
    expect(router.state.location.search).toBe('?gmail=connected');
  });
});

describe('isSafeNext', () => {
  it('allows same-site paths only', async () => {
    const { isSafeNext } = await import('@/screens/Auth/AuthForm');
    for (const ok of ['/', '/jobs', '/applications/1?tab=diff']) expect(isSafeNext(ok)).toBe(true);
    for (const bad of [null, '', 'jobs', '//evil.example', '/\\evil.example', '/\\/evil.example', '/\t/evil.example', 'https://evil.example', 'javascript:alert(1)']) {
      expect(isSafeNext(bad)).toBe(false);
    }
  });
});
