import type { Zone } from '../company/types';

/**
 * The numbers in policy.md. The policy text, the data generator and the reference calculations
 * all read them from here, so the document can't drift from the ground truth.
 */

/** The records are current as of this date, a Thursday. */
export const BUSINESS_DATE = '2026-11-05';

/** The staff training day: the office takes no bookings. */
export const CLOSED_DATES: readonly string[] = ['2026-11-11'];

/** Bookings start on the hour or half hour. */
export const SLOT_MINUTES = 30;

/** Labor is billed in quarter hours, rounded up, with a one-hour minimum. */
export const BILLING_STEP_MINUTES = 15;
export const MINIMUM_BILLED_MINUTES = 60;

/** After-hours labor costs 1.5 times the hourly rate, kept as a fraction for exact arithmetic. */
export const AFTER_HOURS_FACTOR = { numerator: 3, denominator: 2 } as const;

/** Plan members get this percentage off labor. */
export const PLAN_DISCOUNT_PCT = 10;

export const TRIP_FEE_CENTS: Readonly<Record<Zone, number>> = {
  Harbor: 3900,
  'Old Town': 3900,
  Millbrook: 5500,
  Ridge: 5500,
  Lakeside: 6900,
};

/**
 * An invoice takes the number of the job it bills: W-2482 gets INV-2482. Each task's answer then
 * follows from its own job, so no single id is right for every invoice task.
 */
export function invoiceIdFor(jobId: string): string {
  const match = /^W-(\d+)$/.exec(jobId);
  if (!match) throw new Error(`Not a job id: ${jobId}`);
  return `INV-${match[1]}`;
}

/** A booking takes the number of the request it books: R-3042 gets B-3042. */
export function bookingIdFor(requestId: string): string {
  const match = /^R-(\d+)$/.exec(requestId);
  if (!match) throw new Error(`Not a request id: ${requestId}`);
  return `B-${match[1]}`;
}
