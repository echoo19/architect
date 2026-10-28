import { addDays, minutesOf, weekdayOf } from '../lib/calendar';
import { CARRIERS, CARRIER_NAMES, HOLIDAY, PICKUP_CAPACITY, PICKUP_CUTOFF } from '../policy/rules';
import type { Carrier, Region } from '../shop/types';

/** Ground truth for pickups, written straight from the "Pickups" section of policy.md. */

/** Far enough ahead for any pickup: busy days fill a few weeks at most. */
const SEARCH_DAYS = 60;

/** A bulky product goes with the freight carrier; anything else with the region's carrier. */
export function carrierFor(region: Region, bulky: boolean): Carrier {
  const carrier = CARRIER_NAMES.find((name) =>
    bulky ? CARRIERS[name].bulky : CARRIERS[name].regions.includes(region),
  );
  if (!carrier) throw new Error(`No carrier for ${region}${bulky ? ', bulky' : ''}`);
  return carrier;
}

/** Tomorrow when booked before the cutoff, otherwise the day after tomorrow. */
export function firstPickupDate(today: string, bookedAt: string): string {
  return addDays(today, minutesOf(bookedAt) < minutesOf(PICKUP_CUTOFF) ? 1 : 2);
}

export interface PickupRequest {
  carrier: Carrier;
  today: string;
  /** The time of day the pickup is booked, HH:MM. */
  bookedAt: string;
  /** The first day the customer can hand the parcel over, or null when any day works. */
  readyFrom: string | null;
  /** Pickups the carrier already has on a date. */
  bookedOn(date: string): number;
}

/** Why a date can't take the pickup, in the order the policy states the rules. */
export type PickupProblem = 'too_soon' | 'not_ready' | 'not_a_pickup_day' | 'holiday' | 'full';

/**
 * The first rule a pickup on `date` breaks, or null when it breaks none. `ignoring` leaves one
 * rule out, to find the date a booker who forgets that rule would choose.
 */
function pickupProblem(
  request: PickupRequest,
  date: string,
  ignoring?: PickupProblem,
): PickupProblem | null {
  const breaks: Record<PickupProblem, () => boolean> = {
    too_soon: () => date < firstPickupDate(request.today, request.bookedAt),
    not_ready: () => request.readyFrom !== null && date < request.readyFrom,
    not_a_pickup_day: () => !CARRIERS[request.carrier].days.includes(weekdayOf(date)),
    holiday: () => date === HOLIDAY,
    full: () => request.bookedOn(date) >= PICKUP_CAPACITY,
  };
  return PICKUP_RULES.find((rule) => rule !== ignoring && breaks[rule]()) ?? null;
}

const PICKUP_RULES: readonly PickupProblem[] = [
  'too_soon',
  'not_ready',
  'not_a_pickup_day',
  'holiday',
  'full',
];

/** The earliest date that passes every rule, or every rule but `ignoring`. */
export function earliestPickup(request: PickupRequest, ignoring?: PickupProblem): string {
  let date = addDays(request.today, 1);
  for (let tried = 0; tried < SEARCH_DAYS; tried++, date = addDays(date, 1)) {
    if (pickupProblem(request, date, ignoring) === null) return date;
  }
  throw new Error(`No pickup date for ${request.carrier} within ${SEARCH_DAYS} days`);
}
