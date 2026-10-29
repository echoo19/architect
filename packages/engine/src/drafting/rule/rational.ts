import type { RuleRounding } from '@architect/shared';
import type { Decimal } from '../values';

/*
 * Exact arithmetic for rules. A number is a fraction of two integers, so a sum, a product or a
 * division by a literal is never off by the last digit the way a floating-point number can be.
 * Nothing is rounded until a rule says to.
 */

/** A fraction in lowest terms with a positive denominator. */
export interface Q {
  readonly n: bigint;
  readonly d: bigint;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x;
}

export function fraction(n: bigint, d: bigint = 1n): Q {
  if (d === 0n) throw new RangeError('A fraction needs a denominator that is not zero.');
  const divisor = gcd(n, d) || 1n;
  const sign = d < 0n ? -1n : 1n;
  return { n: (sign * n) / divisor, d: (sign * d) / divisor };
}

export const ZERO: Q = fraction(0n);
export const ONE: Q = fraction(1n);
const HALF: Q = fraction(1n, 2n);

/** The number a decimal text spells, exactly: `-12.345`, `65`, `.5` is not one. Null otherwise. */
export function fromText(text: string): Q | null {
  const found = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!found) return null;
  const places = (found[3] ?? '').length;
  const units = BigInt(`${found[2]}${found[3] ?? ''}`);
  return fraction(found[1] === '-' ? -units : units, 10n ** BigInt(places));
}

/** A number read from a cell, as the fraction it is. */
export function fromDecimal(value: Decimal): Q {
  return fraction(value.units, 10n ** BigInt(value.places));
}

export const add = (a: Q, b: Q): Q => fraction(a.n * b.d + b.n * a.d, a.d * b.d);
export const sub = (a: Q, b: Q): Q => fraction(a.n * b.d - b.n * a.d, a.d * b.d);
export const mul = (a: Q, b: Q): Q => fraction(a.n * b.n, a.d * b.d);

/** `a` divided by `b`, which must not be zero. */
export const div = (a: Q, b: Q): Q => fraction(a.n * b.d, a.d * b.n);

export function compare(a: Q, b: Q): -1 | 0 | 1 {
  const left = a.n * b.d;
  const right = b.n * a.d;
  return left < right ? -1 : left > right ? 1 : 0;
}

export const equal = (a: Q, b: Q): boolean => compare(a, b) === 0;
export const isZero = (a: Q): boolean => a.n === 0n;
export const isNegative = (a: Q): boolean => a.n < 0n;

/** The largest integer not above the number. */
export function floor(value: Q): bigint {
  const quotient = value.n / value.d;
  return value.n < 0n && quotient * value.d !== value.n ? quotient - 1n : quotient;
}

/** The smallest integer not below the number. */
export function ceil(value: Q): bigint {
  return -floor(fraction(-value.n, value.d));
}

/**
 * The multiple of `increment` a rounding step gives: `up` to the next at or above, `down` to the
 * next at or below, `half_up` to the nearest with a tie going up. The increment must be above zero.
 */
export function roundTo(value: Q, increment: Q, mode: RuleRounding): Q {
  const steps = div(value, increment);
  const whole =
    mode === 'up' ? ceil(steps) : mode === 'down' ? floor(steps) : floor(add(steps, HALF));
  return mul(fraction(whole), increment);
}

/** Whether the number is a multiple of the increment. */
export function isMultiple(value: Q, increment: Q): boolean {
  return div(value, increment).d === 1n;
}

/** How far a number is past the multiple of `increment` below it, in `[0, increment)`. */
export function pastStep(value: Q, increment: Q): Q {
  return sub(value, mul(fraction(floor(div(value, increment))), increment));
}

export const abs = (a: Q): Q => (a.n < 0n ? fraction(-a.n, a.d) : a);

/**
 * The number as decimal text. One that ends within `places` digits after the point is written out
 * in full; any other is cut at `places` digits and marked as not exact.
 */
export function toText(value: Q, places = 8): { text: string; exact: boolean } {
  const negative = value.n < 0n;
  const scale = 10n ** BigInt(places);
  const magnitude = ((negative ? -value.n : value.n) * scale) / value.d;
  const digits = magnitude.toString().padStart(places + 1, '0');
  const whole = digits.slice(0, digits.length - places);
  const fractionDigits = digits.slice(digits.length - places).replace(/0+$/, '');
  const sign = negative && magnitude !== 0n ? '-' : '';
  return {
    text: `${sign}${whole}${fractionDigits === '' ? '' : `.${fractionDigits}`}`,
    exact: scale % value.d === 0n,
  };
}

/** The number as a JavaScript number, for an expected answer that is already a short decimal. */
export const toNumber = (value: Q): number => Number(toText(value, 8).text);

/** The digits after the point a number needs, up to `limit`. */
export function placesOf(value: Q, limit = 8): number {
  const { text } = toText(value, limit);
  const point = text.indexOf('.');
  return point < 0 ? 0 : text.length - point - 1;
}
