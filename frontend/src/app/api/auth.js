import { api } from './baseApi';

export const authApi = api.injectEndpoints({
  endpoints: build => ({
    login: build.mutation({ query: body => ({ url: '/auth/login', method: 'POST', body }) }),
    register: build.mutation({ query: body => ({ url: '/auth/register', method: 'POST', body }) }),
    me: build.query({ query: () => '/auth/me', providesTags: ['Me'] }),
    signOutEverywhere: build.mutation({ query: () => ({ url: '/auth/sign-out-everywhere', method: 'POST' }) }),
    llmStatus: build.query({ query: () => '/llm/status', providesTags: ['Llm'] }),
  }),
});

export const { useLoginMutation, useRegisterMutation, useMeQuery, useSignOutEverywhereMutation, useLlmStatusQuery } = authApi;
