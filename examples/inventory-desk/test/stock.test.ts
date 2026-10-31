import { AgentTools, JobFiles, Random } from '@architect/example-assay-desk';
import type { JsonValue } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { Desk } from '../src/lab/build';
import { deskFiles } from '../src/lab/files';
import type { Policy } from '../src/lab/policy';
import { allocate, freeOf, inDate, usableLots, usableVolume } from '../src/lab/stock';
import type { Hold, Lot, Store } from '../src/lab/stock';
import { DESK_STYLES } from '../src/lab/style';
import { writeVolume } from '../src/lab/volume';
import { allocateCode, usableCode } from '../src/reference/code';
import { allocationValue } from '../src/tasks/build';

/**
 * The rules against a store small enough to work by hand, both in the generator's own rules and
 * in the code the reference sends to `run`. The day is 2026-10-14 and the cutoff 30 days, so a lot
 * is in date when it expires on 2026-11-13 or later. A re-test takes 20 µL.
 *
 * C-1: L1 100 µL expires 2027-01-01, L2 40 µL expires 2026-12-01 with 25 µL held (15 free), L3
 *      300 µL expires 2026-11-01 (out of date). First expiring and usable on its own: L1 (L2 has
 *      too little free). Largest: L1. Combined, first expiring: L2's 15, then 5 from L1; largest:
 *      20 from L1.
 * C-2: one lot, expired. C-3: one lot of 12 µL, in date. C-4: in date, but three holds already.
 * C-5: L7 15 µL with two holds of 1 µL (13 free) and L8 10 µL, both in date: one lot can't serve
 *      a re-test, two combined can (13 + 7), but two holds and two new rows make four.
 */

const POLICY: Policy = {
  unit: 'uL',
  dateForm: 'iso',
  minimum: 20_000,
  cutoff: 30,
  choose: 'expiry',
  combine: false,
  maxHolds: 3,
  codes: { expired: 'OLD', low: 'LOW', limit: 'MAX' },
};

const lot = (compound: string, id: string, ul: number, expires: string): Lot => ({
  compound,
  lot: id,
  location: `RACK:${id}`,
  quantity: ul * 1_000,
  concMm: 10,
  received: '2026-01-01',
  expires,
});

const LOTS: Lot[] = [
  lot('C-1', 'L1', 100, '2027-01-01'),
  lot('C-1', 'L2', 40, '2026-12-01'),
  lot('C-1', 'L3', 300, '2026-11-01'),
  lot('C-2', 'L4', 200, '2026-10-01'),
  lot('C-3', 'L5', 12, '2027-06-01'),
  lot('C-4', 'L6', 500, '2027-06-01'),
  lot('C-5', 'L7', 15, '2027-03-01'),
  lot('C-5', 'L8', 10, '2027-04-01'),
];

const hold = (id: string, compound: string, lotId: string, ul: number): Hold => ({
  id,
  compound,
  lot: lotId,
  amount: ul * 1_000,
  reservedOn: '2026-10-01',
});

const HOLDS: Hold[] = [
  hold('H-1', 'C-1', 'L2', 25),
  hold('H-2', 'C-4', 'L6', 5),
  hold('H-3', 'C-4', 'L6', 5),
  hold('H-4', 'C-4', 'L6', 5),
  hold('H-5', 'C-5', 'L7', 1),
  hold('H-6', 'C-5', 'L7', 1),
];

const store = (policy: Partial<Policy> = {}): Store => ({
  lots: LOTS,
  holds: HOLDS,
  policy: { ...POLICY, ...policy },
  today: '2026-10-14',
});

