import { useEffect, useRef, useState } from 'react';
import { getErrorMessage } from '../../api/client';

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; promise: Promise<unknown> }>();

function load<T>(key: string, fetcher: () => Promise<{ data: T }>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise as Promise<T>;
  const promise = fetcher().then((r) => r.data);
  cache.set(key, { at: Date.now(), promise });
  promise.catch(() => cache.delete(key));
  return promise;
}

/**
 * Fetch keyed by ``key`` and shared across tabs for a minute, so Overview and the
 * detail tab do not ask twice. A null key skips the request (e.g. not allowed).
 * The previous data stays visible while a new period loads.
 */
export function useAnalyticsData<T>(key: string | null, fetcher: () => Promise<{ data: T }>) {
  const [state, setState] = useState<{ key: string | null; data: T | null; error: string | null }>({
    key: null,
    data: null,
    error: null,
  });
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    load(key, () => fetcherRef.current()).then(
      (data) => {
        if (!cancelled) setState({ key, data, error: null });
      },
      (err) => {
        if (!cancelled) setState({ key, data: null, error: getErrorMessage(err) });
      }
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  return {
    data: state.data,
    loading: key != null && state.key !== key,
    error: state.key === key ? state.error : null,
  };
}
