import { expect, test } from '@playwright/test';
import { frameDurations, speedAt } from './timeline';

test.describe('demo timing', () => {
  test('uses measured gaps and compresses only a selected step range', () => {
    const frames = [0, 40, 80, 120, 160];
    const speeds = [{ startMs: 75, endMs: 145, factor: 4 }];
    expect(frameDurations(frames, speeds, 40)).toEqual([40, 40, 10, 10, 40]);
    expect(speedAt(90, speeds)).toBe(4);
    expect(speedAt(150, speeds)).toBe(1);
  });

  test('retains long measured pauses and rejects invalid timestamps', () => {
    expect(frameDurations([0, 33, 300], [], 33)).toEqual([33, 267, 33]);
    expect(() => frameDurations([10, 9], [], 33)).toThrow('monotonic');
  });
});
