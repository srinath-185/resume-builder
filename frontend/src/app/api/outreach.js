import { api } from './baseApi';

export const outreachApi = api.injectEndpoints({
  endpoints: build => ({
    // Hiring posts
    hiringQueries: build.query({ query: () => '/hiring-posts/queries', providesTags: ['Profile'] }),
    postSources: build.query({ query: () => '/hiring-posts/sources', providesTags: ['PostSource'] }),
    setPostSource: build.mutation({ query: ({ key, enabled }) => ({ url: `/hiring-posts/sources/${key}`, method: 'PUT', body: { enabled } }), invalidatesTags: ['PostSource'] }),
    searchPosts: build.mutation({ query: () => ({ url: '/hiring-posts/search', method: 'POST' }), invalidatesTags: ['PostSource'] }),
    listPosts: build.query({ query: status => `/hiring-posts${status ? `?status=${status}` : ''}`, providesTags: ['HiringPost'] }),
    setPostStatus: build.mutation({ query: ({ id, status }) => ({ url: `/hiring-posts/${id}`, method: 'PATCH', body: { status } }), invalidatesTags: ['HiringPost'] }),

    // Contacts
    listContacts: build.query({ query: () => '/contacts', providesTags: ['Contact'] }),
    createContact: build.mutation({ query: body => ({ url: '/contacts', method: 'POST', body }), invalidatesTags: ['Contact'] }),
    updateContact: build.mutation({ query: ({ id, ...body }) => ({ url: `/contacts/${id}`, method: 'PATCH', body }), invalidatesTags: ['Contact'] }),
    deleteContact: build.mutation({ query: id => ({ url: `/contacts/${id}`, method: 'DELETE' }), invalidatesTags: ['Contact'] }),

    // Mail connector
    mailConnector: build.query({ query: () => '/mail-connector', providesTags: ['Mail'] }),
    startGmail: build.mutation({ query: () => ({ url: '/mail-connector/gmail/start', method: 'POST' }) }),
    saveSmtp: build.mutation({ query: body => ({ url: '/mail-connector/smtp', method: 'PUT', body }), invalidatesTags: ['Mail'] }),
    testMail: build.mutation({ query: () => ({ url: '/mail-connector/test', method: 'POST' }), invalidatesTags: ['Mail'] }),
    disconnectMail: build.mutation({ query: () => ({ url: '/mail-connector', method: 'DELETE' }), invalidatesTags: ['Mail'] }),

    // Templates
    listOutreachTemplates: build.query({ query: () => '/outreach-templates', providesTags: ['OutreachTemplate'] }),
    createOutreachTemplate: build.mutation({ query: body => ({ url: '/outreach-templates', method: 'POST', body }), invalidatesTags: ['OutreachTemplate'] }),
    updateOutreachTemplate: build.mutation({ query: ({ id, ...body }) => ({ url: `/outreach-templates/${id}`, method: 'PUT', body }), invalidatesTags: ['OutreachTemplate'] }),
    deleteOutreachTemplate: build.mutation({ query: id => ({ url: `/outreach-templates/${id}`, method: 'DELETE' }), invalidatesTags: ['OutreachTemplate'] }),

    // Outreach messages
    listOutreach: build.query({ query: status => `/outreach${status ? `?status=${status}` : ''}`, providesTags: ['Outreach'] }),
    getOutreach: build.query({ query: id => `/outreach/${id}`, providesTags: (_r, _e, id) => [{ type: 'Outreach', id }] }),
    draftOutreach: build.mutation({ query: body => ({ url: '/outreach', method: 'POST', body }), invalidatesTags: ['Outreach', 'Contact'] }),
    updateOutreach: build.mutation({ query: ({ id, ...body }) => ({ url: `/outreach/${id}`, method: 'PUT', body }), invalidatesTags: ['Outreach'] }),
    sendOutreach: build.mutation({ query: id => ({ url: `/outreach/${id}/send`, method: 'POST' }), invalidatesTags: ['Outreach', 'HiringPost'] }),
    cancelOutreach: build.mutation({ query: id => ({ url: `/outreach/${id}/cancel`, method: 'POST' }), invalidatesTags: ['Outreach'] }),

    // Portal sessions
    portalSessions: build.query({ query: () => '/portal-sessions', providesTags: ['PortalSession'] }),
    savePortalSession: build.mutation({ query: ({ portal, ...body }) => ({ url: `/portal-sessions/${portal}`, method: 'PUT', body }), invalidatesTags: ['PortalSession'] }),
    deletePortalSession: build.mutation({ query: portal => ({ url: `/portal-sessions/${portal}`, method: 'DELETE' }), invalidatesTags: ['PortalSession'] }),
  }),
});

export const {
  useHiringQueriesQuery,
  usePostSourcesQuery,
  useSetPostSourceMutation,
  useSearchPostsMutation,
  useListPostsQuery,
  useSetPostStatusMutation,
  useListContactsQuery,
  useCreateContactMutation,
  useUpdateContactMutation,
  useDeleteContactMutation,
  useMailConnectorQuery,
  useStartGmailMutation,
  useSaveSmtpMutation,
  useTestMailMutation,
  useDisconnectMailMutation,
  useListOutreachTemplatesQuery,
  useCreateOutreachTemplateMutation,
  useUpdateOutreachTemplateMutation,
  useDeleteOutreachTemplateMutation,
  useListOutreachQuery,
  useGetOutreachQuery,
  useDraftOutreachMutation,
  useUpdateOutreachMutation,
  useSendOutreachMutation,
  useCancelOutreachMutation,
  usePortalSessionsQuery,
  useSavePortalSessionMutation,
  useDeletePortalSessionMutation,
} = outreachApi;
