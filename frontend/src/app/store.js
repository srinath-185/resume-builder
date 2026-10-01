import { configureStore } from '@reduxjs/toolkit';
import { api } from './api/baseApi';
import { authReducer, loggedOut } from './authSlice';

export function makeStore(preloadedState) {
  const store = configureStore({
    reducer: { auth: authReducer, [api.reducerPath]: api.reducer },
    middleware: getDefault => getDefault().concat(api.middleware),
    preloadedState,
  });
  return store;
}

export const store = makeStore();

/** Clears every cached query on logout so the next user never sees the previous user's data. */
store.subscribe(
  (() => {
    let lastToken = store.getState().auth.token;
    return () => {
      const token = store.getState().auth.token;
      if (lastToken && !token) store.dispatch(api.util.resetApiState());
      lastToken = token;
    };
  })(),
);

export { loggedOut };
