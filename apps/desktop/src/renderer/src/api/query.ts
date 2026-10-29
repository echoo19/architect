import { useCallback, useEffect, useRef } from 'react';
import { create } from 'zustand';

/**
 * A small cache for data read over the bridge. Each key is fetched when it is first asked for and
 * shared by every component that asks for it, and read again only when something asks; screens
 * always get an explicit loading, error or success state.
 */

export type QueryState<T> =
  | { status: 'loading'; data: T | undefined; error: undefined; reload: () => void }
  | { status: 'error'; data: T | undefined; error: Error; reload: () => void }
  | { status: 'success'; data: T; error: undefined; reload: () => void };

export interface QueryEntry {
  status: 'loading' | 'error' | 'success';
  data?: unknown;
  error?: Error;
}

const useEntries = create<Record<string, QueryEntry>>(() => ({}));

/** The reads under way, by key. A read is under way until nothing newer has been asked for. */
const inflight = new Map<string, Promise<void>>();
/** The newest read asked for while another of the same key was under way. */
const waiting = new Map<string, () => Promise<unknown>>();

export function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === 'string' ? error : 'Something went wrong.');
}

/** What a key holds right now, without subscribing to it or reading it. */
export function peekQuery(key: string): QueryEntry | undefined {
  return useEntries.getState()[key];
}

/**
 * Reads a key. Asking while the key is already being read waits for one more read that starts
 * after the ask, since the read under way may have begun before whatever made this one necessary
 * and so can return what is already out of date; any number of asks in the meantime share that
 * one read. What the older read returned is dropped, so readers never see it as the current
 * answer, and the promise resolves once the newest read has landed.
 */
export function fetchQuery(key: string, fetcher: () => Promise<unknown>): Promise<void> {
  const running = inflight.get(key);
  if (running) {
    waiting.set(key, fetcher);
    return running;
  }
  useEntries.setState((entries) => ({ [key]: { status: 'loading', data: entries[key]?.data } }));
  const request = readUntilCurrent(key, fetcher);
  inflight.set(key, request);
  return request;
}

type Outcome = { data: unknown } | { error: Error };

async function attempt(fetcher: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { data: await fetcher() };
  } catch (error) {
    return { error: toError(error) };
  }
}

async function readUntilCurrent(key: string, first: () => Promise<unknown>): Promise<void> {
  let fetcher = first;
  for (;;) {
    const outcome = await attempt(fetcher);
    const newer = waiting.get(key);
    if (newer) {
      waiting.delete(key);
      fetcher = newer;
      continue;
    }
    // Nothing newer was asked for: this read is the current one. It stops being under way in the
    // same breath as it lands, so an ask from here on starts a read of its own.
    inflight.delete(key);
    useEntries.setState((entries) => ({
      [key]:
        'error' in outcome
          ? { status: 'error', data: entries[key]?.data, error: outcome.error }
          : { status: 'success', data: outcome.data },
    }));
    return;
  }
}

/** Replaces cached data after a write, so every reader sees the new value at once. */
export function setQueryData(key: string, data: unknown): void {
  useEntries.setState({ [key]: { status: 'success', data } });
}

export interface QueryOptions {
  /**
   * Read the key again each time a component using it comes on screen, showing what is cached
   * meanwhile, for data that changes while nothing is looking, such as a run's records. Without
   * it a key is read once and kept until something asks for it again.
   */
  refreshOnMount?: boolean;
}

/**
 * Whether a component that has just come on screen reads its key: when nothing has read it yet,
 * or when it is to be read again each time and no read is under way, since a read already under
 * way is as new as one started now. A read that failed stays failed unless it is read again.
 */
export function readsOnMount(cached: QueryEntry | undefined, refreshOnMount: boolean): boolean {
  return cached === undefined || (refreshOnMount && cached.status !== 'loading');
}

export function useQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
  { refreshOnMount = false }: QueryOptions = {},
): QueryState<T> {
  const entry = useEntries((entries) => entries[key]);
  const latest = useRef(fetcher);
  useEffect(() => {
    latest.current = fetcher;
  });

  useEffect(() => {
    if (readsOnMount(useEntries.getState()[key], refreshOnMount)) {
      void fetchQuery(key, () => latest.current());
    }
  }, [key, refreshOnMount]);

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
