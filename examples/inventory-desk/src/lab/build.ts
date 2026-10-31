import { addDays } from '@architect/example-assay-desk';
import type { Random } from '@architect/example-assay-desk';
import type { AssayLab, RetestList } from './assay';
import { chainList } from './assay';
import { allocate, freeOf, inDate, lotsOf } from './stock';
import type { Hold, Lot, Store } from './stock';
import type { DeskStyle } from './style';

/**
 * A lab's compound store, before any file writes it: one to three lots of every compound on the
 * Assay desk's plates, and the reservations already held. Most lots are in date with plenty
 * left; some have expired or expire inside the lab's cutoff, some hold less than a re-test takes.
 * A few compounds that the Assay desk sends for a re-test are made to have nothing to draw, two
 * for each reason, and at a lab that combines lots one only two lots together can serve. One
 * compound of the list a team demo passes on (`chainList`) has nothing usable either, so the
 * demo always meets a compound it has to report.
 */

export interface Desk {
  style: DeskStyle;
  assay: AssayLab;
  store: Store;
  /** The list a team demo passes on, and its compound with nothing usable. */
  chain: { list: RetestList; short: string };
}

/** A compound with nothing to draw, for each reason, or one only lots combined can serve. */
type Case = 'expired' | 'low' | 'limit' | 'split';

/** Compounds of the re-test lists made to have nothing to draw, for each reason. */
const FORCED = 2;

export function buildDesk(assay: AssayLab, style: DeskStyle, random: Random): Desk {
  const { policy } = style;
  const today = assay.today;
  let lotNumber = 0;
  const nextLot = () => style.lotId((lotNumber += 1));
  const lots = new Map<string, Lot[]>();
  const stream = random.fork('lots');
  for (const compound of assay.compounds) {
    lots.set(compound, drawLots(stream, compound, style, today, nextLot));
  }

  const chain = chainList(assay);
  const listed = assay.lists
    .flatMap((list) => list.compounds)
    .filter((c) => !chain.compounds.includes(c));
  const pool = random.fork('cases').sample([...new Set(listed)], FORCED * 3 + 1);
  const cases = new Map<string, Case>();
  (['expired', 'low', 'limit'] as const).forEach((kind, i) => {
    for (const compound of pool.slice(i * FORCED, (i + 1) * FORCED)) cases.set(compound, kind);
  });
  if (policy.combine) cases.set(pool[FORCED * 3]!, 'split');
  const short = random.fork('chain').pick(chain.compounds);
  cases.set(short, random.fork('chain reason').pick(['expired', 'low'] as const));

  const shaping = random.fork('shape');
  for (const [compound, kind] of cases) {
    const own = lots.get(compound)!;
    if (kind === 'expired') {
      for (const lot of own) expireOn(shaping, lot, outOfDate(shaping, style, today), today);
    }
    if (kind === 'low') shortOf(shaping, own, style, today);
    if (kind === 'split') {
      if (own.length === 1) own.push(freshLot(shaping, compound, style, today, nextLot));
      splitOver(shaping, own, style, today);
    }
    if (kind === 'limit') {
      for (const lot of own) {
        expireOn(shaping, lot, addDays(today, shaping.int(policy.cutoff + 30, 600)), today);
        lot.quantity = Math.max(lot.quantity, policy.minimum + 20_000);
      }
    }
  }

  const holds = drawHolds(random.fork('holds'), lots, cases, chain, style, today);
  const store: Store = { lots: [...lots.values()].flat(), holds, policy, today };
  for (const compound of chain.compounds) {
    if (compound === short) continue;
    // The rest of the demo's list can be drawn: give a compound that can't a fresh lot.
    if (allocate(store, compound).reason !== null) {
      const fresh = freshLot(shaping, compound, style, today, nextLot);
      lots.get(compound)!.push(fresh);
      store.lots.push(fresh);
    }
  }
  breakTies(store);
  if (allocate(store, short).reason === null) throw new Error(`${short} can still be drawn`);
  const place = new Map(assay.compounds.map((c, i) => [c, i]));
  store.lots.sort(
    (a, b) => place.get(a.compound)! - place.get(b.compound)! || (a.lot < b.lot ? -1 : 1),
  );
  return { style, assay, store, chain: { list: chain, short } };
}

/** Days after the lab's day a lot expires, kept two days from the cutoff on either side. */
function expiryOffset(random: Random, cutoff: number): number {
  const kind = random.weighted([
    ['expired', 0.05],
    ['near', 0.04],
    ['fine', 0.91],
  ] as const);
  if (kind === 'expired') return -random.int(1, 300);
  if (kind === 'near') return random.int(0, cutoff - 2);
  return random.int(cutoff + 2, 720);
}

function outOfDate(random: Random, style: DeskStyle, today: string): string {
  const cutoff = style.policy.cutoff;
  return addDays(today, random.chance(0.6) ? -random.int(1, 300) : random.int(0, cutoff - 2));
}

/** A volume in whole steps of 500 nL. */
function steps(random: Random, from: number, to: number): number {
  return random.int(Math.ceil(from / 500), Math.floor(to / 500)) * 500;
}

function drawLots(
  random: Random,
  compound: string,
  style: DeskStyle,
  today: string,
  nextLot: () => string,
): Lot[] {
  const count = random.weighted([
    [1, 0.5],
    [2, 0.35],
    [3, 0.15],
  ] as const);
  const offsets = new Set<number>();
  while (offsets.size < count) offsets.add(expiryOffset(random, style.policy.cutoff));
  return [...offsets].map((offset) => {
    const quantity = random.chance(0.07)
      ? steps(random, 500, style.policy.minimum - 1_000)
      : steps(random, style.policy.minimum + 5_000, 400_000);
    return lotAt(random, compound, style, today, addDays(today, offset), quantity, nextLot);
  });
}

