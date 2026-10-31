import { longDate, nextIds } from '@architect/example-assay-desk';
import type { Random } from '@architect/example-assay-desk';
import type { JsonValue, Task } from '@architect/shared';
import type { Desk } from '../lab/build';
import { allocate, freeOf, inDate, lotsOf, usableLots, usableVolume } from '../lab/stock';
import type { Allocation, Lot } from '../lab/stock';
import { microlitres } from '../lab/volume';

/**
 * The four kinds of request the Inventory desk answers, a set number of each per lab, written the
 * way a scientist at the bench would ask. The lists of compounds to allocate and reserve are the
 * ones the Assay desk sends for a re-test (src/lab/assay.ts). Every expected value comes from the
 * store's true lots and holds (src/lab/stock.ts), before any file wrote them.
 */

export const SKILLS = ['usable', 'pick_lot', 'allocate', 'reserve'] as const;
export type Skill = (typeof SKILLS)[number];

/** Tasks of each skill at a lab: 32 a lab. */
export const PER_SKILL = 8;

/** Microlitres an answer's volume may be off by. */
export const VOLUME_TOLERANCE = 0.05;

/** The most compounds in one list. */
const LIST_SIZE = 4;

export interface CompoundRequest {
  compound: string;
}
export interface ListRequest {
  plate: string;
  compounds: string[];
}

const DRAWS =
  '"draws": [{"lot": "<lot>", "location": "<location>", "amount_ul": <microlitres>}], "reason": null, or the reason code when there is nothing to draw';

const ANSWERS: Record<Skill, string> = {
  usable:
    'End with: ANSWER: {"compound": "<compound_id>", "usable_ul": <microlitres usable>, "lots": ["<lot>", ...]}',
  pick_lot: `End with: ANSWER: {"compound": "<compound_id>", ${DRAWS}}`,
  allocate: `End with: ANSWER: {"allocations": [{"compound": "<compound_id>", ${DRAWS}}, ...]}`,
  reserve:
    'End with: ANSWER: {"reserved": ["<compound_id>", ...], "unavailable": [{"compound": "<compound_id>", "reason": "<reason code>"}, ...]}',
};

export function buildTasks(random: Random, desk: Desk): Task[] {
  const context = new Context(desk);
  const lists = context.lists(random.fork('lists'));
  return [
    ...usableTasks(random.fork('usable'), context),
    ...pickTasks(random.fork('pick_lot'), context),
    ...listTasks(random.fork('allocate'), context, 'allocate', lists.allocate),
    ...listTasks(random.fork('reserve'), context, 'reserve', lists.reserve),
  ];
}

/** An allocation as an ANSWER line gives it, in microlitres. */
export function allocationValue(allocation: Allocation): Record<string, JsonValue> {
  return {
    compound: allocation.compound,
    draws: allocation.draws.map((d) => ({
      lot: d.lot,
      location: d.location,
      amount_ul: microlitres(d.amount),
    })),
    reason: allocation.reason,
  };
}

