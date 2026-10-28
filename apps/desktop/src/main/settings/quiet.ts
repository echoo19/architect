import { cpus } from 'node:os';
import type { AppSettings } from '@architect/shared';

/**
 * The CPU-thread cap for local models when quiet mode is on: a quarter of the logical cores,
 * about half the physical ones, and never fewer than two. Undefined leaves each runtime its own
 * default.
 */
/**
 * How long local models rest after each reply in quiet mode, as a share of the time the reply
 * took: the GPU then draws a little over half its full-load power on average.
 */
export function quietCooldown(settings: Pick<AppSettings, 'quietLocalModels'>): number | undefined {
  return settings.quietLocalModels ? 0.75 : undefined;
}

export function quietThreads(
  settings: Pick<AppSettings, 'quietLocalModels'>,
  logicalCores = cpus().length,
): number | undefined {
  return settings.quietLocalModels ? Math.max(2, Math.round(logicalCores / 4)) : undefined;
}
