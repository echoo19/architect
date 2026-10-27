import { afterEach, describe, expect, it, vi } from 'vitest';
import { calculate, CalculationError, MAX_EXPRESSION_LENGTH } from '../src/tools/calculator';

afterEach(() => vi.restoreAllMocks());

describe('calculate', () => {
  it.each([
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['10 - 4 - 3', 3],
    ['100 / 10 / 5', 2],
    ['2 * -3', -6],
    ['-(1 + 2) * 2', -6],
    ['--4', 4],
    ['+5 - -5', 10],
    ['7 % 3', 1],
    ['-7 % 3', -1],
    ['7.5 % 2', 1.5],
    ['1 / 4', 0.25],
    ['1e3 + 1', 1001],
    ['.5 + 2.', 2.5],
    ['  12  ', 12],
  ])('follows precedence: %s = %d', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each([
    ['0.1 + 0.2', 0.3],
    ['round(1.005, 2)', 1.01],
    ['round(2.5)', 3],
    ['round(-2.5)', -3],
    ['round(2.4999)', 2],
    ['round(92.55, 1)', 92.6],
    ['round(12345 * 0.0825)', 1018],
    ['round(1234.5678, -2)', 1200],
    ['floor(-2.5)', -3],
    ['ceil(-2.5)', -2],
    ['floor(7)', 7],
    ['abs(-3.25)', 3.25],
    ['min(3, -1, 2)', -1],
    ['max(3, -1, 2)', 3],
    ['ROUND(2.5)', 3],
    ['1 / 3', 0.3333333333333333],
    ['2 / 3 * 3', 2],
  ])('is exact with decimals and rounds half away from zero: %s = %d', (expression, expected) => {
    expect(calculate(expression)).toBe(expected);
  });

  it.each([
    ['1 / 0', 'Division by zero at position 3.'],
    ['5 % (2 - 2)', 'Remainder by zero at position 3.'],
    ['2 ** 3', 'Powers are not supported (position 3); multiply instead.'],
    ['2 ^ 3', 'Unexpected "^" at position 3. Powers are not supported; multiply instead.'],
    ['$5 + 1', 'Unexpected "$" at position 1. Write plain numbers without currency symbols.'],
    [
      '1,234 + 1',
      'Unexpected "," at position 2. Write numbers without thousands separators, like 1234.5.',
    ],
    ['3 x 4', 'Unknown name "x" at position 3. Use * to multiply.'],
    ['3 × 4', 'Unexpected "×" at position 3. Use * to multiply.'],
    [
      'sqrt(4)',
      'Unknown name "sqrt" at position 1. The functions are round, floor, ceil, abs, min, max.',
    ],
    ['round(1, 2, 3)', 'round takes 1 to 2 arguments, but got 3.'],
    ['floor()', 'floor takes 1 argument, but got 0.'],
    ['min()', 'min takes at least 1 argument, but got 0.'],
    [
      'round(1, 0.5)',
      "round's second argument is the number of decimal places: a whole number from -15 to 15.",
    ],
    ['round 2', 'round needs its arguments in parentheses, like round(2.5).'],
    ['(1 + 2', 'Missing ")" for the "(" at position 1.'],
    ['1 + 2)', 'Unexpected ")" at position 6, with no "(" to close.'],
    ['1 +', 'The expression ends too early.'],
    ['1 2', 'Unexpected "2" at position 3.'],
    ['   ', 'The expression is empty.'],
    ['1e999', 'The number at position 1 is out of range.'],
    ['total = 5', 'Unexpected "=" at position 7. Write only the expression, without "=".'],
    [
      'total + 5',
      'Unknown name "total" at position 1. The functions are round, floor, ceil, abs, min, max.',
    ],
  ])('explains what is wrong with %s', (expression, message) => {
    expect(() => calculate(expression)).toThrow(new CalculationError(message));
  });

  it('limits length and nesting', () => {
    expect(() => calculate('1+'.repeat(MAX_EXPRESSION_LENGTH))).toThrow(/too long/);
    expect(() => calculate(`${'('.repeat(100)}1${')'.repeat(100)}`)).toThrow(/nested too deeply/);
  });

  it('never evaluates the text as code', () => {
    const evalSpy = vi.spyOn(globalThis, 'eval');
    for (const attack of [
      'process.exit(1)',
      'constructor.constructor("return 1")()',
      'this',
      '[].map',
      '`1`',
    ]) {
      expect(() => calculate(attack)).toThrow(CalculationError);
    }
    expect(calculate('round(1.005, 2) + 1')).toBe(2.01);
    expect(evalSpy).not.toHaveBeenCalled();
  });
});
