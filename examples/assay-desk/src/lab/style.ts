import type { Random } from '../lib/random';
import type { Policy, PolicyStyle } from './policy';
import { POLICY_STYLES } from './policy';

/**
 * What makes one lab differ from another besides its readings: its name and date, its
 * instruments, how many plates of each layout it reads, where its control wells sit, how it
 * writes ids, wells, dates and layouts, how many compounds it runs in duplicate, and its rules.
 */

export type InstrumentId = 'lumen' | 'kestrel' | 'orbit';
export const INSTRUMENTS: readonly InstrumentId[] = ['lumen', 'kestrel', 'orbit'];

/**
 * Where a plate's control wells sit. `outer`: negatives in the first column, positives in the
 * last. `swapped`: the other way round. `left`: negatives in column 1, positives in column 2.
 * `alternate`: the first and last columns, negatives and positives on alternating rows.
 */
export type ControlPlacement = 'outer' | 'swapped' | 'left' | 'alternate';

/** How compounds.csv names a well: `A1`, or `A01` with the column in two digits. */
export type WellForm = 'plain' | 'padded';
/** How plates.csv writes a date: `2026-10-14`, `10/14/2026` or `14-Oct-2026`. */
export type DateForm = 'iso' | 'us' | 'dmy';
/** How plates.csv writes a layout: `96`, `96-well` or `96w`. */
export type LayoutForm = 'number' | 'well' | 'w';

export interface LabStyle {
  id: string;
  name: string;
  /** The lab's working day, which its requests state. */
  today: string;
  instruments: InstrumentId[];
  /** Plates of each layout. */
  plates: { 96: number; 384: number };
  controls: ControlPlacement;
  wellForm: WellForm;
  dateForm: DateForm;
  layoutForm: LayoutForm;
  /** Share of compounds run in two wells. */
  duplicates: number;
  plateId: (n: number) => string;
  compoundId: (n: number) => string;
  retestId: (n: number) => string;
  policy: Policy;
  policyStyle: PolicyStyle;
}

const pad = (n: number, width: number) => String(n).padStart(width, '0');

/** The four labs of the committed job: three to teach on, and Corvid Hill, never seen. */
export const LAB_STYLES: readonly LabStyle[] = [
  {
    id: 'fenwick',
    name: 'Fenwick Screening Core',
    today: '2026-10-14',
    instruments: ['lumen', 'kestrel'],
    plates: { 96: 5, 384: 3 },
    controls: 'outer',
    wellForm: 'padded',
    dateForm: 'iso',
    layoutForm: 'number',
    duplicates: 0.25,
    plateId: (n) => `FW-${pad(410 + n, 4)}`,
    compoundId: (n) => `FWC-${pad(10000 + n * 3, 5)}`,
    retestId: (n) => `RT-${pad(n, 4)}`,
    policy: {
      neg: 'DMSO',
      pos: 'STAU',
      hit: { kind: 'percent', value: 50 },
      zMin: 0.5,
      band: 10,
      agree: 20,
      rule: 'mean',
      cap: 4,
      codes: { qc: 'QC-FAIL', borderline: 'BORDERLINE', inconclusive: 'INCONCLUSIVE' },
    },
    policyStyle: 'table',
  },
  {
    id: 'alder-row',
    name: 'Alder Row Biosciences',
    today: '2026-10-21',
    instruments: ['kestrel', 'orbit'],
    plates: { 96: 6, 384: 2 },
    controls: 'left',
    wellForm: 'plain',
    dateForm: 'us',
    layoutForm: 'well',
    duplicates: 1,
    plateId: (n) => `AR-${2200 + n * 7}`,
    compoundId: (n) => `ARX${pad(400 + n * 2, 6)}`,
    retestId: (n) => `R-${100 + n}`,
    policy: {
      neg: 'NEG',
      pos: 'POS',
      hit: { kind: 'sd', value: 3 },
      zMin: 0.4,
      band: 5,
      agree: 15,
      rule: 'all',
      cap: 3,
      codes: { qc: 'qc', borderline: 'edge', inconclusive: 'rep' },
    },
    policyStyle: 'prose',
  },
  {
    id: 'saltmarsh',
    name: 'Saltmarsh Institute Assay Lab',
    today: '2026-11-05',
    instruments: ['lumen', 'orbit'],
    plates: { 96: 4, 384: 4 },
    controls: 'alternate',
    wellForm: 'padded',
    dateForm: 'dmy',
    layoutForm: 'w',
    duplicates: 0.5,
    plateId: (n) => `SALT-${pad(n * 3 + 11, 3)}`,
    compoundId: (n) => `SM-${4400 + n}-01`,
    retestId: (n) => `RQ-${pad(n + 30, 4)}`,
    policy: {
      neg: 'HI',
      pos: 'LO',
      hit: { kind: 'percent', value: 40 },
      zMin: 0.6,
      band: 8,
      agree: 25,
      rule: 'mean',
      cap: 6,
      codes: { qc: 'PLATE', borderline: 'NEAR', inconclusive: 'SPLIT' },
    },
    policyStyle: 'bullets',
  },
  {
    id: 'corvid-hill',
    name: 'Corvid Hill Discovery',
    today: '2026-10-28',
    instruments: ['orbit', 'lumen', 'kestrel'],
    plates: { 96: 5, 384: 3 },
    controls: 'swapped',
    wellForm: 'plain',
    dateForm: 'iso',
    layoutForm: 'number',
    duplicates: 0.25,
    plateId: (n) => `CH-${pad(900 + n * 4, 4)}`,
    compoundId: (n) => `CHD-${55000 + n * 11}`,
    retestId: (n) => `CH-RT-${pad(n + 40, 4)}`,
    policy: {
      neg: 'VEH',
      pos: 'REF',
      hit: { kind: 'sd', value: 2.5 },
      zMin: 0.45,
      band: 7,
      agree: 18,
      rule: 'all',
      cap: 5,
      codes: { qc: 'RETEST-PLATE', borderline: 'RETEST-NEAR', inconclusive: 'RETEST-REP' },
    },
    policyStyle: 'bullets',
  },
];

/** A lab of its own for any other seed, drawn from the same choices. */
export function randomStyle(seed: number, random: Random): LabStyle {
  const base = random.pick(LAB_STYLES);
  const percent = random.chance(0.5);
  return {
    ...base,
    id: `lab-${seed}`,
    name: `Lab ${seed}`,
    instruments: random.sample(INSTRUMENTS, random.int(2, 3)),
    controls: random.pick<ControlPlacement>(['outer', 'swapped', 'left', 'alternate']),
    wellForm: random.pick<WellForm>(['plain', 'padded']),
    dateForm: random.pick<DateForm>(['iso', 'us', 'dmy']),
    layoutForm: random.pick<LayoutForm>(['number', 'well', 'w']),
    duplicates: random.pick([0.25, 0.5, 1]),
    policy: {
      ...base.policy,
      hit: percent
        ? { kind: 'percent', value: random.pick([40, 50]) }
        : { kind: 'sd', value: random.pick([2.5, 3]) },
      zMin: random.pick([0.4, 0.5, 0.6]),
      band: random.pick([5, 8, 10]),
      agree: random.pick([15, 20, 25]),
      rule: random.pick<Policy['rule']>(['mean', 'all']),
      cap: random.pick([3, 4, 6]),
    },
    policyStyle: random.pick(POLICY_STYLES),
  };
}
