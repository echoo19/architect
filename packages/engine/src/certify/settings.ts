import type { Job } from '@architect/shared';

/** The share of taught tasks a calibration split takes when the job doesn't say. */
const DEFAULT_SHARE = 0.15;
/** ...and the fewest it takes when there are that many to spare. */
const DEFAULT_LEAST = 30;

/**
 * How many tasks of the organizations a job trains on its calibration split takes (decision
 * 077): none without a certificate setting, the size it names, or 15% of `trained`, at least 30,
 * from what the other splits leave.
 */
export function calibrationSize(job: Job, trained: number): number {
  const settings = job.evaluation.certify;
  if (settings === undefined) return 0;
  if (settings.calibration !== undefined) return settings.calibration;
  const { calibration, train, dev, test } = job.splits;
  const spare = trained - (calibration + train + dev + test);
  return Math.max(0, Math.min(spare, Math.max(Math.ceil(DEFAULT_SHARE * trained), DEFAULT_LEAST)));
}

/**
 * The attempts a certified locked test makes beyond its first seed's: k - 1 more at each of its
 * `lockedTests` tasks and k at each of `calibration` tasks. None without a certificate.
 */
export function certifyAttempts(job: Job, lockedTests: number, calibration: number): number {
  const k = job.evaluation.certify?.k;
  if (k === undefined || calibration === 0) return 0;
  return (k - 1) * lockedTests + k * calibration;
}
