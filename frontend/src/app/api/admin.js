import { api } from './baseApi';

/** Admin-only endpoints. The API checks the caller's role on every request. */
export const adminApi = api.injectEndpoints({
  endpoints: build => ({
    listAdminUsers: build.query({ query: params => ({ url: '/admin/users', params }), providesTags: ['AdminUser'] }),
    createAdminUser: build.mutation({ query: body => ({ url: '/admin/users', method: 'POST', body }), invalidatesTags: ['AdminUser', 'AuditLog'] }),
    setUserStatus: build.mutation({ query: ({ id, status }) => ({ url: `/admin/users/${id}/status`, method: 'PATCH', body: { status } }), invalidatesTags: ['AdminUser', 'AuditLog'] }),
    setUserRole: build.mutation({ query: ({ id, role }) => ({ url: `/admin/users/${id}/role`, method: 'PATCH', body: { role } }), invalidatesTags: ['AdminUser', 'AuditLog'] }),
    revokeUserSessions: build.mutation({ query: id => ({ url: `/admin/users/${id}/revoke-sessions`, method: 'POST' }), invalidatesTags: ['AuditLog'] }),
    listAuditLogs: build.query({ query: params => ({ url: '/admin/audit-logs', params }), providesTags: ['AuditLog'] }),
    adminLlmUsage: build.query({ query: days => ({ url: '/admin/llm-usage', params: { days } }) }),
  }),
});

export const {
  useListAdminUsersQuery,
  useCreateAdminUserMutation,
  useSetUserStatusMutation,
  useSetUserRoleMutation,
  useRevokeUserSessionsMutation,
  useListAuditLogsQuery,
  useAdminLlmUsageQuery,
} = adminApi;
