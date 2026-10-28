import { describe, expect, it } from 'vitest';
import { quietThreads } from '../../../src/main/settings/quiet';

describe('quietThreads', () => {
  it('leaves local models alone when quiet mode is off', () => {
    expect(quietThreads({ quietLocalModels: false }, 24)).toBeUndefined();
  });

  it('caps them at a quarter of the logical cores, and at least two', () => {
    expect(quietThreads({ quietLocalModels: true }, 24)).toBe(6);
    expect(quietThreads({ quietLocalModels: true }, 16)).toBe(4);
    expect(quietThreads({ quietLocalModels: true }, 4)).toBe(2);
  });
});
