import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { api } from '@/app/api/baseApi';
import errors from '@/common/locales/en/errors.json';
import { createModuleComponent } from '@/common/crud/ModuleLoader';
import Login from '@/screens/Auth/Login';
import { apiError, mockApi, renderPage } from './utils';

describe('error message catalogue', () => {
  it('has an English message for every backend error code', () => {
    const source = readFileSync(resolve(__dirname, '../../../backend/src/common/errors/error-codes.ts'), 'utf8');
    const codes = [...source.matchAll(/^\s+([A-Z_]+): '([A-Z_]+)',$/gm)].map(match => match[2]);
    expect(codes.length).toBeGreaterThan(50);
    const missing = codes.filter(code => !(code in errors));
    expect(missing).toEqual([]);
  });
});

describe('Login', () => {
  it('validates, signs in, stores the session and leaves the login page', async () => {
    const { calls } = mockApi({
      'POST /auth/login': ({ body }) =>
        body.password === 'right password' ? { token: 'jwt-1', user: { id: 'u1', name: 'Priya', email: body.email } } : apiError(401, 'INVALID_CREDENTIALS'),
    });
    const { store, router } = renderPage(<Login />, { route: '/login?next=/jobs', auth: { token: null, user: null }, extraRoutes: [{ path: '/jobs', element: <p>jobs page</p> }] });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email'), 'priya@example.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect.')).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Password'));
    await user.type(screen.getByLabelText('Password'), 'right password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/jobs'));
    expect(store.getState().auth.token).toBe('jwt-1');
    expect(JSON.parse(localStorage.getItem('rb.session')).token).toBe('jwt-1');
    expect(calls.at(-1).body).toEqual({ email: 'priya@example.test', password: 'right password' });
  });

  it('ignores an off-site redirect target', async () => {
    mockApi({ 'POST /auth/login': { token: 't', user: { id: 'u1', name: 'P', email: 'p@x.io' } } });
    const { router } = renderPage(<Login />, { route: '/login?next=//evil.example', auth: { token: null, user: null }, extraRoutes: [{ path: '/', element: <p>home</p> }] });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'p@x.io');
    await user.type(screen.getByLabelText('Password'), 'x');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('API envelope and session', () => {
  it('logs out and clears cached data on a 401 for an authenticated user', async () => {
    mockApi({ 'GET /auth/me': apiError(401, 'TOKEN_INVALID') });
    const { store } = renderPage(<p>x</p>);
    await store.dispatch(api.endpoints.me.initiate());
    expect(store.getState().auth.token).toBeNull();
  });
});

const items = api.injectEndpoints({
  endpoints: build => ({
    listThings: build.query({ query: () => '/things', providesTags: ['Contact'] }),
    createThing: build.mutation({ query: body => ({ url: '/things', method: 'POST', body }), invalidatesTags: ['Contact'] }),
    removeThing: build.mutation({ query: id => ({ url: `/things/${id}`, method: 'DELETE' }), invalidatesTags: ['Contact'] }),
  }),
});

describe('createModuleComponent', () => {
  const Things = createModuleComponent({
    title: 'Things',
    useList: items.useListThingsQuery,
    useCreate: items.useCreateThingMutation,
    useRemove: items.useRemoveThingMutation,
    columns: [{ key: 'name', header: 'Name' }],
    fields: [{ name: 'name', label: 'Name' }],
    schema: z.object({ name: z.string().min(2, 'Too short') }),
    createLabel: 'New thing',
  });

  it('lists, validates and creates from configuration', async () => {
    const things = [{ id: '1', name: 'Alpha' }];
    const { calls } = mockApi({
      'GET /things': () => things,
      'POST /things': ({ body }) => {
        things.push({ id: '2', ...body });
        return things.at(-1);
      },
    });
    renderPage(<Things />);
    const user = userEvent.setup();
    expect(await screen.findByText('Alpha')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'New thing' }));
    await user.type(screen.getByLabelText('Name'), 'B');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Too short')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Name'), 'eta');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Beta')).toBeInTheDocument();
    expect(calls.find(call => call.key === 'POST /things').body).toEqual({ name: 'Beta' });
  });
});
