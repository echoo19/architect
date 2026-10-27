import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * A small cache for data read over the bridge. Each key is fetched once and shared by every
 * component that asks for it; screens always get an explicit loading, error or success state.
 */

export type QueryState<T> =
  | { status: 'loading'; data: T | undefined; error: undefined; reload: () => void }
  | { status: 'error'; data: T | undefined; error: Error; reload: () => void }
  | { status: 'success'; data: T; error: undefined; reload: () => void };

interface Entry {
  status: 'loading' | 'error' | 'success';
  data?: unknown;
  error?: Error;
}

const useEntries = create<Record<string, Entry>>(() => ({}));
const inflight = new Map<string, Promise<void>>();

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Something went wrong.');
}

/** Fetches a key, sharing the request with any fetch of the same key already running. */
export function fetchQuery(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  const running = inflight.get(key);
  if (running) return running;
  useEntries.setState((entries) => ({ [key]: { status: 'loading', data: entries[key]?.data } }));
  const request = fetcher()
    .then(
      (data) => useEntries.setState({ [key]: { status: 'success', data } }),
      (error: unknown) =>
        useEntries.setState((entries) => ({
          [key]: { status: 'error', data: entries[key]?.data, error: toError(error) },
        })),
    )
    .finally(() => inflight.delete(key));
  inflight.set(key, request);
  return request;
}

/** Replaces cached data after a write, so every reader sees the new value at once. */
export function setQueryData(key: string, data: unknown): void {
  useEntries.setState({ [key]: { status: 'success', data } });
}

export function useQuery<T>(key: string, fetcher: () => Promise<T>): QueryState<T> {
  const entry = useEntries((entries) => entries[key]);
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });

  useEffect(() => {
    if (!useEntries.getState()[key]) void fetchQuery(key, () => latest.current());
  }, [key]);

  const reload = useCallback(() => {
    void fetchQuery(key, () => latest.current());
  }, [key]);

  // The data in a key always comes from this key's fetcher, so it has this hook's type.
  const data = entry?.data as T | undefined;
  if (entry?.status === 'success') {
    return { status: 'success', data: data as T, error: undefined, reload };
  }
  if (entry?.status === 'error' && entry.error) {
    return { status: 'error', data, error: entry.error, reload };
  }
  return { status: 'loading', data, error: undefined, reload };
}
