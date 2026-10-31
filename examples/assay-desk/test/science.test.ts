import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import { scientific, thousands } from '../src/lab/files';
import type { Policy } from '../src/lab/policy';
import { compoundCalls, plateStats, retestNeeds, plateCalls } from '../src/lab/science';
import type { WellValue } from '../src/lab/science';
import {
  helpers,
  hitsCode,
  normalizeCode,
  qcCode,
  replicatesCode,
  retestCode,
} from '../src/reference/code';
import { AgentTools, JobFiles } from '../src/reference/tools';

/**
 * The arithmetic against a plate small enough to work by hand, both in the generator's own
 * science and in the code the reference sends to `run`.
 *
 * Negative controls 100, 110, 90, 100: mean 100, sample SD √(200/3) = 8.16497.
 * Positive controls 10, 12, 8, 10: mean 10, sample SD √(8/3) = 1.63299.
 * Z′ = 1 − 3 × (8.16497 + 1.63299) / 90 = 0.673401.
 * Percent inhibition = 100 × (100 − signal) / 90: 55 → 50, 46 → 60, 64 → 40, 91 → 10.
 * The negatives' own percent inhibition is 0, −11.11, 11.11, 0, SD 9.07218, so 3 SD is 27.2166.
 */

const POLICY: Policy = {
  neg: 'NEG',
  pos: 'POS',
  hit: { kind: 'percent', value: 50 },
  zMin: 0.5,
  band: 10,
  agree: 20,
  rule: 'mean',
  cap: 2,
  codes: { qc: 'QC', borderline: 'NEAR', inconclusive: 'REP' },
};

const WELLS: WellValue[] = [
  ['A1', 'NEG', 100],
  ['B1', 'NEG', 110],
  ['C1', 'NEG', 90],
  ['D1', 'NEG', 100],
  ['A2', 'POS', 10],
  ['B2', 'POS', 12],
  ['C2', 'POS', 8],
  ['D2', 'POS', 10],
  ['A3', 'C-1', 55],
  ['B3', 'C-2', 46],
  ['C3', 'C-2', 64],
  ['D3', 'C-3', 100],
  ['A4', 'C-3', null],
  ['B4', 'C-4', 91],
].map(([well, compound, signal]) => ({
  well: well as string,
  compound: compound as string,
  role: compound === 'NEG' ? 'neg' : compound === 'POS' ? 'pos' : 'compound',
  signal: signal as number | null,
}));

describe("the generator's science", () => {
  const stats = plateStats(WELLS, POLICY);

  it('works out the controls and Z′', () => {
    expect(stats.negMean).toBe(100);
    expect(stats.posMean).toBe(10);
    expect(stats.negSd).toBeCloseTo(8.16497, 5);
    expect(stats.posSd).toBeCloseTo(1.63299, 5);
    expect(stats.zPrime).toBeCloseTo(0.673401, 6);
    expect(stats.pass).toBe(true);
    expect(plateStats(WELLS, { ...POLICY, zMin: 0.7 }).pass).toBe(false);
  });

  it('sets the hit threshold by percent or by SD of the negatives', () => {
    expect(stats.threshold).toBe(50);
    const sd = plateStats(WELLS, { ...POLICY, hit: { kind: 'sd', value: 3 } });
    expect(sd.threshold).toBeCloseTo(27.2166, 4);
  });

  it('calls each compound by the rule on replicates', () => {
    const calls = compoundCalls(WELLS, stats, POLICY);
    expect(calls.map((c) => [c.compound, c.call, c.borderline])).toEqual([
      ['C-1', 'hit', true],
      ['C-2', 'hit', true],
      ['C-3', 'inconclusive', false],
      ['C-4', 'inactive', false],
    ]);
    const c2 = calls[1]!;
    expect(c2.values[0]).toBeCloseTo(60, 9);
    expect(c2.values[1]).toBeCloseTo(40, 9);
    expect(c2.mean).toBeCloseTo(50, 9);
    expect(c2.agree).toBe(true);
    const all = compoundCalls(WELLS, stats, { ...POLICY, rule: 'all' });
    expect(all[1]!.call).toBe('inactive');
    const strict = compoundCalls(WELLS, stats, { ...POLICY, agree: 15 });
    expect(strict[1]!.call).toBe('inconclusive');
  });

  it('asks for the policy’s cap of re-tests, leaving out what the queue holds', () => {
    const calls = plateCalls(WELLS, POLICY);
    expect(calls.hits).toEqual(['C-1', 'C-2']);
    const need = retestNeeds('TP-1', calls, POLICY, []);
    expect(need.candidates.map((c) => [c.compound, c.reason])).toEqual([
      ['C-1', 'NEAR'],
      ['C-2', 'NEAR'],
      ['C-3', 'REP'],
    ]);
    expect(need.take).toBe(2);
    const held = retestNeeds('TP-1', calls, POLICY, [
      { plate: 'TP-1', compound: 'C-1', reason: 'NEAR' },
    ]);
    expect(held.candidates.map((c) => c.compound)).toEqual(['C-2', 'C-3']);
    const failed = plateCalls(WELLS, { ...POLICY, zMin: 0.7 });
    expect(failed.hits).toEqual([]);
    expect(retestNeeds('TP-1', failed, POLICY, [])).toEqual({
      whole: true,
      candidates: [],
      take: 0,
    });
    const queued = retestNeeds('TP-1', failed, POLICY, [
      { plate: 'TP-1', compound: null, reason: 'QC' },
    ]);
    expect(queued.whole).toBe(false);
  });
});

