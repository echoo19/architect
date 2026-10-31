import { addDays } from '../lib/calendar';
import type { Random } from '../lib/random';
import type { Policy } from './policy';
import { plateCalls } from './science';
import type { PlateCalls, RetestRequest, WellValue } from './science';
import type { ControlPlacement, InstrumentId, LabStyle } from './style';

/**
 * A lab's true records, before any export writes them: its plates with every well's signal, its
 * well map and its re-test queue. Signals follow a simple model of an inhibition assay: the
 * negative controls read high, the positive controls low, most compounds near the negatives and
 * a few actives part or all the way down. Each plate is drawn for a quality it should have
 * (passing, failing, or close to the lab's lowest passing Z′ on either side).
 */

export type Layout = 96 | 384;

export interface Plate {
  id: string;
  layout: Layout;
  instrument: InstrumentId;
  readOn: string;
  wells: WellValue[];
  calls: PlateCalls;
}

export interface QueuedRetest extends RetestRequest {
  id: string;
  requestedOn: string;
}

export interface Lab {
  style: LabStyle;
  plates: Plate[];
  /** retests.csv as the lab left it. */
  queue: QueuedRetest[];
}

export const ROW_LETTERS = 'ABCDEFGHIJKLMNOP';

const SHAPE: Record<Layout, { rows: number; columns: number }> = {
  96: { rows: 8, columns: 12 },
  384: { rows: 16, columns: 24 },
};

/** Each instrument's signal scale, and the decimals it writes. */
const SCALE: Record<InstrumentId, { low: number; high: number; decimals: number }> = {
  lumen: { low: 30_000, high: 60_000, decimals: 0 },
  kestrel: { low: 4_000, high: 9_000, decimals: 1 },
  orbit: { low: 20_000, high: 80_000, decimals: 0 },
};

type Quality = 'pass' | 'near-pass' | 'near-fail' | 'fail';
const QUALITIES: readonly Quality[] = [
  'pass',
  'pass',
  'pass',
  'pass',
  'near-pass',
  'near-fail',
  'fail',
  'pass',
];

/** Days before the lab's date its plates were read, earliest first. */
const READ_DAYS = [8, 6, 2];

export function buildLab(style: LabStyle, random: Random): Lab {
  const layouts: Layout[] = random.shuffle([
    ...Array.from({ length: style.plates[96] }, () => 96 as const),
    ...Array.from({ length: style.plates[384] }, () => 384 as const),
  ]);
  const qualities = random.shuffle(QUALITIES.slice(0, layouts.length));
  const instruments = random.shuffle(
    layouts.map((_, i) => style.instruments[i % style.instruments.length]!),
  );
  let nextCompound = 1;
  const plates = layouts.map((layout, i) => {
    const day =
      READ_DAYS[
        Math.min(READ_DAYS.length - 1, Math.floor((i * READ_DAYS.length) / layouts.length))
      ]!;
    const plate = drawPlate(random.fork(`plate ${i}`), {
      id: style.plateId(i + 1),
      layout,
      instrument: instruments[i]!,
      readOn: addDays(style.today, -day),
      quality: qualities[i]!,
      style,
      firstCompound: nextCompound,
    });
    nextCompound += new Set(plate.wells.filter((w) => w.role === 'compound').map((w) => w.compound))
      .size;
    return plate;
  });
  return { style, plates, queue: buildQueue(style, plates) };
}

interface PlatePlan {
  id: string;
  layout: Layout;
  instrument: InstrumentId;
  readOn: string;
  quality: Quality;
  style: LabStyle;
  firstCompound: number;
}

/** Draws a plate until it has the quality asked for and no value sits on a rule's edge. */
function drawPlate(random: Random, plan: PlatePlan): Plate {
  for (let attempt = 0; attempt < 400; attempt++) {
    const wells = drawWells(random.fork(`attempt ${attempt}`), plan);
    const calls = plateCalls(wells, plan.style.policy);
    if (hasQuality(calls, plan) && clearOfEdges(calls, plan.style.policy)) {
      return {
        id: plan.id,
        layout: plan.layout,
        instrument: plan.instrument,
        readOn: plan.readOn,
        wells,
        calls,
      };
    }
  }
  throw new Error(`No draw of plate ${plan.id} came out ${plan.quality}`);
}

