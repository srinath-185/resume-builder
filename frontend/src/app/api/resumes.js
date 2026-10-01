import { api } from './baseApi';

export const resumesApi = api.injectEndpoints({
  endpoints: build => ({
    listResumes: build.query({
      query: () => '/resumes',
      providesTags: result => [...(result ?? []).map(resume => ({ type: 'Resume', id: resume.id })), { type: 'Resume', id: 'LIST' }],
    }),
    getResume: build.query({ query: id => `/resumes/${id}`, providesTags: (_r, _e, id) => [{ type: 'Resume', id }] }),
    uploadResume: build.mutation({
      query: file => {
        const body = new FormData();
        body.append('file', file);
        return { url: '/resumes', method: 'POST', body };
      },
      invalidatesTags: [{ type: 'Resume', id: 'LIST' }, 'Profile'],
    }),
    updateResumeDocument: build.mutation({
      query: ({ id, document }) => ({ url: `/resumes/${id}/document`, method: 'PATCH', body: document }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Resume', id }, 'Profile'],
    }),
    setPrimaryResume: build.mutation({
      query: id => ({ url: `/resumes/${id}/primary`, method: 'POST' }),
      invalidatesTags: [{ type: 'Resume', id: 'LIST' }, 'Profile'],
    }),
    reparseResume: build.mutation({
      query: ({ id, force }) => ({ url: `/resumes/${id}/reparse${force ? '?force=true' : ''}`, method: 'POST' }),
      invalidatesTags: (_r, _e, { id }) => [{ type: 'Resume', id }, { type: 'Resume', id: 'LIST' }],
    }),
    deleteResume: build.mutation({
      query: id => ({ url: `/resumes/${id}`, method: 'DELETE' }),
      invalidatesTags: [{ type: 'Resume', id: 'LIST' }, 'Profile'],
    }),
    resumeTemplates: build.query({ query: () => '/resume-templates', providesTags: ['Template'] }),
    getProfile: build.query({ query: () => '/profile', providesTags: ['Profile'] }),
    updateProfile: build.mutation({ query: body => ({ url: '/profile', method: 'PUT', body }), invalidatesTags: ['Profile'] }),
  }),
});

export const {
  useListResumesQuery,
  useGetResumeQuery,
  useUploadResumeMutation,
  useUpdateResumeDocumentMutation,
  useSetPrimaryResumeMutation,
  useReparseResumeMutation,
  useDeleteResumeMutation,
  useResumeTemplatesQuery,
  useGetProfileQuery,
  useUpdateProfileMutation,
} = resumesApi;

export const PARSE_IN_FLIGHT = ['PENDING', 'PARSING'];
