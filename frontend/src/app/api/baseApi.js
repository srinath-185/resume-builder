import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';
import { loggedOut } from '@/app/authSlice';

/** Absolute so it also works where `fetch` has no document base (tests). Same-origin in the browser via the dev proxy. */
export const API_BASE = typeof window !== 'undefined' && window.location?.origin ? `${window.location.origin}/api` : '/api';

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE,
  prepareHeaders: (headers, { getState }) => {
    const token = getState().auth.token;
    if (token) headers.set('authorization', `Bearer ${token}`);
    return headers;
  },
});

/**
 * Unwraps the API envelope: `{ success: true, data }` → data, and
 * `{ success: false, error }` → `{ status, code, message, details }`, so
 * components only ever see payloads and stable error codes.
 */
export async function envelopeBaseQuery(args, api, extraOptions) {
  const result = await rawBaseQuery(args, api, extraOptions);
  if (result.error) {
    if (result.error.status === 401 && api.getState().auth.token) api.dispatch(loggedOut());
    const body = result.error.data;
    return {
      error: {
        status: result.error.status,
        code: body?.error?.code ?? (result.error.status === 'FETCH_ERROR' ? 'NETWORK_ERROR' : 'INTERNAL_ERROR'),
        message: body?.error?.message ?? 'Request failed',
        details: body?.error?.details,
      },
    };
  }
  const data = result.data;
  return { data: data && typeof data === 'object' && data.success === true && 'data' in data ? data.data : data };
}

export const TAGS = ['Me', 'Resume', 'Profile', 'Template', 'Job', 'JobSource', 'Application', 'HiringPost', 'PostSource', 'Contact', 'Outreach', 'OutreachTemplate', 'Mail', 'PortalSession', 'Llm'];

/** Feature files add their endpoints with `api.injectEndpoints`. */
export const api = createApi({
  reducerPath: 'api',
  baseQuery: envelopeBaseQuery,
  tagTypes: TAGS,
  endpoints: () => ({}),
});
