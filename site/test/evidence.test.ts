import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FIRST, PER_TYPE, REPAIR, SECOND, SOURCES, TEST_SIZE } from '../src/evidence';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The results page's figures hold together, and the reports it cites are there to be read. */
describe('the results page', () => {
  it('counts every final test as 60 requests and every kind as 20', () => {
    for (const comparison of [FIRST, SECOND]) {
      for (const arm of comparison.arms) {
        expect(arm.passed).toBeLessThanOrEqual(TEST_SIZE);
        expect(arm.byType.reduce((sum, passed) => sum + passed, 0)).toBe(arm.passed);
        for (const passed of arm.byType) expect(passed).toBeLessThanOrEqual(PER_TYPE);
        expect(arm.low).toBeLessThanOrEqual((arm.passed / TEST_SIZE) * 100);
        expect(arm.high).toBeGreaterThanOrEqual((arm.passed / TEST_SIZE) * 100);
      }
    }
  });

  it('splits each pair of arms into wins, losses, both and neither of the 60 requests', () => {
    for (const comparison of [FIRST, SECOND]) {
      for (const pair of comparison.pairs) {
        expect(pair.wins + pair.losses + pair.both + pair.neither).toBe(TEST_SIZE);
        expect(((pair.wins - pair.losses) / TEST_SIZE) * 100).toBeCloseTo(pair.diff, 0);
        expect(pair.low).toBeLessThan(pair.diff);
        expect(pair.high).toBeGreaterThan(pair.diff);
      }
    }
  });

  it('gives the figures the README gives', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    expect(readme).toContain('from 44 to 58 of 60');
    expect(readme).toContain('23 points better');
    expect(SECOND.arms.map((arm) => arm.passed)).toEqual([44, 38, 58]);
    expect(FIRST.arms.map((arm) => arm.passed)).toEqual([43, 47, 45, 60]);
    expect(`${REPAIR.checkBefore} of ${REPAIR.checkTotal}`).toBe('22 of 30');
    expect(`${REPAIR.finalPassed} of ${REPAIR.finalTotal}`).toBe('40 of 40');
  });

  it('cites documents that exist', () => {
    for (const source of Object.values(SOURCES)) {
      expect(() => readFileSync(join(ROOT, source.path), 'utf8')).not.toThrow();
    }
  });
});
