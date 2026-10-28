import { AdapterError } from '@architect/shared';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The work was aborted, as on app shutdown, rather than failing. */
export function isAbort(error: unknown): boolean {
  return (
    (error instanceof AdapterError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/**
 * A model call that failed in a way that usually passes on its own: a busy or rate-limited
 * server, a dropped connection, a reply cut off partway. A 504 says the request itself ran too
 * long, so sending it again meets the same wall.
 */
export function passesOnItsOwn(error: unknown): error is AdapterError {
  return error instanceof AdapterError && error.retryable && error.status !== 504;
}

/**
 * What went wrong, without the advice an adapter adds for a person trying again by hand: adapter
 * errors that carry their phrasing keep the bare summary apart.
 */
export function summaryOf(error: AdapterError): string {
  const { summary } = error as { summary?: unknown };
  return typeof summary === 'string' ? summary : error.message;
}

/** A value the run's own records guarantee; its absence is a bug, reported by name. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}
