import { describe, expect, it } from 'vitest';
import { numberProblem } from '../../../src/renderer/src/experiments/NumberRow';

describe('what is wrong with a number typed in a setting', () => {
  it('says why a value is refused', () => {
    expect(numberProblem('abc', {})).toBe('Enter a number');
    expect(numberProblem('', {})).toBe('Enter a number');
    expect(numberProblem('-10', {})).toBe("Can't be negative");
    expect(numberProblem('0.05', { min: 0.1 })).toBe('At least 0.1');
    expect(numberProblem('999999999999', { max: 10_000 })).toBe('At most 10,000');
    expect(numberProblem('2.5', { integer: true })).toBe('Use a whole number');
  });

  it('takes a value in range, and nothing where the runner decides', () => {
    expect(numberProblem('15', { max: 10_000 })).toBeNull();
    expect(numberProblem(' ', { optional: true })).toBeNull();
    expect(numberProblem('-3', { integer: true, min: -100 })).toBeNull();
  });
});
