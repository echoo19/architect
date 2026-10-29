export interface SpeedInterval {
  startMs: number;
  endMs: number;
  factor: number;
}

export function speedAt(timestampMs: number, intervals: readonly SpeedInterval[]): number {
  return (
    intervals.find(({ startMs, endMs }) => timestampMs >= startMs && timestampMs < endMs)?.factor ??
    1
  );
}

/** Each JPEG is held until the next captured JPEG, using measured time. */
export function frameDurations(
  timestampsMs: readonly number[],
  intervals: readonly SpeedInterval[],
  finalDurationMs: number,
): number[] {
  if (finalDurationMs <= 0) throw new Error('Final frame duration must be positive');
  return timestampsMs.map((timestamp, index) => {
    const next = timestampsMs[index + 1];
    if (next !== undefined && next <= timestamp) throw new Error('Frame times must be monotonic');
    const duration = next === undefined ? finalDurationMs : next - timestamp;
    return duration / speedAt(timestamp, intervals);
  });
}
