import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { API_BASE } from '@/app/api/baseApi';
import { selectToken } from '@/app/authSlice';

/** Fetches a protected file (PDF, screenshot) with the bearer token and exposes it as an object URL. */
export function useAuthorizedFile(path, version) {
  const token = useSelector(selectToken);
  const [state, setState] = useState({ url: null, loading: Boolean(path), error: null });

  useEffect(() => {
    if (!path) {
      setState({ url: null, loading: false, error: null });
      return undefined;
    }
    let objectUrl;
    let cancelled = false;
    setState(previous => ({ ...previous, loading: true, error: null }));
    fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
      .then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        objectUrl = URL.createObjectURL(await response.blob());
        if (!cancelled) setState({ url: objectUrl, loading: false, error: null });
      })
      .catch(error => !cancelled && setState({ url: null, loading: false, error }));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path, token, version]);

  return state;
}

export async function downloadAuthorized(path, fileName, token) {
  const response = await fetch(`${API_BASE}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
