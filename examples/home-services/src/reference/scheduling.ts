import { findOne } from '../company/lookup';
import type {
  Booking,
  ServiceRequest,
  Technician,
  TimeWindow,
  TravelTime,
  Zone,
} from '../company/types';
import { addDays, clockTime, minutesOf, weekdayOf } from '../lib/calendar';
import { compareText } from '../lib/compare';

/**
 * Ground truth for scheduling, written straight from the "Scheduling" section of policy.md.
 * Times are minutes after midnight.
 */

export interface SchedulingRules {
  /** Nothing is booked on this date or before it. */
  businessDate: string;
  closedDates: readonly string[];
  /** Bookings start on multiples of this many minutes. */
  slotMinutes: number;
  /** Morning visits end by this time and afternoon visits start at it or later. */
  noon: number;
}

export interface BookedTime {
  zone: Zone;
  start: number;
  end: number;
}

/** What the scheduler looks at: the crew, their existing bookings and the travel times. */
export interface Schedule {
  technicians: readonly Technician[];
  /** A technician's bookings on a date, earliest first. */
  bookingsOn(technicianId: string, date: string): readonly BookedTime[];
  travelMinutes(from: Zone, to: Zone): number;
}

export interface EarliestSlot {
  date: string;
  start_time: string;
  end_time: string;
  /** Every technician who can start at that time. */
  technician_ids: string[];
}

/**
 * The rules a start time can break once the technician is qualified and working that day, in the
 * order policy.md states them.
 */
export type SlotProblem = 'hours' | 'window' | 'overlap' | 'drive_from_previous' | 'drive_to_next';

const SLOT_RULES: readonly SlotProblem[] = [
  'hours',
  'window',
  'overlap',
  'drive_from_previous',
  'drive_to_next',
];

/** How far ahead the search looks. Existing bookings end within three weeks, so this is ample. */
const SEARCH_DAYS = 60;

export function buildSchedule(
  technicians: readonly Technician[],
  bookings: readonly Booking[],
  travel: readonly TravelTime[],
): Schedule {
  const byTechnicianDay = new Map<string, BookedTime[]>();
  for (const booking of bookings) {
    const key = `${booking.technician_id} ${booking.date}`;
    const day = byTechnicianDay.get(key) ?? [];
    day.push({
      zone: booking.zone,
      start: minutesOf(booking.start_time),
      end: minutesOf(booking.end_time),
    });
    byTechnicianDay.set(key, day);
  }
  for (const day of byTechnicianDay.values()) day.sort((a, b) => a.start - b.start);

  return {
    technicians,
    bookingsOn: (technicianId, date) => byTechnicianDay.get(`${technicianId} ${date}`) ?? [],
    travelMinutes: (from, to) =>
      findOne(travel, (t) => t.from_zone === from && t.to_zone === to, `travel ${from} to ${to}`)
        .minutes,
  };
}

/** The later of the day after the business date and the request's earliest_date. */
export function firstBookableDate(request: ServiceRequest, rules: SchedulingRules): string {
  const tomorrow = addDays(rules.businessDate, 1);
  return request.earliest_date > tomorrow ? request.earliest_date : tomorrow;
}

function isQualified(technician: Technician, request: ServiceRequest): boolean {
  return (
    technician.skills.includes(request.skill) &&
    (request.license_needed === null || technician.licenses.includes(request.license_needed))
  );
}

/** A morning visit ends by noon and an afternoon visit starts at noon or later. */
function fitsWindow(window: TimeWindow, start: number, end: number, noon: number): boolean {
  if (window === 'morning') return end <= noon;
  if (window === 'afternoon') return start >= noon;
  return true;
}

/**
 * The first rule a booking at `start` would break for this technician, or null when it breaks
 * none: it must fit in their hours and the customer's window, overlap none of their bookings that
 * day, leave time to drive over from the booking before it, and end early enough to drive on to
 * the booking after it. `ignoring` leaves one rule out, to find the slot a booker who forgets it
 * would choose.
 */
export function slotProblem(
  schedule: Schedule,
  rules: SchedulingRules,
  technician: Technician,
  request: ServiceRequest,
  date: string,
  start: number,
  ignoring?: SlotProblem,
): SlotProblem | null {
  const end = start + request.duration_minutes;
  const sameDay = schedule.bookingsOn(technician.technician_id, date);
  const before = sameDay.filter((booking) => booking.end <= start).at(-1);
  const after = sameDay.find((booking) => booking.start >= end);
  const breaks: Record<SlotProblem, () => boolean> = {
    hours: () => start < minutesOf(technician.start_time) || end > minutesOf(technician.end_time),
    window: () => !fitsWindow(request.window, start, end, rules.noon),
    overlap: () => sameDay.some((booking) => booking.start < end && start < booking.end),
    drive_from_previous: () =>
      before !== undefined &&
      before.end + schedule.travelMinutes(before.zone, request.zone) > start,
    drive_to_next: () =>
      after !== undefined && end + schedule.travelMinutes(request.zone, after.zone) > after.start,
  };
  return SLOT_RULES.find((problem) => problem !== ignoring && breaks[problem]()) ?? null;
}

/** The technician's earliest feasible start on that date, or null when there is none. */
function earliestStartOnDay(
  schedule: Schedule,
  rules: SchedulingRules,
  technician: Technician,
  request: ServiceRequest,
  date: string,
  ignoring: SlotProblem | undefined,
): number | null {
  if (!isQualified(technician, request)) return null;
  if (!technician.work_days.includes(weekdayOf(date))) return null;
  const dayStart = minutesOf(technician.start_time);
  const dayEnd = minutesOf(technician.end_time);
  const firstSlot = Math.ceil(dayStart / rules.slotMinutes) * rules.slotMinutes;
  for (
    let start = firstSlot;
    start + request.duration_minutes <= dayEnd;
    start += rules.slotMinutes
  ) {
    if (slotProblem(schedule, rules, technician, request, date, start, ignoring) === null) {
      return start;
    }
  }
  return null;
}

/**
 * The earliest feasible start across all technicians and days, and everyone who can take it. With
 * `ignoring`, the earliest start once that one rule is left out.
 */
export function earliestSlot(
  schedule: Schedule,
  rules: SchedulingRules,
  request: ServiceRequest,
  ignoring?: SlotProblem,
): EarliestSlot {
  const first = firstBookableDate(request, rules);
  for (let offset = 0; offset < SEARCH_DAYS; offset++) {
    const date = addDays(first, offset);
    if (rules.closedDates.includes(date)) continue;

    const options: { technicianId: string; start: number }[] = [];
    for (const technician of schedule.technicians) {
      const start = earliestStartOnDay(schedule, rules, technician, request, date, ignoring);
      if (start !== null) options.push({ technicianId: technician.technician_id, start });
    }
    if (options.length === 0) continue;

    const best = Math.min(...options.map((option) => option.start));
    return {
      date,
      start_time: clockTime(best),
      end_time: clockTime(best + request.duration_minutes),
      technician_ids: options
        .filter((option) => option.start === best)
        .map((option) => option.technicianId)
        .sort(compareText),
    };
  }
  throw new Error(`No slot within ${SEARCH_DAYS} days for request ${request.request_id}`);
}
