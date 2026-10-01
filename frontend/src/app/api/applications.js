import { api } from './baseApi';

const one = id => [{ type: 'Application', id }, { type: 'Application', id: 'LIST' }];

export const applicationsApi = api.injectEndpoints({
  endpoints: build => ({
    listApplications: build.query({
      query: status => `/applications${status ? `?status=${status}` : ''}`,
      providesTags: result => [...(result ?? []).map(app => ({ type: 'Application', id: app.id })), { type: 'Application', id: 'LIST' }],
    }),
    getApplication: build.query({ query: id => `/applications/${id}`, providesTags: (_r, _e, id) => [{ type: 'Application', id }] }),
    editVariant: build.mutation({ query: ({ id, ...body }) => ({ url: `/applications/${id}/variant`, method: 'PUT', body }), invalidatesTags: (_r, _e, { id }) => one(id) }),
    approveApplication: build.mutation({ query: id => ({ url: `/applications/${id}/approve`, method: 'POST' }), invalidatesTags: (_r, _e, id) => one(id) }),
    rejectApplication: build.mutation({ query: ({ id, reason }) => ({ url: `/applications/${id}/reject`, method: 'POST', body: reason ? { reason } : {} }), invalidatesTags: (_r, _e, { id }) => one(id) }),
    regenerateApplication: build.mutation({
      query: ({ id, instructions }) => ({ url: `/applications/${id}/regenerate`, method: 'POST', body: instructions ? { instructions } : {} }),
      invalidatesTags: (_r, _e, { id }) => one(id),
    }),
    markApplied: build.mutation({ query: id => ({ url: `/applications/${id}/mark-applied`, method: 'POST' }), invalidatesTags: (_r, _e, id) => one(id) }),
    startApply: build.mutation({ query: id => ({ url: `/applications/${id}/apply`, method: 'POST' }), invalidatesTags: (_r, _e, id) => one(id) }),
  }),
});

export const {
  useListApplicationsQuery,
  useGetApplicationQuery,
  useEditVariantMutation,
  useApproveApplicationMutation,
  useRejectApplicationMutation,
  useRegenerateApplicationMutation,
  useMarkAppliedMutation,
  useStartApplyMutation,
} = applicationsApi;

/** Statuses where the server is working and the page should poll. */
export const BUSY_STATUSES = ['TAILORING', 'APPLYING'];
