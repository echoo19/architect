import type { Clock } from './deps';

export function isoNow(clock: Clock): string {
  return new Date(clock.now()).toISOString();
}