function hasQuality(calls: PlateCalls, plan: PlatePlan): boolean {
  const { zPrime } = calls.stats;
  const zMin = plan.style.policy.zMin;
  switch (plan.quality) {
    case 'pass':
      return zPrime >= zMin + 0.08;
    case 'near-pass':
      return zPrime >= zMin + 0.005 && zPrime < zMin + 0.05;
    case 'near-fail':
      return zPrime <= zMin - 0.005 && zPrime > zMin - 0.06;
    case 'fail':
      return zPrime < zMin - 0.1;
  }
}

/** Points a value must keep from any edge a rule draws, so rounding never flips a call. */
const EDGE = 0.05;

/**
 * No compound's mean or well sits within EDGE of the hit threshold or of the borderline band's
 * edges, and no spread between replicates within EDGE of the agreement limit.
 */
function clearOfEdges(calls: PlateCalls, policy: Policy): boolean {
  const t = calls.stats.threshold;
  return calls.compounds.every((c) => {
    const values = policy.rule === 'all' ? c.values : [];
    const near = (v: number, edge: number) => Math.abs(v - edge) < EDGE;
    if (c.mean !== null && [t, t - policy.band, t + policy.band].some((e) => near(c.mean!, e))) {
      return false;
    }
    if (values.some((v) => near(v, t))) return false;
    if (c.values.length > 1 && near(Math.max(...c.values) - Math.min(...c.values), policy.agree)) {
      return false;
    }
    return true;
  });
}

/** The role of each well by where the lab puts its controls. */
function controlAt(
  placement: ControlPlacement,
  row: number,
  column: number,
  columns: number,
): 'neg' | 'pos' | null {
  const first = column === 1;
  const last = column === columns;
  switch (placement) {
    case 'outer':
      return first ? 'neg' : last ? 'pos' : null;
    case 'swapped':
      return first ? 'pos' : last ? 'neg' : null;
    case 'left':
      return first ? 'neg' : column === 2 ? 'pos' : null;
    case 'alternate':
      if (!first && !last) return null;
      return (row % 2 === 0) === first ? 'neg' : 'pos';
  }
}

/** The z′ a plate of this quality is drawn for; the draw then lands near it. */
function targetZ(random: Random, quality: Quality, zMin: number): number {
  switch (quality) {
    case 'pass':
      return random.between(zMin + 0.12, 0.85);
    case 'near-pass':
      return zMin + 0.03;
    case 'near-fail':
      return zMin - 0.03;
    case 'fail':
      return random.between(0.05, zMin - 0.15);
  }
}

