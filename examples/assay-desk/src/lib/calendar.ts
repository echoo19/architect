/** A YYYY-MM-DD date moved by whole days. */
export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
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

/** "Monday, November 16, 2026" for 2026-11-16. */
export function longDate(date: string): string {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]!;
  return `${weekday}, ${MONTHS[month - 1]!} ${day}, ${year}`;
}

/** "November 16, 2026" for 2026-11-16. */
export function monthDay(date: string): string {
  return longDate(date).split(', ').slice(1).join(', ');
}
