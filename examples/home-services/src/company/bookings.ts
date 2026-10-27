import { clockTime, datesFrom, minutesOf, weekdayOf } from '../lib/calendar';
import { compareText } from '../lib/compare';
import type { Random } from '../lib/random';
import { BUSINESS_DATE, CLOSED_DATES, SLOT_MINUTES } from '../policy/rules';
import { TECHNICIANS, TRAVEL_TIMES, ZONES } from './catalog';
import { findOne } from './lookup';
import type { Booking, Technician, Zone } from './types';

/** Existing bookings run from the business date through this day. */
const BOOKINGS_UNTIL = '2026-11-21';

/**
 * Desmond (one of two backflow testers) and Owen (one of two master electricians) are booked
 * solid until this day, so some licensed requests wait for the other license holder.
 */
const RUSHED = new Set(['T-02', 'T-04']);
const RUSH_UNTIL = '2026-11-13';
/** The rest of the crew is fairly busy until this day, then the calendar thins out. */
const BUSY_UNTIL = '2026-11-10';

type Load = 'light' | 'normal' | 'heavy';

const BOOKINGS_PER_DAY: Record<Load, readonly (readonly [number, number])[]> = {
  light: [
    [0, 4],
    [1, 4],
    [2, 2],
  ],
  normal: [
    [0, 2],
    [1, 3],
    [2, 3],
    [3, 2],
  ],
  heavy: [
    [3, 3],
    [4, 4],
    [5, 1],
  ],
};

/** Minutes between the start of a technician's day and their first booking. */
const FIRST_BOOKING_OFFSET: readonly (readonly [number, number])[] = [
  [0, 3],
  [30, 1],
  [60, 2],
  [120, 2],
  [180, 2],
  [240, 1],
];

const FIRST_BOOKING_NUMBER = 2001;

/**
 * The calendar the scheduler works against. Each technician's day is a chain of bookings that
 * already respects working hours, the half-hour grid and travel between zones.
 */
export function buildBookings(random: Random): Booking[] {
  const planned: Omit<Booking, 'booking_id' | 'request_id'>[] = [];
  for (const date of datesFrom(BUSINESS_DATE, BOOKINGS_UNTIL)) {
    if (CLOSED_DATES.includes(date)) continue;
    for (const technician of TECHNICIANS) {
      if (technician.work_days.includes(weekdayOf(date))) {
        planned.push(...dayOfBookings(random, technician, date));
      }
    }
  }
  planned.sort(
    (a, b) =>
      compareText(a.date, b.date) ||
      compareText(a.start_time, b.start_time) ||
      compareText(a.technician_id, b.technician_id),
  );
  // Each booking carries the number of the (now closed) request it booked.
  return planned.map((booking, index) => ({
    booking_id: `B-${FIRST_BOOKING_NUMBER + index}`,
    request_id: `R-${FIRST_BOOKING_NUMBER + index}`,
    ...booking,
  }));
}

function dayOfBookings(
  random: Random,
  technician: Technician,
  date: string,
): Omit<Booking, 'booking_id' | 'request_id'>[] {
  const load = loadOn(technician, date);
  const target = random.weighted(BOOKINGS_PER_DAY[load]);
  const dayEnd = minutesOf(technician.end_time);
  let ready =
    minutesOf(technician.start_time) +
    (load === 'heavy' ? 0 : random.weighted(FIRST_BOOKING_OFFSET));
  let previousZone: Zone | null = null;
  const day: Omit<Booking, 'booking_id' | 'request_id'>[] = [];

  for (let k = 0; k < target; k++) {
    const zone = random.pick(ZONES);
    const duration = random.pick([60, 90, 90, 120, 120, 150, 180]);
    const travel = previousZone === null ? 0 : travelMinutes(previousZone, zone);
    const start = Math.ceil((ready + travel) / SLOT_MINUTES) * SLOT_MINUTES;
    if (start + duration > dayEnd) break;
    day.push({
      technician_id: technician.technician_id,
      date,
      start_time: clockTime(start),
      end_time: clockTime(start + duration),
      zone,
    });
    previousZone = zone;
    ready = start + duration + (load === 'heavy' ? 0 : random.pick([0, 0, 0, 30, 60, 90]));
  }
  return day;
}

function loadOn(technician: Technician, date: string): Load {
  if (RUSHED.has(technician.technician_id) && date <= RUSH_UNTIL) return 'heavy';
  return date <= BUSY_UNTIL ? 'normal' : 'light';
}

function travelMinutes(from: Zone, to: Zone): number {
  return findOne(TRAVEL_TIMES, (t) => t.from_zone === from && t.to_zone === to, `${from} ${to}`)
    .minutes;
}
