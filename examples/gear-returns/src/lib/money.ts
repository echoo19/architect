/**
 * Money is whole cents everywhere in the code. numerator / denominator is rounded to a whole
 * number with exact halves going up (1948.5 becomes 1949), on integers only, so no floating-point
 * error can reach a cent.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error(`roundHalfUp needs a non-negative safe integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(`roundHalfUp needs a positive safe integer, got ${denominator}`);
  }
  const doubled = 2 * numerator + denominator;
  const divisor = 2 * denominator;
  return (doubled - (doubled % divisor)) / divisor;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Dollars and cents with no symbol or separator: 123450 is "1234.50". */
export function plainDollars(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0)
    throw new Error(`Not an amount in cents: ${cents}`);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/** "$1,234.50", for people reading summaries. */
export function dollars(cents: number): string {
  const [whole, fraction] = plainDollars(cents).split('.') as [string, string];
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
