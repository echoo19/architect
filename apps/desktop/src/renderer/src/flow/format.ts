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

/** "57 of 60 passed": a score in the words every screen uses for one. */
export function passedOf(score: Score): string {
  return `${score.pass} of ${score.total} passed`;
}

/**
 * A cost as precise as it needs to be: "$0", "$0.0042" for a fraction of a cent, "$1.37".
 * Mentoring records often cost less than a cent, which "$0.00" would hide.
 */
export function formatCost(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.0001) return '<$0.0001';
  if (usd < 0.01) return `$${Number(usd.toPrecision(2))}`;
  return `$${usd.toFixed(2)}`;
}

/** "+6 to +9", or one number when the range is a single value. */
export function formatRange(min: number, max: number): string {
  return min === max ? signed(min) : `${signed(min)} to ${signed(max)}`;
}

/** "850 ms", "4.2 s", "24 s", "2 min 11 s": exact when short, readable when long. */
export function formatAnswerTime(ms: number): string {
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

/** How long a task's one-line title may run before it is cut. */
const TITLE_CHARS = 90;

/**
 * A task's request as one short line: without the day and time it opens with, and the answer
 * format it closes on, so the line says what is asked. The whole request stays behind Details.
 */
export function taskTitle(prompt: string): string {
  const flat = prompt.replace(/\s+/g, ' ').trim();
  const asked = flat
    .replace(/^(?:Today is|It's|It is)\b[^.?!]*\b\d{4}\b[^.?!]*[.?!]\s+/i, '')
    .replace(/\s*End with\b.*$/i, '')
    .trim();
  return clip(asked === '' ? flat : asked, TITLE_CHARS);
}

/** Shortens text to one line's worth, ending on a whole word where it can. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${space > max * 0.6 ? cut.slice(0, space) : cut}\u2026`;
}
