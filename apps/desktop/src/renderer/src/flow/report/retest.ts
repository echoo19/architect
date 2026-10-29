import type { Retest } from '@architect/shared';
import { formatAbout, SECONDS_PER_TASK } from '../define/estimates';

/** Where a run's test on this computer stands. */
export type RetestView =
  /** Not started, so it can be. */
  | { phase: 'idle' }
  /** Running or waiting its turn; `done` of `total` once a task has been scored. */
  | { phase: 'testing'; done: number | null; total: number | null }
  /** An error stopped it, and asking again goes on. */
  | { phase: 'paused'; error: string }
  | { phase: 'finished' };

/** How far a test has got, as the engine's progress events say. */
export interface RetestProgress {
  done: number;
  total: number;
}

/**
 * What to show about a run's test on this computer, from the run's own record of it and the
 * progress heard since the page opened. The record decides the phase; the progress only fills in
 * how far a running test has got.
 */
export function retestView(
  retests: readonly Retest[] | undefined,
  progress: RetestProgress | null,
): RetestView {
  const local = retests?.find((retest) => retest.target === 'local');
  if (local === undefined) return { phase: 'idle' };
  if (local.status === 'finished') return { phase: 'finished' };
  if (local.status === 'testing') {
    return { phase: 'testing', done: progress?.done ?? null, total: progress?.total ?? null };
  }
  return { phase: 'paused', error: local.error ?? 'It stopped without saying why.' };
}

/** How long the test takes on this computer: "About 2.5 hours for 60 tasks". */
export function localTestTime(tasks: number): string {
  return `${formatAbout(tasks * SECONDS_PER_TASK.local)} for ${tasks === 1 ? '1 task' : `${tasks} tasks`}`;
}
