/** Whole milliseconds since a `performance.now()` reading. */
export function elapsedMs(since: number): number {
  return Math.max(0, Math.round(performance.now() - since));
}