function drawWells(random: Random, plan: PlatePlan): WellValue[] {
  const { rows, columns } = SHAPE[plan.layout];
  const { policy, duplicates, compoundId } = plan.style;
  const scale = SCALE[plan.instrument];
  const negMean = random.between(scale.low, scale.high);
  const posMean = negMean * random.between(0.05, 0.15);
  const span = negMean - posMean;
  // Z′ = 1 − 3 (σn + σp) / span: split the spread a target Z′ leaves between the two controls.
  const spread = ((1 - targetZ(random, plan.quality, policy.zMin)) * span) / 3;
  const posShare = random.between(0.15, 0.35);
  const negSd = spread * (1 - posShare);
  const posSd = spread * posShare;
  const round = (x: number) => {
    const factor = 10 ** scale.decimals;
    return Math.max(1, Math.round(x * factor) / factor);
  };
  const reading = (x: number): number | null => {
    const roll = random.next();
    return roll < 0.006 ? null : round(x);
  };

  const places: { well: string; role: 'neg' | 'pos' | null }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= columns; c++) {
      places.push({
        well: `${ROW_LETTERS[r]}${c}`,
        role: controlAt(plan.style.controls, r, c, columns),
      });
    }
  }
  const compoundPlaces = places.filter((p) => p.role === null);
  const pairs = Math.round((duplicates * compoundPlaces.length) / (1 + duplicates));
  const total = compoundPlaces.length - pairs;
  const doubled = new Set(
    random.sample(
      Array.from({ length: total }, (_, i) => i),
      pairs,
    ),
  );

  const wells: WellValue[] = [];
  for (const place of places) {
    if (place.role === null) continue;
    const sd = place.role === 'neg' ? negSd : posSd;
    const signal = reading(random.normal(place.role === 'neg' ? negMean : posMean, sd));
    wells.push({ well: place.well, compound: policy[place.role], role: place.role, signal });
  }
  let at = 0;
  for (let i = 0; i < total; i++) {
    const compound = compoundId(plan.firstCompound + i);
    const roll = random.next();
    const truth =
      roll < 0.05
        ? random.between(30, 110)
        : roll < 0.13
          ? random.between(10, 70)
          : random.normal(0, 5);
    const copies = doubled.has(i) ? 2 : 1;
    // Now and then one replicate goes astray (a pipetting slip), so replicates can disagree.
    const slip = copies === 2 && random.chance(0.05) ? random.between(30, 60) : 0;
    for (let copy = 0; copy < copies; copy++) {
      const pi = truth + (copy === 1 ? slip : 0);
      const signal = reading(random.normal(negMean - (pi / 100) * span, negSd * 0.9));
      wells.push({ well: compoundPlaces[at]!.well, compound, role: 'compound', signal });
      at += 1;
    }
  }
  // Every plate has at least one compound well with no reading.
  const compounds = wells.filter((w) => w.role === 'compound');
  if (compounds.every((w) => w.signal !== null)) random.pick(compounds).signal = null;
  // Wells in plate order: row by row, column by column.
  const order = new Map(places.map((p, i) => [p.well, i]));
  return wells.sort((a, b) => order.get(a.well)! - order.get(b.well)!);
}

/**
 * retests.csv as the lab left it: requests for two older plates, and requests already made for
 * the first failed plate and for one compound of the first passing plate that needs re-testing,
 * so a task on either of those finds part of its work done.
 */
function buildQueue(style: LabStyle, plates: readonly Plate[]): QueuedRetest[] {
  const { codes } = style.policy;
  const firstRead = plates[0]!.readOn;
  const requests: Omit<QueuedRetest, 'id'>[] = [
    {
      plate: style.plateId(-1),
      compound: null,
      reason: codes.qc,
      requestedOn: addDays(firstRead, -9),
    },
    {
      plate: style.plateId(0),
      compound: style.compoundId(9001),
      reason: codes.borderline,
      requestedOn: addDays(firstRead, -5),
    },
    {
      plate: style.plateId(0),
      compound: style.compoundId(9002),
      reason: codes.inconclusive,
      requestedOn: addDays(firstRead, -5),
    },
  ];
  const failed = plates.find((p) => !p.calls.stats.pass);
  if (failed)
    requests.push({
      plate: failed.id,
      compound: null,
      reason: codes.qc,
      requestedOn: addDays(failed.readOn, 1),
    });
  const passing = plates.find(
    (p) =>
      p.calls.stats.pass &&
      p.calls.compounds.some((c) => c.call === 'inconclusive' || c.borderline),
  );
  if (passing) {
    const compound = passing.calls.compounds.find(
      (c) => c.call === 'inconclusive' || c.borderline,
    )!;
    requests.push({
      plate: passing.id,
      compound: compound.compound,
      reason: compound.call === 'inconclusive' ? codes.inconclusive : codes.borderline,
      requestedOn: addDays(passing.readOn, 1),
    });
  }
  return requests
    .sort((a, b) => (a.requestedOn < b.requestedOn ? -1 : a.requestedOn > b.requestedOn ? 1 : 0))
    .map((request, i) => ({ ...request, id: style.retestId(i + 1) }));
}
