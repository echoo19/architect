import type { OrgTypeResult } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { organizationGrid } from '../../../src/renderer/src/flow/report/org-grid';

function result(
  type: string,
  org: string,
  where: { seen: boolean; synthetic: boolean },
  pass: number,
  total: number,
): OrgTypeResult {
  return { type, label: type.toUpperCase(), org, orgName: `${org} name`, ...where, pass, total };
}

const SEEN = { seen: true, synthetic: true };
const UNSEEN = { seen: false, synthetic: true };
const REAL = { seen: false, synthetic: false };

describe('organizationGrid', () => {
  it('is null for a job with one organization or none', () => {
    expect(organizationGrid(undefined)).toBeNull();
    expect(organizationGrid([result('a', 'north', SEEN, 1, 2)])).toBeNull();
  });

  it('marks a never-seen organization taught on since, and keeps it where it was measured', () => {
    const grid = organizationGrid([
      result('a', 'north', SEEN, 3, 3),
      { ...result('a', 'east', UNSEEN, 1, 3), taughtLater: true },
    ]);
    expect(
      grid?.groups.map((group) => [group.label, group.columns.map((c) => c.taughtLater)]),
    ).toEqual([
      ['Taught on', [false]],
      ['Never seen', [true]],
    ]);
  });

  it('keeps an organization added to the field later in a group of its own, last', () => {
    const grid = organizationGrid([
      { ...result('a', 'maple', UNSEEN, 3, 4), addedLater: true },
      result('a', 'north', SEEN, 3, 3),
      result('a', 'east', UNSEEN, 1, 3),
    ]);
    expect(grid?.groups.map((group) => [group.label, group.columns.map((c) => c.org)])).toEqual([
      ['Taught on', ['north']],
      ['Never seen', ['east']],
      ['Added later', ['maple']],
    ]);
  });

  it('groups the organizations seen, never seen and real, and leaves an untested cell empty', () => {
    const grid = organizationGrid([
      result('a', 'real', REAL, 2, 4),
      result('a', 'north', SEEN, 3, 3),
      result('a', 'east', UNSEEN, 1, 3),
      result('b', 'north', SEEN, 2, 2),
      result('b', 'east', UNSEEN, 2, 2),
    ]);
    expect(grid?.groups.map((group) => [group.label, group.columns.map((c) => c.org)])).toEqual([
      ['Taught on', ['north']],
      ['Never seen', ['east']],
      ['Never seen, real', ['real']],
    ]);
    expect(grid?.groups.map((group) => group.columns[0]?.score)).toEqual([
      { pass: 5, total: 5 },
      { pass: 3, total: 5 },
      { pass: 2, total: 4 },
    ]);
    expect(grid?.rows).toEqual([
      {
        type: 'a',
        label: 'A',
        cells: [
          { pass: 3, total: 3 },
          { pass: 1, total: 3 },
          { pass: 2, total: 4 },
        ],
      },
      { type: 'b', label: 'B', cells: [{ pass: 2, total: 2 }, { pass: 2, total: 2 }, null] },
    ]);
  });
});
