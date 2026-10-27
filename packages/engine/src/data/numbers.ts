/** Plain decimal notation only: no hex, no thousands separators, no `Infinity`, no empty string. */
const DECIMAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** The number a cell or answer value spells, or null when it isn't plainly a finite number. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
