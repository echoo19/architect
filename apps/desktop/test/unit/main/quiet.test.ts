import { describe, expect, it } from 'vitest';
import { quietCooldown, quietThreads } from '../../../src/main/settings/quiet';

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

describe('quietCooldown', () => {
  it('rests local models three quarters as long as each reply took, only in quiet mode', () => {
    expect(quietCooldown({ quietLocalModels: true })).toBe(0.75);
    expect(quietCooldown({ quietLocalModels: false })).toBeUndefined();
  });
});
