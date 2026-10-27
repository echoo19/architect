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

export const INVOICE_ID_PREFIX = 'INV-';
const INVOICE_ID_DIGITS = 5;

export function invoiceId(number: number): string {
  return `${INVOICE_ID_PREFIX}${String(number).padStart(INVOICE_ID_DIGITS, '0')}`;
}

/** A booking takes the number of the request it books: R-3042 gets B-3042. */
export function bookingIdFor(requestId: string): string {
  const match = /^R-(\d+)$/.exec(requestId);
  if (!match) throw new Error(`Not a request id: ${requestId}`);
  return `B-${match[1]}`;
}
