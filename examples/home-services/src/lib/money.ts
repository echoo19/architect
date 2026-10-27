/**
 * numerator / denominator rounded to a whole number, with exact halves rounded up (1717.5 → 1718).
 * Works on integers only, so no floating-point error can creep into a cent.
 */
export function roundHalfUp(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || numerator < 0) {
    throw new Error(`roundHalfUp needs a non-negative safe integer, got ${numerator}`);
  }
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new Error(`roundHalfUp needs a positive safe integer, got ${denominator}`);
  }
  // floor(n / d + 1/2) = floor((2n + d) / 2d), computed with an exact integer remainder.
  const doubled = 2 * numerator + denominator;
  const divisor = 2 * denominator;
  if (!Number.isSafeInteger(doubled)) throw new Error(`roundHalfUp overflow on ${numerator}`);
  return (doubled - (doubled % divisor)) / divisor;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** "$1,284.50" */
export function dollars(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const whole = Math.floor(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${whole}.${String(Math.abs(cents) % 100).padStart(2, '0')}`;
}
