import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/loop/deps';
import { waitOnClock } from '../src/loop/time';

/** Timers keeping the process running right now. */
const holding = () => process.getActiveResourcesInfo().filter((name) => name === 'Timeout').length;

describe('waiting on the clock', () => {
  it('keeps the process running while it waits, which a clock timeout alone does not', async () => {
    const before = holding();
    // Node's own timeout doesn't hold the process open, so a command waiting only on it ends.
    AbortSignal.timeout(50);
    expect(holding()).toBe(before);

    const waiting = waitOnClock(systemClock, 50);
    expect(holding()).toBe(before + 1);
    await waiting;
    expect(holding()).toBe(before);
  });

  it('ends at once when its signal aborts, and lets go of the process', async () => {
    const stop = new AbortController();
    const before = holding();
    const waiting = waitOnClock(systemClock, 60_000, stop.signal);
    expect(holding()).toBe(before + 1);
    stop.abort();
    await waiting;
    expect(holding()).toBe(before);
  });

  it('returns at once for a signal already aborted, holding nothing', async () => {
    const stop = new AbortController();
    stop.abort();
    const before = holding();
    await waitOnClock(systemClock, 60_000, stop.signal);
    expect(holding()).toBe(before);
  });
});
