import type { Weekday } from '../lib/calendar';
import type { Carrier, Category, Region } from '../shop/types';

/**
 * The numbers in policy.md. The policy text, the generator and the reference rules all read them
 * from here, so the document can't drift from the ground truth.
 */

export const SHOP_NAME = 'Larchwood Outfitters';

/** The records are current as of this date, a Tuesday. */
export const BUSINESS_DATE = '2026-11-24';

/** Thanksgiving: no carrier picks up. */
export const HOLIDAY = '2026-11-26';
export const HOLIDAY_NAME = 'Thanksgiving';

/** Days after delivery a return is on time: everyone, with member perks, and defective items. */
export const RETURN_DAYS = 30;
export const MEMBER_RETURN_DAYS = 60;
export const DEFECTIVE_RETURN_DAYS = 90;

/** Opened items in these categories pay this share of the item amount to be restocked. */
export const RESTOCKING_PCT = 15;
export const RESTOCKING_CATEGORIES: readonly Category[] = ['tents', 'sleeping', 'electronics'];

/** The prepaid return label, charged to customers without member perks. */
export const RETURN_LABEL_CENTS = 695;

/** A pickup booked before this time can be for tomorrow. */
export const PICKUP_CUTOFF = '14:00';

/** Most returns a carrier collects in a day. */
export const PICKUP_CAPACITY = 3;

interface CarrierRules {
  /** The regions it serves for parcels that aren't bulky. */
  regions: readonly Region[];
  /** Whether it takes bulky products, from every region. */
  bulky: boolean;
  days: readonly Weekday[];
}

export const CARRIERS: Readonly<Record<Carrier, CarrierRules>> = {
  'Cedarline Parcel': {
    regions: ['Lakeshore', 'Valley'],
    bulky: false,
    days: ['Mon', 'Tue', 'Thu', 'Fri'],
  },
  'Kettlepoint Courier': {
    regions: ['Foothills', 'Uplands'],
    bulky: false,
    days: ['Mon', 'Wed', 'Fri', 'Sat'],
  },
  'Basalt Freight': { regions: [], bulky: true, days: ['Tue', 'Thu'] },
};

export const CARRIER_NAMES = Object.keys(CARRIERS) as Carrier[];

/** A return takes the number of the request it decides: RQ-5012 gets RT-5012. */
export function returnIdFor(requestId: string): string {
  const match = /^RQ-(\d+)$/.exec(requestId);
  if (!match) throw new Error(`Not a request id: ${requestId}`);
  return `RT-${match[1]}`;
}

/** A pickup takes the number of the return it collects: RT-4410 gets PU-4410. */
export function pickupIdFor(returnId: string): string {
  const match = /^RT-(\d+)$/.exec(returnId);
  if (!match) throw new Error(`Not a return id: ${returnId}`);
  return `PU-${match[1]}`;
}
