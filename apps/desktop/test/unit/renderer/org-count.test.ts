import { describe, expect, it } from 'vitest';
import { orgCountText } from '../../../src/renderer/src/fields/parts';

describe('orgCountText', () => {
  it('counts a real organization as real and not as never seen, as the Fields table does', () => {
    expect(orgCountText({ taughtOn: 3, sealed: 1, real: 1 })).toBe(
      '3 taught on, 1 never seen, 1 real',
    );
  });

  it('says only the kinds a field has', () => {
    expect(orgCountText({ taughtOn: 3, sealed: 1, real: 0 })).toBe('3 taught on, 1 never seen');
    expect(orgCountText({ taughtOn: 2, sealed: 0, real: 1 })).toBe('2 taught on, 1 real');
    expect(orgCountText({ taughtOn: 2, sealed: 0, real: null })).toBe('2 taught on');
    expect(orgCountText({ taughtOn: 1, sealed: 0, real: null })).toBe('One organization');
  });
});
