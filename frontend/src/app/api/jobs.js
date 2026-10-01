import { api } from './baseApi';

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== '' && value !== null && value !== false) search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const jobsApi = api.injectEndpoints({
  endpoints: build => ({
    listJobs: build.query({
      query: params => `/jobs${queryString(params)}`,
      providesTags: result => [...(result?.items ?? []).map(job => ({ type: 'Job', id: job.id })), { type: 'Job', id: 'LIST' }],
    }),
    getJob: build.query({ query: id => `/jobs/${id}`, providesTags: (_r, _e, id) => [{ type: 'Job', id }] }),
    setJobStatus: build.mutation({
      query: ({ id, status }) => ({ url: `/jobs/${id}/status`, method: 'PATCH', body: { status } }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Job', id }, { type: 'Job', id: 'LIST' }],
    }),
    rescoreJob: build.mutation({
      query: id => ({ url: `/jobs/${id}/rescore`, method: 'POST' }),
      invalidatesTags: (_r, _e, id) => [{ type: 'Job', id }, { type: 'Job', id: 'LIST' }],
    }),
    discoverJobs: build.mutation({ query: () => ({ url: '/jobs/discover', method: 'POST' }), invalidatesTags: ['JobSource'] }),
    listJobSources: build.query({ query: () => '/job-sources', providesTags: ['JobSource'] }),
    setJobSource: build.mutation({
      query: ({ key, enabled }) => ({ url: `/job-sources/${key}`, method: 'PUT', body: { enabled } }),
      invalidatesTags: ['JobSource'],
    }),
    tailorJob: build.mutation({
      query: ({ id, instructions }) => ({ url: `/jobs/${id}/tailor`, method: 'POST', body: instructions ? { instructions } : {} }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Job', id }, { type: 'Job', id: 'LIST' }, { type: 'Application', id: 'LIST' }],
    }),
  }),
});

export const {
  useListJobsQuery,
  useGetJobQuery,
  useSetJobStatusMutation,
  useRescoreJobMutation,
  useDiscoverJobsMutation,
  useListJobSourcesQuery,
  useSetJobSourceMutation,
  useTailorJobMutation,
} = jobsApi;
