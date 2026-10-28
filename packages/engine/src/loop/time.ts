import type { Clock } from './deps';

export function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

/** Longer than any wait here, and below the most a Node interval may be. */
const HOLD_MS = 2 ** 30;

/**
 * Waits `ms` on the clock, or until `signal` aborts, and keeps the process running meanwhile. A
 * clock's timeout, like Node's own `AbortSignal.timeout`, doesn't hold the process open, so a
 * command whose only work left is a wait (a retry after a dropped connection, a training job
 * checked again later) would otherwise end quietly in the middle of it.
 */
export async function waitOnClock(clock: Clock, ms: number, signal?: AbortSignal): Promise<void> {
  const done =
    signal === undefined ? clock.timeout(ms) : AbortSignal.any([signal, clock.timeout(ms)]);
  if (done.aborted) return;
  const hold = setInterval(() => undefined, HOLD_MS);
  try {
    await new Promise<void>((resolve) => {
      done.addEventListener('abort', () => resolve(), { once: true });
    });
  } finally {
    clearInterval(hold);
  }
}
