import { AdapterError } from '@architect/shared';
import { cancelled, HttpError } from './errors';

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface RetryOptions {
  /** Attempts in total, the first one included. Default 5. */
  maxAttempts?: number;
  /** Backoff base: the wait before retry n is `base * 2^(n-1)` plus up to `base` of jitter. Default 500. */
  baseDelayMs?: number;
  /** A longer `Retry-After` than this isn't waited out; the error is raised instead. Default 2 minutes. */
  maxRetryAfterMs?: number;
  /** Replaceable so tests don't really wait. */
  sleep?: Sleep;
  /** Returns a number in [0, 1); replaceable so tests can pin the jitter. */
  random?: () => number;
}

export const defaultSleep: Sleep = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(cancelled());
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/**
 * Runs `operation`, repeating it after exponential backoff when it fails with a retryable
 * `AdapterError`. A 504 is never repeated: it means the request itself ran too long, and sending
 * the same request again meets the same wall.
 */
export async function withRetries<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 5;
  const base = options.baseDelayMs ?? 500;
  const maxRetryAfter = options.maxRetryAfterMs ?? 120_000;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  for (let attempt = 1; ; attempt++) {
    if (signal?.aborted) throw cancelled();
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryable(error)) throw error;
      const retryAfter = error instanceof HttpError ? error.retryAfterMs : undefined;
      if (retryAfter !== undefined && retryAfter > maxRetryAfter) throw error;
      const backoff = base * 2 ** (attempt - 1) + random() * base;
      await sleep(Math.max(backoff, retryAfter ?? 0), signal);
    }
  }
}

function isRetryable(error: unknown): boolean {
  return error instanceof AdapterError && error.retryable && error.status !== 504;
}
