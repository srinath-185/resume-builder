import { render } from '@testing-library/react';
import { Provider } from 'react-redux';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { vi } from 'vitest';
import { makeStore } from '@/app/store';

/**
 * Renders `ui` at `route` with a fresh store. `routes` lets a test mount a
 * page under its real path so useParams works.
 */
export function renderPage(ui, { route = '/', path = '*', auth = { token: 'test-token', user: { id: 'u1', name: 'Priya', email: 'p@example.test' } }, extraRoutes = [] } = {}) {
  const store = makeStore({ auth });
  const router = createMemoryRouter([{ path, element: ui }, ...extraRoutes], { initialEntries: [route] });
  const utils = render(
    <Provider store={store}>
      <RouterProvider router={router} future={{ v7_startTransition: true }} />
    </Provider>,
  );
  return { ...utils, store, router };
}

/**
 * Stubs fetch with a route table: { 'GET /resumes': body | (request) => body }.
 * Bodies are wrapped in the API success envelope unless they set `__raw`.
 */
export function mockApi(routes) {
  const calls = [];
  const fetchMock = vi.fn(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    const key = `${request.method} ${url.pathname.replace(/^\/api/, '')}`;
    const bodyText = request.method === 'GET' || request.method === 'HEAD' ? undefined : await request.clone().text();
    const body = bodyText ? safeJson(bodyText) : undefined;
    calls.push({ key, search: url.search, body });
    const handler = routes[key];
    if (handler === undefined) return json(404, { success: false, error: { code: 'NOT_FOUND', message: `No mock for ${key}` } });
    const value = typeof handler === 'function' ? handler({ body, url }) : handler;
    if (value && value.__status) return json(value.__status, value.body);
    return json(200, { success: true, data: value });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function apiError(status, code, message = code, details) {
  return { __status: status, body: { success: false, error: { code, message, details } } };
}
