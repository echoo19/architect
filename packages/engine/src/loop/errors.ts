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

/** A value the run's own records guarantee; its absence is a bug, reported by name. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}