function lotAt(
  random: Random,
  compound: string,
  style: DeskStyle,
  today: string,
  expires: string,
  quantity: number,
  nextLot: () => string,
): Lot {
  return {
    compound,
    lot: nextLot(),
    location: style.location(random),
    quantity,
    concMm: random.pick([10, 10, 10, 5, 2]),
    received: receivedFor(random, expires, today),
    expires,
  };
}

/** The day a lot with this expiry came in: a shelf life before it, and before the lab's day. */
function receivedFor(random: Random, expires: string, today: string): string {
  const received = addDays(expires, -random.pick([365, 540, 730]));
  return received < today ? received : addDays(today, -random.int(7, 60));
}

function expireOn(random: Random, lot: Lot, expires: string, today: string): void {
  lot.expires = expires;
  lot.received = receivedFor(random, expires, today);
}

function freshLot(
  random: Random,
  compound: string,
  style: DeskStyle,
  today: string,
  nextLot: () => string,
): Lot {
  const expires = addDays(today, random.int(style.policy.cutoff + 30, 600));
  const quantity = steps(random, style.policy.minimum + 20_000, 300_000);
  return lotAt(random, compound, style, today, expires, quantity, nextLot);
}

/** In date, but too little to make up a re-test, by the lab's rule for combining lots. */
function shortOf(random: Random, own: Lot[], style: DeskStyle, today: string): void {
  const { minimum, cutoff, combine } = style.policy;
  const most = combine ? Math.floor(minimum / (own.length + 1)) : minimum - 1_000;
  const quantities = new Set<number>();
  while (quantities.size < own.length) quantities.add(steps(random, 500, Math.max(1_500, most)));
  own.forEach((lot, i) => {
    expireOn(random, lot, addDays(today, random.int(cutoff + 2, 600)), today);
    lot.quantity = [...quantities][i]!;
  });
}

/** Two lots in date, each short of a re-test and together enough for one; any other out of date. */
function splitOver(random: Random, own: Lot[], style: DeskStyle, today: string): void {
  const { minimum, cutoff } = style.policy;
  const quantities = new Set<number>();
  while (quantities.size < 2) quantities.add(steps(random, minimum / 2 + 1_000, minimum - 1_000));
  own.forEach((lot, i) => {
    if (i >= 2) return expireOn(random, lot, outOfDate(random, style, today), today);
    expireOn(random, lot, addDays(today, random.int(cutoff + 2, 600)), today);
    lot.quantity = [...quantities][i]!;
  });
}

/**
 * The reservations already held: a few on one compound in twelve, never as many as the limit,
 * and the limit's worth on each compound made to reach it. A hold never takes more than a lot
 * has free. None touches the demo's list, so its compounds are what the store's lots make them.
 */
function drawHolds(
  random: Random,
  lots: ReadonlyMap<string, Lot[]>,
  cases: ReadonlyMap<string, Case>,
  chain: RetestList,
  style: DeskStyle,
  today: string,
): Hold[] {
  const { maxHolds } = style.policy;
  const holds: Omit<Hold, 'id'>[] = [];
  const hold = (lot: Lot, most: number) => {
    const free = freeOf(lot, holds);
    if (free < 1_000) return false;
    const amount = random.int(1, Math.min(most, Math.floor(free / 1_000))) * 1_000;
    holds.push({
      compound: lot.compound,
      lot: lot.lot,
      amount,
      reservedOn: addDays(today, -random.int(1, 45)),
    });
    return true;
  };
  for (const [compound, own] of lots) {
    if (chain.compounds.includes(compound)) continue;
    const kind = cases.get(compound);
    if (kind === 'limit') {
      for (let n = 0; n < maxHolds;) if (hold(random.pick(own), 4)) n += 1;
      continue;
    }
    if (kind !== undefined || !random.chance(1 / 12)) continue;
    const count = random.int(1, maxHolds - 1);
    for (let n = 0; n < count; n++) hold(random.pick(own), 40);
  }
  return holds
    .sort((a, b) => (a.reservedOn < b.reservedOn ? -1 : a.reservedOn > b.reservedOn ? 1 : 0))
    .map((h, i) => ({ ...h, id: style.reservationId(i + 1) }));
}

/**
 * No two lots of a compound in date tie on either key a policy orders lots by, so which lot comes
 * first is never in doubt: an expiry that ties another moves a day later, and a free volume that
 * ties another is raised by 500 nL, until none does.
 */
function breakTies(store: Store): void {
  for (const compound of new Set(store.lots.map((lot) => lot.compound))) {
    const own = lotsOf(store, compound).filter((lot) => inDate(lot, store));
    const tied = (keys: readonly (string | number)[]) =>
      keys.findIndex((key, i) => keys.indexOf(key) !== i);
    for (let at = tied(own.map((lot) => lot.expires)); at >= 0;) {
      own[at]!.expires = addDays(own[at]!.expires, 1);
      at = tied(own.map((lot) => lot.expires));
    }
    for (let at = tied(own.map((lot) => freeOf(lot, store.holds))); at >= 0;) {
      own[at]!.quantity += 500;
      at = tied(own.map((lot) => freeOf(lot, store.holds)));
    }
  }
}
