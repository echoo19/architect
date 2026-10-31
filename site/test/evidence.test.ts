import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FIELD_ARMS,
  FIELD_PAIRS,
  FIELD_TEST_SIZE,
  FIRST,
  GROUPS,
  LOCAL_ROWS,
  LOCAL_SPEED,
  PER_TYPE,
  REPAIR,
  SECOND,
  SKILL_ROWS,
  SOURCES,
  TEST_SIZE,
} from '../src/evidence';

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

  it('adds up the field run: groups to 120, skills to groups, pairs to their tasks', () => {
    expect(GROUPS.reduce((sum, group) => sum + group.n, 0)).toBe(FIELD_TEST_SIZE);
    for (const arm of FIELD_ARMS) {
      expect(arm.groups.reduce((sum, group) => sum + group.passed, 0)).toBe(arm.all.passed);
      arm.groups.forEach((group, index) => {
        const key = GROUPS[index]?.short;
        const rows = SKILL_ROWS.filter((row) => row.group === key);
        const field =
          arm.name === 'Academy desk'
            ? 'academyDesk'
            : arm.name.startsWith('Glimmer')
              ? 'bare'
              : 'draft';
        expect(rows.reduce((sum, row) => sum + row[field], 0)).toBe(group.passed);
        expect(rows.reduce((sum, row) => sum + row.of, 0)).toBe(GROUPS[index]?.n);
        expect(group.low).toBeLessThanOrEqual((group.passed / (GROUPS[index]?.n ?? 1)) * 100);
        expect(group.high).toBeGreaterThanOrEqual((group.passed / (GROUPS[index]?.n ?? 1)) * 100);
      });
    }
    for (const pair of FIELD_PAIRS) {
      expect(pair.wins + pair.losses + pair.both + pair.neither).toBe(pair.n);
      expect(((pair.wins - pair.losses) / pair.n) * 100).toBeCloseTo(pair.diff, 0);
      expect(pair.low).toBeLessThan(pair.diff);
      expect(pair.high).toBeGreaterThan(pair.diff);
    }
  });

  it('adds up the local run and gives the report its numbers', () => {
    const report = readFileSync(
      join(ROOT, 'docs', 'comparisons', 'academy-desk-1-local.md'),
      'utf8',
    );
    const academyDesk = FIELD_ARMS.find((each) => each.name === 'Academy desk');
    for (const row of LOCAL_ROWS) {
      expect(row.wins + row.losses).toBeLessThanOrEqual(row.n);
      expect(((row.wins - row.losses) / row.n) * 100).toBeCloseTo(row.diff, 0);
      expect(row.low).toBeLessThan(row.diff);
      expect(row.high).toBeGreaterThan(row.diff);
      expect(report).toContain(`${row.local}/${row.n}`);
      expect(report).toContain(`${row.hosted}/${row.n}`);
      const index = GROUPS.findIndex((group) => group.short === row.group);
      const hosted = index < 0 ? academyDesk?.all.passed : academyDesk?.groups[index]?.passed;
      expect(row.hosted).toBe(hosted);
    }
    expect(LOCAL_ROWS.slice(0, 3).reduce((sum, row) => sum + row.local, 0)).toBe(
      LOCAL_ROWS[3]?.local,
    );
    expect(report).toContain(
      `${LOCAL_SPEED.medianLocal} s locally and ${LOCAL_SPEED.medianHosted} s hosted`,
    );
    expect(report).toContain(
      `over ${LOCAL_SPEED.slowestLocal} s locally and ${LOCAL_SPEED.slowestHosted} s hosted`,
    );
  });

  it('cites documents that exist', () => {
    for (const source of Object.values(SOURCES)) {
      expect(() => readFileSync(join(ROOT, source.path), 'utf8')).not.toThrow();
    }
  });
});
