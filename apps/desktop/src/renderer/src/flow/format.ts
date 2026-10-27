import type { Score } from '@architect/shared';

/** Pass rate in percent. Multiplying first keeps 23 of 40 at exactly 57.5, so it rounds to 58. */
export function rate(score: Score): number {
  return score.total === 0 ? 0 : (score.pass * 100) / score.total;
}

/** Whole-number pass rate: 23 of 40 is 58. */
export function percent(score: Score): number {
  return Math.round(rate(score));
}

export function formatRate(score: Score): string {
  return `${percent(score)}%`;
}

/** "+3", "−2", "0", with a true minus sign so columns of numbers line up. */
export function signed(value: number): string {
  if (value > 0) return `+${value}`;
  if (value < 0) return `\u2212${Math.abs(value)}`;
  return '0';
}

/** "+6 to +9", or one number when the range is a single value. */
export function formatRange(min: number, max: number): string {
  return min === max ? signed(min) : `${signed(min)} to ${signed(max)}`;
}

/** "850 ms", "4.2 s", "24 s", "2 min 11 s": exact when short, readable when long. */
export function formatAnswerTime(ms: number, short = false): string {
  if (short && ms >= 60_000) return `${Math.round(ms / 6_000) / 10} min`;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  const total = Math.round(ms / 1000);
  if (total < 60) return `${total} s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

/** An answer-time limit as the Define screen states it: "<8s", "<4 min". */
export function formatTimeLimit(ms: number): string {
  return ms < 60_000 ? `<${Math.ceil(ms / 1000)}s` : `<${Math.ceil(ms / 60_000)} min`;
}

/** The last part of a path, on any platform: `C:\office\jobs.csv` and `/srv/jobs.csv` → `jobs.csv`. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** Shortens text to one line's worth, ending on a whole word where it can. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}\u2026`;
}
