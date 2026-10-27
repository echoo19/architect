import { DataError } from './errors';

/**
 * Normalizes a value written to a table into what loading the CSV again would give: text, or
 * null for an empty cell.
 */
export function toCell(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value === '' ? null : value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new DataError(`${label} must be a finite number.`);
    return String(value);
  }
  throw new DataError(`${label} must be text, a number, true or false, or null.`);
}
