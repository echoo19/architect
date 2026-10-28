/** Calendar dates as ISO strings (YYYY-MM-DD), so comparing two of them as text compares the dates. */

export type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

const MS_PER_DAY = 86_400_000;
/** In the order of `Date.prototype.getUTCDay`. */
const WEEKDAYS: readonly Weekday[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const WEEKDAY_NAMES: Readonly<Record<Weekday, string>> = {
  Mon: 'Monday',
  Tue: 'Tuesday',
  Wed: 'Wednesday',
  Thu: 'Thursday',
  Fri: 'Friday',
  Sat: 'Saturday',
  Sun: 'Sunday',
};
export const MONTH_NAMES: readonly string[] = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Days since 1970-01-01. Throws on anything that isn't a real YYYY-MM-DD date. */
function dayNumber(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error(`Not a YYYY-MM-DD date: ${date}`);
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / MS_PER_DAY;
  if (dateOfDay(day) !== date) throw new Error(`No such date: ${date}`);
  return day;
}

function dateOfDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

export function isIsoDate(text: string): boolean {
  try {
    dayNumber(text);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, days: number): string {
  return dateOfDay(dayNumber(date) + days);
}

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function weekdayOf(date: string): Weekday {
  const weekday = WEEKDAYS[new Date(dayNumber(date) * MS_PER_DAY).getUTCDay()];
  if (!weekday) throw new Error(`No weekday for ${date}`);
  return weekday;
}

/** Every date from `first` to `last`, both included. */
export function datesFrom(first: string, last: string): string[] {
  const dates: string[] = [];
  for (let day = dayNumber(first); day <= dayNumber(last); day++) dates.push(dateOfDay(day));
  return dates;
}

/** "Tuesday, November 24, 2026" */
export function longDate(date: string): string {
  return `${WEEKDAY_NAMES[weekdayOf(date)]}, ${monthDayYear(date)}`;
}

/** "November 24, 2026" */
export function monthDayYear(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${MONTH_NAMES[(month ?? 1) - 1]} ${day}, ${year}`;
}

/** "October 2026" for a month written YYYY-MM. */
export function monthName(month: string): string {
  const [year, number] = month.split('-').map(Number);
  return `${MONTH_NAMES[(number ?? 1) - 1]} ${year}`;
}

/** The first and last day of a month written YYYY-MM. */
export function monthSpan(month: string): { first: string; last: string } {
  const first = `${month}-01`;
  const [year, number] = month.split('-').map(Number) as [number, number];
  const next =
    number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
  return { first, last: addDays(next, -1) };
}

/** Minutes after midnight for an HH:MM time. */
export function minutesOf(time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match) throw new Error(`Not an HH:MM time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}
