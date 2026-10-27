import type { PullProgress } from '@architect/shared';
import { formatBytes } from '../lib/format';

/** Where a model download stands, as the welcome screen shows it. */
export type PullState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'pulling'; status: string; completedBytes: number | null; totalBytes: number | null }
  | { phase: 'done' }
  | { phase: 'failed'; error: string };

export type PullAction =
  | { type: 'start' }
  | { type: 'progress'; progress: PullProgress }
  | { type: 'finished' }
  | { type: 'failed'; error: string };

export const idlePull: PullState = { phase: 'idle' };

export function pullReducer(state: PullState, action: PullAction): PullState {
  switch (action.type) {
    case 'start':
      return { phase: 'starting' };
    case 'progress': {
      const { progress } = action;
      if (progress.error) return { phase: 'failed', error: progress.error };
      if (progress.done) return { phase: 'done' };
      // A progress line that arrives after the end belongs to the download that just finished.
      if (state.phase === 'done' || state.phase === 'failed') return state;
      return {
        phase: 'pulling',
        status: progress.status,
        completedBytes: progress.completedBytes ?? null,
        totalBytes: progress.totalBytes ?? null,
      };
    }
    case 'finished':
      return state.phase === 'failed' ? state : { phase: 'done' };
    case 'failed':
      return { phase: 'failed', error: action.error };
  }
}

/** Whole-number percent downloaded, or null while the size isn't known. */
export function pullPercent(state: PullState): number | null {
  if (state.phase !== 'pulling' || !state.totalBytes || state.completedBytes === null) return null;
  return Math.min(100, Math.floor((state.completedBytes / state.totalBytes) * 100));
}

/** "4.2 GB of 18 GB", or null while the size isn't known. */
export function pullBytes(state: PullState): string | null {
  if (state.phase !== 'pulling' || !state.totalBytes || state.completedBytes === null) return null;
  return `${formatBytes(state.completedBytes)} of ${formatBytes(state.totalBytes)}`;
}

/** Ollama's status line, said plainly: "pulling 8a9b…" is "Downloading". */
export function pullStage(state: PullState): string {
  if (state.phase === 'starting') return 'Starting the download';
  if (state.phase !== 'pulling') return '';
  const status = state.status.toLowerCase();
  if (status.startsWith('pulling manifest')) return 'Starting the download';
  if (status.startsWith('pulling')) return 'Downloading';
  if (status.startsWith('verifying')) return 'Checking the download';
  if (status.startsWith('writing') || status.startsWith('removing')) return 'Finishing up';
  return state.status.charAt(0).toUpperCase() + state.status.slice(1);
}
