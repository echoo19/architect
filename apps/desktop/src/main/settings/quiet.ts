import { cpus } from 'node:os';
import type { AppSettings } from '@architect/shared';

/**
 * The CPU-thread cap for local models when quiet mode is on: a quarter of the logical cores,
 * about half the physical ones, and never fewer than two. Undefined leaves each runtime its own
 * default.
 */
export function quietThreads(
  settings: Pick<AppSettings, 'quietLocalModels'>,
  logicalCores = cpus().length,
): number | undefined {
  return settings.quietLocalModels ? Math.max(2, Math.round(logicalCores / 4)) : undefined;
}
