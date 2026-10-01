import { createSlice } from '@reduxjs/toolkit';

const STORAGE_KEY = 'rb.session';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
}

function persist(state) {
  try {
    if (state.token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: state.token, user: state.user }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or storage disabled: the session simply lasts for the tab.
  }
}

const authSlice = createSlice({
  name: 'auth',
  initialState: load,
  reducers: {
    signedIn(state, action) {
      state.token = action.payload.token;
      state.user = action.payload.user;
      persist(state);
    },
    loggedOut(state) {
      state.token = null;
      state.user = null;
      persist(state);
    },
  },
});

export const { signedIn, loggedOut } = authSlice.actions;
export const authReducer = authSlice.reducer;
export const selectToken = state => state.auth.token;
export const selectUser = state => state.auth.user;
