import type { Policy } from './policy';

/**
 * The rules of drawing stock, on the true lots and holds before any file wrote them: a lot's free
 * volume, whether it is in date, which lots are usable and in what order, and what one re-test of
 * a compound draws, or why it can't. The tasks' expected values come from here. The reference
 * works the same rules out again from the files themselves, in the code it sends to `run`
 * (src/reference/code.ts).
 */

export interface Lot {
  compound: string;
  lot: string;
  location: string;
  /** Nanolitres left. */
  quantity: number;
  concMm: number;
  received: string;
  expires: string;
}

/** A reservation: stock of one lot held for work not yet run. */
export interface Hold {
  id: string;
  compound: string;
  lot: string;
  /** Nanolitres held. */
  amount: number;
  reservedOn: string;
}

export interface Store {
  lots: Lot[];
  holds: Hold[];
  policy: Policy;
  /** The day of the request. */
  today: string;
}

export interface Draw {
  lot: string;
  location: string;
  /** Nanolitres drawn. */
  amount: number;
}

/** One re-test of a compound: the lots it draws from, or the reason it has nothing to draw. */
export interface Allocation {
  compound: string;
  draws: Draw[];
  reason: string | null;
}

/** Whole days from one YYYY-MM-DD date to another. */
export function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}

export function inDate(lot: Lot, store: Store): boolean {
  return daysBetween(store.today, lot.expires) >= store.policy.cutoff;
}

/** Nanolitres of a lot no reservation holds. */
export function freeOf(lot: Lot, holds: readonly Pick<Hold, 'lot' | 'amount'>[]): number {
  return holds.filter((h) => h.lot === lot.lot).reduce((left, h) => left - h.amount, lot.quantity);
}

export function lotsOf(store: Store, compound: string): Lot[] {
  return store.lots.filter((lot) => lot.compound === compound);
}

/** A compound's usable lots, in the order the policy draws from them. */
export function usableLots(store: Store, compound: string): Lot[] {
  const { policy, holds } = store;
  const least = policy.combine ? 1 : policy.minimum;
  const free = (lot: Lot) => freeOf(lot, holds);
  return lotsOf(store, compound)
    .filter((lot) => inDate(lot, store) && free(lot) >= least)
    .sort((a, b) =>
      policy.choose === 'expiry'
        ? daysBetween(b.expires, a.expires) || order(a.lot, b.lot)
        : free(b) - free(a) || order(a.lot, b.lot),
    );
}

function order(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** How much of a compound is usable: the free volume of its usable lots, in nanolitres. */
export function usableVolume(store: Store, compound: string): number {
  return usableLots(store, compound).reduce((sum, lot) => sum + freeOf(lot, store.holds), 0);
}

/**
 * What one re-test of a compound draws, by the policy. Whether it can be drawn at all comes first:
 * no lot in date, or too little in the lots that are. A re-test that can be drawn is reserved
 * only if the compound's reservations, with one new row for each lot drawn, come to no more than
 * the policy's limit.
 */
export function allocate(store: Store, compound: string): Allocation {
  const { policy, holds } = store;
  const none = (reason: string): Allocation => ({ compound, draws: [], reason });
  if (!lotsOf(store, compound).some((lot) => inDate(lot, store))) return none(policy.codes.expired);
  const draws: Draw[] = [];
  let needed = policy.minimum;
  for (const lot of usableLots(store, compound)) {
    if (needed === 0) break;
    const amount = Math.min(needed, freeOf(lot, holds));
    draws.push({ lot: lot.lot, location: lot.location, amount });
    needed -= amount;
  }
  if (needed > 0) return none(policy.codes.low);
  const held = holds.filter((h) => h.compound === compound).length;
  return held + draws.length > policy.maxHolds
    ? none(policy.codes.limit)
    : { compound, draws, reason: null };
}
