export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A value the run's own records guarantee; its absence is a bug, reported by name. */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}
