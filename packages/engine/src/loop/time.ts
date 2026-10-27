import type { Clock } from './deps';

export function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}

/** The local calendar date, `YYYY-MM-DD`. */
export function localDate(ms: number): string {
  const date = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
