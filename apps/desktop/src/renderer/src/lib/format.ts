import type { Score } from '@architect/shared';

/** Whole-number pass rate of a score, 0 when nothing was scored. */
export function percentOf(score: Score): number {
  // Multiply first: (23 / 40) * 100 is 57.49999 in floating point and would round down.
  return score.total === 0 ? 0 : Math.round((score.pass * 100) / score.total);
}

export function formatPercent(score: Score): string {
  return `${percentOf(score)}%`;
}

/** "$5" for whole amounts, "$2.40" otherwise. */
export function formatUsd(amount: number): string {
  return Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
}

/** "2 h 38 min", "14 min", "40 s". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes === 0) return `${Math.round(ms / 1000)} s`;
  const hours = Math.floor(minutes / 60);
  if (hours === 0) return `${minutes} min`;
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}

/** The end of a long path, so the folder's own name always shows: "…\dana\Records". */
export function shortPath(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/';
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return `…${separator}${parts.slice(-2).join(separator)}`;
}

/** "18 GB", "4.6 GB", "236 MB", or "48 KB" for a small file. */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