function namesList(names: readonly string[]): string {
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

class Context {
  readonly id: string;
  private readonly counts = new Map<Skill, number>();

  constructor(readonly desk: Desk) {
    this.id = desk.assay.id;
  }

  get store() {
    return this.desk.store;
  }

  task(
    skill: Skill,
    family: string,
    ask: string,
    expected: Task['expected'],
    request: JsonValue,
    summary: string,
  ): Task {
    const n = (this.counts.get(skill) ?? 0) + 1;
    this.counts.set(skill, n);
    return {
      id: `${this.id}-${skill}-${String(n).padStart(2, '0')}`,
      type: skill,
      family: `${this.id}:${family}`,
      org: this.id,
      prompt: `It's ${longDate(this.desk.assay.today)}. ${ask}\n${ANSWERS[skill]}`,
      expected,
      meta: { request, summary },
    };
  }

  /**
   * Compounds for the single-compound skills: a few of each hard case first, then any others,
   * each compound once.
   */
  compounds(random: Random, cases: readonly [(compound: string) => boolean, number][]): string[] {
    const all = this.desk.assay.compounds;
    const picked: string[] = [];
    for (const [test, count] of cases) {
      const fits = random.shuffle(all.filter((c) => test(c) && !picked.includes(c)));
      picked.push(...fits.slice(0, count));
    }
    for (const c of random.shuffle(all)) {
      if (picked.length >= PER_SKILL) break;
      if (!picked.includes(c)) picked.push(c);
    }
    return random.shuffle(picked.slice(0, PER_SKILL));
  }

  /**
   * The lists the allocate and reserve tasks go through. The demo's list comes first in both, as
   * the Assay desk gives it; the rest are the other plates' lists, cut into lists of at most
   * four, those with a compound that has nothing to draw first.
   */
  lists(random: Random): { allocate: ListRequest[]; reserve: ListRequest[] } {
    const chain = this.desk.chain.list;
    const pieces = this.desk.assay.lists
      .filter((list) => list.plate !== chain.plate)
      .flatMap((list) => {
        const count = Math.ceil(list.compounds.length / LIST_SIZE);
        return Array.from({ length: count }, (_, i) => ({
          plate: list.plate,
          compounds: list.compounds.filter((_, at) => at % count === i),
        }));
      });
    const short = (list: ListRequest) =>
      list.compounds.some((c) => allocate(this.store, c).reason !== null);
    const shuffled = random.shuffle(pieces);
    const ordered = [...shuffled.filter(short), ...shuffled.filter((l) => !short(l))];
    const others = PER_SKILL - 1;
    if (ordered.length < others * 2) {
      throw new Error(`${this.id} has ${ordered.length} lists to re-test, not ${others * 2}`);
    }
    const first = { plate: chain.plate, compounds: chain.compounds };
    const toAllocate = ordered.filter((_, i) => i % 2 === 0).slice(0, others);
    const toReserve = ordered.filter((_, i) => i % 2 === 1).slice(0, others);
    return { allocate: [first, ...toAllocate], reserve: [first, ...toReserve] };
  }
}

function usableTasks(random: Random, context: Context): Task[] {
  const store = context.store;
  const { minimum } = store.policy;
  const own = (c: string) => lotsOf(store, c);
  const free = (lot: Lot) => freeOf(lot, store.holds);
  const picked = context.compounds(random, [
    [(c) => own(c).some((l) => !inDate(l, store)) && usableLots(store, c).length > 0, 2],
    [(c) => usableVolume(store, c) === 0, 1],
    [(c) => store.holds.some((h) => h.compound === c && usableLots(store, c).length > 0), 2],
    [(c) => own(c).some((l) => inDate(l, store) && free(l) > 0 && free(l) < minimum), 1],
  ]);
  return picked.map((compound) => {
    const lots = usableLots(store, compound).map((lot) => lot.lot);
    const volume = microlitres(usableVolume(store, compound));
    const ask = random.pick([
      `How much ${compound} do we have that we can actually use?`,
      `What's the usable stock of ${compound}, and in which lots?`,
      `Before I plan anything with ${compound}: how much of it is usable right now?`,
    ]);
    return context.task(
      'usable',
      `usable:${compound}`,
      ask,
      {
        kind: 'end_state',
        validator: 'usable_volume',
        params: { compound, usable_ul: volume, lots, tolerance: VOLUME_TOLERANCE },
      },
      { compound },
      `${volume} µL in ${lots.length} ${lots.length === 1 ? 'lot' : 'lots'}`,
    );
  });
}

function pickTasks(random: Random, context: Context): Task[] {
  const store = context.store;
  const { codes, minimum } = store.policy;
  const reason = (c: string) => allocate(store, c).reason;
  const usable = (c: string) => usableLots(store, c);
  const byExpiry = (c: string) =>
    [...usable(c)].sort((a, b) => (a.expires < b.expires ? -1 : 1))[0]?.lot;
  const byFree = (c: string) =>
    [...usable(c)].sort((a, b) => freeOf(b, store.holds) - freeOf(a, store.holds))[0]?.lot;
  const picked = context.compounds(random, [
    [(c) => usable(c).length > 1 && byExpiry(c) !== byFree(c), 2],
    [
      (c) =>
        reason(c) === null &&
        lotsOf(store, c).some((l) => !inDate(l, store) && l.expires >= store.today),
      1,
    ],
    [(c) => reason(c) === codes.expired, 1],
    [(c) => reason(c) === codes.low, 1],
    [(c) => reason(c) === codes.limit, 1],
    [(c) => allocate(store, c).draws.length > 1, 1],
    [
      (c) =>
        lotsOf(store, c).some(
          (l) => inDate(l, store) && l.quantity >= minimum && freeOf(l, store.holds) < minimum,
        ),
      1,
    ],
  ]);
  return picked.map((compound) => {
    const allocation = allocate(store, compound);
    const ask = random.pick([
      `Which lot of ${compound} should I pull for a re-test, and where is it?`,
      `I need ${compound} for a re-test. Which lot do I take it from?`,
      `Where do I get ${compound} for a re-test from, by our rules?`,
    ]);
    return context.task(
      'pick_lot',
      `pick_lot:${compound}`,
      ask,
      {
        kind: 'end_state',
        validator: 'lot_pick',
        params: { ...allocationValue(allocation), tolerance: VOLUME_TOLERANCE },
      },
      { compound },
      allocation.reason ?? allocation.draws.map((d) => d.lot).join(' + '),
    );
  });
}

function listTasks(
  random: Random,
  context: Context,
  skill: 'allocate' | 'reserve',
  lists: readonly ListRequest[],
): Task[] {
  const store = context.store;
  return lists.map((list) => {
    const names = namesList(list.compounds);
    const allocations = list.compounds.map((c) => allocate(store, c));
    const draws = allocations.reduce((sum, a) => sum + a.draws.length, 0);
    const missing = allocations.filter((a) => a.reason !== null).length;
    const summary = `${list.compounds.length} compounds, ${missing} with nothing to draw`;
    const family = `list:${list.plate}:${list.compounds.join('+')}`;
    const values = allocations.map(allocationValue);
    if (skill === 'allocate') {
      const ask = random.pick([
        `Assay desk sent these from ${list.plate} for a re-test: ${names}. Which lot does each come from?`,
        `The re-tests from ${list.plate} need stock: ${names}. Work out which lots we draw from, per policy.`,
        `Can you allocate stock for the re-tests of ${names} (plate ${list.plate})?`,
      ]);
      return context.task(
        skill,
        family,
        ask,
        {
          kind: 'end_state',
          validator: 'allocation',
          params: { allocations: values, tolerance: VOLUME_TOLERANCE },
        },
        { plate: list.plate, compounds: list.compounds },
        summary,
      );
    }
    const ask = random.pick([
      `Assay desk queued re-tests for ${names} from ${list.plate}. Reserve the stock for them, please.`,
      `Please put holds on stock for the ${list.plate} re-tests: ${names}.`,
    ]);
    return context.task(
      skill,
      family,
      ask,
      {
        kind: 'end_state',
        validator: 'reservation',
        params: {
          allocations: values,
          reserved_on: store.today,
          unit: store.policy.unit,
          ids: nextIds(
            store.holds.map((h) => h.id),
            draws,
          ),
          tolerance: VOLUME_TOLERANCE,
        },
        writes: ['reservations.csv'],
      },
      { plate: list.plate, compounds: list.compounds },
      `${summary}, ${draws} ${draws === 1 ? 'row' : 'rows'}`,
    );
  });
}