describe('the rules', () => {
  it('take held stock off a lot, and keep a lot only while it has the cutoff left', () => {
    expect(freeOf(LOTS[1]!, HOLDS)).toBe(15_000);
    expect(LOTS.slice(0, 3).map((l) => inDate(l, store()))).toEqual([true, true, false]);
  });

  it('order usable lots by the policy, and count only those that can serve', () => {
    expect(usableLots(store(), 'C-1').map((l) => l.lot)).toEqual(['L1']);
    expect(usableLots(store({ combine: true }), 'C-1').map((l) => l.lot)).toEqual(['L2', 'L1']);
    expect(
      usableLots(store({ combine: true, choose: 'largest' }), 'C-1').map((l) => l.lot),
    ).toEqual(['L1', 'L2']);
    expect(usableVolume(store(), 'C-1')).toBe(100_000);
    expect(usableVolume(store({ combine: true }), 'C-1')).toBe(115_000);
  });

  it('draw one re-test, from one lot or several', () => {
    expect(allocate(store(), 'C-1').draws).toEqual([
      { lot: 'L1', location: 'RACK:L1', amount: 20_000 },
    ]);
    expect(allocate(store({ combine: true }), 'C-1').draws).toEqual([
      { lot: 'L2', location: 'RACK:L2', amount: 15_000 },
      { lot: 'L1', location: 'RACK:L1', amount: 5_000 },
    ]);
  });

  it('count the rows a re-test would add against the limit, after the draw', () => {
    expect(allocate(store(), 'C-5').reason).toBe('LOW');
    expect(allocate(store({ combine: true }), 'C-5').reason).toBe('MAX');
    expect(allocate(store({ combine: true, maxHolds: 4 }), 'C-5').draws).toEqual([
      { lot: 'L7', location: 'RACK:L7', amount: 13_000 },
      { lot: 'L8', location: 'RACK:L8', amount: 7_000 },
    ]);
    const expired = {
      ...store(),
      lots: LOTS.map((l) => (l.lot === 'L6' ? { ...l, expires: '2026-01-01' } : l)),
    };
    expect(allocate(expired, 'C-4').reason).toBe('OLD');
  });

  it('give the reason a compound has nothing to draw', () => {
    expect(allocate(store(), 'C-2').reason).toBe('OLD');
    expect(allocate(store(), 'C-3').reason).toBe('LOW');
    expect(allocate(store(), 'C-4').reason).toBe('MAX');
    expect(allocate(store({ maxHolds: 4 }), 'C-4').reason).toBeNull();
  });
});

describe("the reference's code", () => {
  /** The store written as a lab's files, with Fenwick's ways of naming things. */
  function tools(policy: Policy): AgentTools {
    const desk = {
      style: { ...DESK_STYLES[0]!, policy },
      assay: { id: 'hand', name: 'Hand Lab', today: '2026-10-14', compounds: [], lists: [] },
      store: { ...store(), policy },
      chain: { list: { plate: 'P', compounds: [], take: 0 }, short: '' },
    } satisfies Desk;
    return new AgentTools(new JobFiles(deskFiles(desk, new Random(1))), '2026-10-14');
  }

  it('works the same draws out from the files, in any unit and date form', () => {
    for (const unit of ['uL', 'mL', 'nL'] as const) {
      for (const dateForm of ['iso', 'us', 'dmy'] as const) {
        for (const combine of [false, true]) {
          const policy: Policy = { ...POLICY, unit, dateForm, combine };
          const run = tools(policy).run<{ allocations: JsonValue[] }>(
            allocateCode(policy, '2026-10-14', ['C-1', 'C-2', 'C-3', 'C-4', 'C-5']),
          );
          const truth = ['C-1', 'C-2', 'C-3', 'C-4', 'C-5'].map((c) =>
            allocationValue(allocate({ ...store(), policy }, c)),
          );
          expect(run.allocations, `${unit} ${dateForm} ${combine}`).toEqual(truth);
          const usable = tools(policy).run<{ usable_ul: number }>(
            usableCode(policy, '2026-10-14', 'C-1'),
          );
          expect(usable.usable_ul).toBe(combine ? 115 : 100);
        }
      }
    }
  });

  it('writes volumes that read back exactly', () => {
    expect(writeVolume(45_500, 'uL')).toBe('45.5 µL');
    expect(writeVolume(45_500, 'mL')).toBe('0.0455 mL');
    expect(writeVolume(45_500, 'nL')).toBe('45500 nL');
    expect(writeVolume(20_000, 'uL')).toBe('20 µL');
  });
});