describe("the reference's code", () => {
  // The same plate as a lab's files: an export that names wells by row and column, writes a
  // dash for no reading, and a well map in another well form, with a stray capital.
  const exportRows = WELLS.map((w) => {
    const value = w.signal === null ? 'OVER' : w.signal.toFixed(1);
    return `tp1,${w.well[0]},${w.well.slice(1)},${value}`;
  });
  const files = new JobFiles(
    new Map([
      [
        'plates.csv',
        'plate_id,layout,instrument,read_on,export_file\nTP-1,96,Kestrel HT,10/2/2026,kestrel_export.csv\n',
      ],
      ['kestrel_export.csv', `Barcode,Row,Col,RFU\n${exportRows.join('\n')}\n`],
      [
        'compounds.csv',
        `plate_id,well,compound_id,conc_um\n${WELLS.map((w) => `TP-1,${w.well[0]}0${w.well.slice(1)},${w.compound === 'C-2' && w.well === 'C3' ? 'c-2' : w.compound},`).join('\n')}\n`,
      ],
      [
        'retests.csv',
        'retest_id,plate_id,compound_id,reason,requested_on\nRT-009,TP-0,,QC,2026-09-30\n',
      ],
    ]),
  );
  const run = (code: string) => new AgentTools(files, '2026-10-03').run(code);

  it('works out Z′ and percent inhibition from the export', () => {
    expect(run(qcCode(POLICY, 'tp-1'))).toEqual({ plate: 'TP-1', z_prime: 0.673, qc: 'pass' });
    expect(run(normalizeCode(POLICY, 'TP-1', ['A03', 'b3', 'A4']))).toEqual({
      inhibition: { A03: 50, b3: 60, A4: null },
    });
  });

  it('calls hits and replicates by the policy', () => {
    expect(run(hitsCode(POLICY, 'TP-1'))).toEqual({ hits: ['C-1', 'C-2'] });
    expect(run(hitsCode({ ...POLICY, hit: { kind: 'sd', value: 3 } }, 'TP-1'))).toEqual({
      hits: ['C-1', 'C-2'],
    });
    expect(run(replicatesCode(POLICY, 'TP-1', 'C-2'))).toEqual({
      compound: 'C-2',
      inhibition: [60, 40],
      mean: 50,
      agree: true,
      call: 'hit',
    });
    expect(run(replicatesCode({ ...POLICY, rule: 'all' }, 'TP-1', 'C-2'))).toMatchObject({
      call: 'inactive',
    });
    expect(run(replicatesCode(POLICY, 'TP-1', 'C-3'))).toEqual({
      compound: 'C-3',
      inhibition: [0],
      mean: 0,
      agree: false,
      call: 'inconclusive',
    });
  });

  it('plans re-tests by the policy, numbered on from the queue', () => {
    expect(run(retestCode(POLICY, { readOn: '2026-10-02' }, '2026-10-03'))).toEqual({
      plates: ['TP-1'],
      rows: [
        {
          retest_id: 'RT-010',
          plate_id: 'TP-1',
          compound_id: 'C-1',
          reason: 'NEAR',
          requested_on: '2026-10-03',
        },
        {
          retest_id: 'RT-011',
          plate_id: 'TP-1',
          compound_id: 'C-2',
          reason: 'NEAR',
          requested_on: '2026-10-03',
        },
      ],
    });
    expect(run(retestCode({ ...POLICY, zMin: 0.7 }, { plates: ['TP-1'] }, '2026-10-03'))).toEqual({
      plates: ['TP-1'],
      rows: [
        {
          retest_id: 'RT-010',
          plate_id: 'TP-1',
          compound_id: '',
          reason: 'QC',
          requested_on: '2026-10-03',
        },
      ],
    });
  });

  it('reads every form a value is written in back to one value', () => {
    const context = vm.createContext({});
    vm.runInContext(`${helpers(POLICY)}\nthis.r = { key, wellOf, reading, dayOf };`, context);
    const r = (context as unknown as { r: Record<string, (s: string) => unknown> }).r;
    for (const [written, value] of [
      ['41234', 41234],
      [thousands(41234), 41234],
      [scientific(45123), 45123],
      [scientific(8031), 8031],
      ['6123.4', 6123.4],
      ['OVRFLW', null],
      ['OVER', null],
      ['Overflow', null],
      ['-', null],
      ['NaN', null],
      ['', null],
    ] as const) {
      expect(r.reading!(written), written).toBe(value);
    }
    expect(['A1', 'A01', 'a 01', 'P24'].map((w) => r.wellOf!(w))).toEqual([
      'A1',
      'A1',
      'A1',
      'P24',
    ]);
    expect(['2026-10-14', '10/14/2026', '14-Oct-2026'].map((d) => r.dayOf!(d))).toEqual([
      '2026-10-14',
      '2026-10-14',
      '2026-10-14',
    ]);
    expect(r.key!(' fwc-10003')).toBe(r.key!('FWC-10003'));
    expect(r.key!('FW0411')).toBe(r.key!('FW-0411'));
  });
});
