const DECIMAL = /^(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;
/** Digits kept when converting to a double: more than a double holds, so it rounds correctly. */
const SIGNIFICANT_DIGITS = 30;

/**
 * An exact fraction. The calculator works in fractions so that money arithmetic comes out the
 * way it is written: 0.1 + 0.2 is 0.3, and round(1.005, 2) is 1.01.
 */
export class Rational {
  private constructor(
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  static of(numerator: bigint, denominator = 1n): Rational {
    if (denominator === 0n) throw new RangeError('A fraction cannot have a zero denominator.');
    const sign = denominator < 0n ? -1n : 1n;
    const divisor = gcd(abs(numerator), abs(denominator));
    return new Rational((sign * numerator) / divisor, (sign * denominator) / divisor);
  }

  /** Parses unsigned decimal notation such as `12`, `0.075`, `.5` or `1.5e3`. */
  static parseDecimal(text: string): Rational {
    const match = DECIMAL.exec(text);
    if (!match) throw new RangeError(`Not a decimal number: ${text}`);
    const [, whole = '', fraction = '', exponent = '0'] = match;
    const digits = BigInt(`${whole}${fraction}` || '0');
    const scale = fraction.length - Number(exponent);
    return scale >= 0
      ? Rational.of(digits, 10n ** BigInt(scale))
      : Rational.of(digits * 10n ** BigInt(-scale));
  }

  plus(other: Rational): Rational {
    return Rational.of(
      this.numerator * other.denominator + other.numerator * this.denominator,
      this.denominator * other.denominator,
    );
  }

  minus(other: Rational): Rational {
    return this.plus(other.negate());
  }

  times(other: Rational): Rational {
    return Rational.of(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  /** Callers check for a zero divisor first, to report it in their own words. */
  dividedBy(other: Rational): Rational {
    return Rational.of(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  /** Remainder with the sign of the dividend, as JavaScript's `%` gives. */
  remainder(other: Rational): Rational {
    const quotient = (this.numerator * other.denominator) / (this.denominator * other.numerator);
    return this.minus(other.times(Rational.of(quotient)));
  }

  negate(): Rational {
    return new Rational(-this.numerator, this.denominator);
  }

  abs(): Rational {
    return this.numerator < 0n ? this.negate() : this;
  }

  isZero(): boolean {
    return this.numerator === 0n;
  }

  isInteger(): boolean {
    return this.denominator === 1n;
  }

  compare(other: Rational): number {
    const difference = this.numerator * other.denominator - other.numerator * this.denominator;
    return difference < 0n ? -1 : difference > 0n ? 1 : 0;
  }

  floor(): Rational {
    // BigInt division truncates toward zero, so a negative value with a remainder needs one less.
    const quotient = this.numerator / this.denominator;
    const exact = quotient * this.denominator === this.numerator;
    return Rational.of(this.numerator < 0n && !exact ? quotient - 1n : quotient);
  }

  ceil(): Rational {
    return this.negate().floor().negate();
  }

  /** Rounds half away from zero. Negative `digits` round to tens, hundreds and so on. */
  round(digits: number): Rational {
    const power = Rational.of(10n ** BigInt(Math.abs(digits)));
    const factor = digits >= 0 ? power : Rational.of(1n).dividedBy(power);
    const scaled = this.times(factor);
    const magnitude = scaled.abs();
    // floor(|x| + 1/2), computed on the fraction n/d as (2n + d) / 2d.
    const nearest =
      (2n * magnitude.numerator + magnitude.denominator) / (2n * magnitude.denominator);
    return Rational.of(scaled.numerator < 0n ? -nearest : nearest).dividedBy(factor);
  }

  toNumber(): number {
    if (this.numerator === 0n) return 0;
    const magnitude = abs(this.numerator);
    const shift = Math.max(
      0,
      SIGNIFICANT_DIGITS - (magnitude.toString().length - this.denominator.toString().length),
    );
    const digits = (magnitude * 10n ** BigInt(shift)) / this.denominator;
    const value = Number(`${digits}e-${shift}`);
    return this.numerator < 0n ? -value : value;
  }
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a;
  let y = b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
}
