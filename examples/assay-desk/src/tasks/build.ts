import type { JsonValue, Task } from '@architect/shared';
import type { Lab, Plate } from '../lab/build';
import { writeWell } from '../lab/files';
import { retestNeeds } from '../lab/science';
import type { CompoundCall, RetestRequest } from '../lab/science';
import { longDate, monthDay } from '../lib/calendar';
import type { Random } from '../lib/random';
import type { PlatePick } from '../reference/code';

/**
 * The six kinds of request the Assay desk answers, a set number of each per lab, written the way
 * a scientist at the bench would ask. Every expected value comes from the lab's true wells
 * (src/lab/science.ts), before any export wrote them.
 */

export const SKILLS = [
  'normalize',
  'hits',
  'qc',
  'replicates',
  'retest_plan',
  'plate_report',
] as const;
export type Skill = (typeof SKILLS)[number];

/** Tasks of each skill at a lab: 48 a lab. */
export const PER_SKILL = 8;

/** Points of percent inhibition, and of Z′, an answer may be off by. */
export const INHIBITION_TOLERANCE = 0.5;
export const Z_TOLERANCE = 0.01;

export interface NormalizeRequest {
  plate: string;
  wells: string[];
}
export interface PlateRequest {
  plate: string;
}
export interface ReplicateRequest {
  plate: string;
  compound: string;
}
export interface RetestPlanRequest {
  pick: PlatePick;
}

const ANSWERS: Record<Skill, string> = {
  normalize:
    'End with: ANSWER: {"inhibition": {"<well>": <percent inhibition, or null for a well with no reading>}}',
  hits: 'End with: ANSWER: {"hits": ["<compound_id>", ...]}',
  qc: 'End with: ANSWER: {"plate": "<plate_id>", "z_prime": <number>, "qc": "pass" or "fail"}',
  replicates:
    'End with: ANSWER: {"compound": "<compound_id>", "inhibition": [<percent inhibition of each well with a reading>], "mean": <number, or null>, "agree": <true or false>, "call": "hit", "inactive" or "inconclusive"}',
  retest_plan: 'End with: ANSWER: {"retests": <rows added to retests.csv>}',
  plate_report:
    'End with: ANSWER: {"plate": "<plate_id>", "z_prime": <number>, "qc": "pass" or "fail", "hits": ["<compound_id>", ...], "retests": <rows added to retests.csv>}',
};

const four = (x: number) => Math.round(x * 10_000) / 10_000;

export function buildTasks(random: Random, lab: Lab): Task[] {
  const context = new Context(lab);
  return [
    ...normalizeTasks(random.fork('normalize'), context),
    ...plateTasks(random.fork('hits'), context, 'hits'),
    ...plateTasks(random.fork('qc'), context, 'qc'),
    ...replicateTasks(random.fork('replicates'), context),
    ...retestTasks(random.fork('retest_plan'), context),
    ...plateTasks(random.fork('plate_report'), context, 'plate_report'),
  ];
}

class Context {
  readonly id: string;
  readonly today: string;
  private readonly counts = new Map<Skill, number>();

  constructor(readonly lab: Lab) {
    this.id = lab.style.id;
    this.today = lab.style.today;
  }

  /** The plates the lab's tasks of one skill go through: each once, in a shuffled order. */
  plates(random: Random): Plate[] {
    return random.shuffle(this.lab.plates).slice(0, PER_SKILL);
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
      prompt: `It's ${longDate(this.today)}. ${ask}\n${ANSWERS[skill]}`,
      expected,
      meta: { request, summary },
    };
  }

  /** What a set of plates needs queued, and the ids the new rows take. */
  retests(plates: readonly Plate[]): Record<string, JsonValue> {
    const queued: RetestRequest[] = this.lab.queue;
    const policy = this.lab.style.policy;
    const needs = plates.map((plate) => {
      const need = retestNeeds(plate.id, plate.calls, policy, queued);
      return {
        plate: plate.id,
        qc: plate.calls.stats.pass ? 'pass' : 'fail',
        whole: need.whole,
        candidates: need.candidates.map((c) => ({ compound: c.compound, reason: c.reason })),
        take: need.take,
      };
    });
    const count = needs.reduce((sum, need) => sum + (need.whole ? 1 : 0) + need.take, 0);
    return {
      requested_on: this.today,
      qc_reason: policy.codes.qc,
      plates: needs,
      ids: nextIds(
        this.lab.queue.map((r) => r.id),
        count,
      ),
    };
  }
}

/** The next ids after the highest in a list, in its last id's form. */
export function nextIds(existing: readonly string[], count: number): string[] {
  const last = /^(.*?)(\d+)$/.exec(existing[existing.length - 1]!)!;
  const top = Math.max(...existing.map((id) => Number(/(\d+)$/.exec(id)![1])));
  return Array.from(
    { length: count },
    (_, i) => last[1]! + String(top + i + 1).padStart(last[2]!.length, '0'),
  );
}

function wellsList(names: readonly string[]): string {
  return names.length === 1
    ? names[0]!
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]!}`;
}

function normalizeTasks(random: Random, context: Context): Task[] {
  let withoutReading = 0;
  return context.plates(random).map((plate) => {
    const compoundWells = plate.wells.filter((w) => w.role === 'compound');
    const missing = compoundWells.filter((w) => w.signal === null);
    const strongest = [...compoundWells]
      .filter((w) => w.signal !== null)
      .sort((a, b) => a.signal! - b.signal!)[0]!;
    const chosen = [strongest];
    if (missing.length > 0 && withoutReading < 3) {
      chosen.push(random.pick(missing));
      withoutReading += 1;
    }
    for (const well of random.shuffle(compoundWells)) {
      if (chosen.length >= 3) break;
      if (!chosen.includes(well)) chosen.push(well);
    }
    const ordered = random.shuffle(chosen);
    const names = ordered.map((w) => writeWell(w.well, random.chance(0.5)));
    const { negMean, posMean } = plate.calls.stats;
    const wells = Object.fromEntries(
      ordered.map((w, i) => [
        names[i]!,
        w.signal === null ? null : four((100 * (negMean - w.signal)) / (negMean - posMean)),
      ]),
    );
    const ask = random.pick([
      `Can you give me the percent inhibition for wells ${wellsList(names)} on plate ${plate.id}?`,
      `What's the % inhibition in ${wellsList(names)} on ${plate.id}? Normalize to that plate's own controls.`,
      `I need normalized values for ${wellsList(names)} on ${plate.id}, please.`,
    ]);
    return context.task(
      'normalize',
      `normalize:${plate.id}`,
      ask,
      {
        kind: 'end_state',
        validator: 'inhibition',
        params: { plate: plate.id, wells, tolerance: INHIBITION_TOLERANCE },
      },
      { plate: plate.id, wells: names },
      `${plate.id}: ${names.join(', ')}`,
    );
  });
}

function plateTasks(
  random: Random,
  context: Context,
  skill: 'hits' | 'qc' | 'plate_report',
): Task[] {
  return context.plates(random).map((plate) => {
    const { stats, hits } = plate.calls;
    const qc = stats.pass ? 'pass' : 'fail';
    const z = four(stats.zPrime);
    const request = { plate: plate.id };
    const family = `${skill}:${plate.id}`;
    if (skill === 'hits') {
      const ask = random.pick([
        `Which compounds on plate ${plate.id} are hits by our rules?`,
        `Pull the hit list for ${plate.id}, please.`,
        `What are the hits on ${plate.id}?`,
      ]);
      return context.task(
        skill,
        family,
        ask,
        { kind: 'end_state', validator: 'hit_set', params: { plate: plate.id, qc, hits } },
        request,
        `${qc}, ${hits.length} hits`,
      );
    }
    if (skill === 'qc') {
      const ask = random.pick([
        `Did plate ${plate.id} pass QC? What's its Z′?`,
        `QC check on ${plate.id}, please: the Z′, and pass or fail.`,
        `Is ${plate.id} good enough to call hits from? Give me the Z′.`,
      ]);
      return context.task(
        skill,
        family,
        ask,
        {
          kind: 'end_state',
          validator: 'plate_qc',
          params: { plate: plate.id, z_prime: z, qc, tolerance: Z_TOLERANCE },
        },
        request,
        `Z′ ${z.toFixed(3)}, ${qc}`,
      );
    }
    const ask = random.pick([
      `Write up plate ${plate.id} for me: QC, the hit list, and queue whatever needs a re-test.`,
      `Full read on ${plate.id}, please: Z′, pass or fail, the hits, and put the re-tests in the queue.`,
    ]);
    const retests = context.retests([plate]);
    return context.task(
      skill,
      family,
      ask,
      {
        kind: 'end_state',
        validator: 'plate_report',
        params: { plate: plate.id, z_prime: z, qc, hits, tolerance: Z_TOLERANCE, retests },
        writes: ['retests.csv'],
      },
      request,
      `${qc}, ${hits.length} hits, ${(retests as { ids: string[] }).ids.length} re-tests`,
    );
  });
}

function replicateTasks(random: Random, context: Context): Task[] {
  const pool = context.lab.plates
    .filter((plate) => plate.calls.stats.pass)
    .flatMap((plate) =>
      plate.calls.compounds
        .filter((c) => c.wells.length > 1 && c.values.length > 0)
        .map((c) => ({ plate, compound: c })),
    );
  const of = (test: (c: CompoundCall) => boolean) =>
    random.shuffle(pool.filter((p) => test(p.compound)));
  const picked: typeof pool = [];
  const add = (items: typeof pool, count: number) => {
    for (const item of items) {
      if (picked.length >= PER_SKILL || count === 0) return;
      if (picked.includes(item)) continue;
      picked.push(item);
      count -= 1;
    }
  };
  add(
    of((c) => c.call === 'inconclusive' && c.values.length === c.wells.length),
    2,
  );
  add(
    of((c) => c.values.length < c.wells.length),
    1,
  );
  add(
    of((c) => c.call === 'hit'),
    2,
  );
  add(
    of((c) => c.borderline),
    1,
  );
  add(random.shuffle(pool), PER_SKILL);
  return random.shuffle(picked).map(({ plate, compound: c }) => {
    const ask = random.pick([
      `${c.compound} was run in duplicate on ${plate.id}. Do the wells agree, and what's the call?`,
      `Check the replicates of ${c.compound} on ${plate.id} for me: do they agree, and is it a hit?`,
      `Before I order more of ${c.compound}: how do its replicates on ${plate.id} look, and what do we call it?`,
    ]);
    return context.task(
      'replicates',
      `replicates:${plate.id}:${c.compound}`,
      ask,
      {
        kind: 'end_state',
        validator: 'replicate_call',
        params: {
          plate: plate.id,
          compound: c.compound,
          inhibition: c.values.map(four),
          mean: c.mean === null ? null : four(c.mean),
          agree: c.agree,
          call: c.call,
          tolerance: INHIBITION_TOLERANCE,
        },
      },
      { plate: plate.id, compound: c.compound },
      `${c.call}${c.agree ? '' : ', replicates disagree'}`,
    );
  });
}

function retestTasks(random: Random, context: Context): Task[] {
  const { plates, queue } = context.lab;
  const days = [...new Set(plates.map((p) => p.readOn))];
  const picks: { pick: PlatePick; plates: Plate[] }[] = days.map((day) => ({
    pick: { readOn: day },
    plates: plates.filter((p) => p.readOn === day),
  }));
  // Named plates: those the queue already holds something for first, then pairs and singles.
  const queuedFirst = [
    ...plates.filter((p) => queue.some((r) => r.plate === p.id)),
    ...random.shuffle(plates.filter((p) => !queue.some((r) => r.plate === p.id))),
  ];
  for (let i = 0; picks.length < PER_SKILL; i++) {
    const first = queuedFirst[i % queuedFirst.length]!;
    const second = i % 2 === 1 ? queuedFirst[(i + 3) % queuedFirst.length]! : null;
    const named = second === null || second === first ? [first] : [first, second];
    picks.push({ pick: { plates: named.map((p) => p.id) }, plates: named });
  }
  return picks.map(({ pick, plates: chosen }) => {
    const ask =
      'readOn' in pick
        ? random.pick([
            `Please queue the re-tests for the plates we read on ${monthDay(pick.readOn)}.`,
            `Can you set up re-tests for everything read on ${longDate(pick.readOn)}?`,
          ])
        : random.pick([
            `Queue whatever needs re-testing from ${wellsList(pick.plates)}.`,
            `Set up the re-tests for ${wellsList(pick.plates)}, per policy.`,
          ]);
    const retests = context.retests(chosen);
    const count = (retests as { ids: string[] }).ids.length;
    return context.task(
      'retest_plan',
      `retest_plan:${chosen.map((p) => p.id).join('+')}`,
      ask,
      { kind: 'end_state', validator: 'retest_plan', params: retests, writes: ['retests.csv'] },
      { pick },
      `${chosen.length} ${chosen.length === 1 ? 'plate' : 'plates'}, ${count} re-tests`,
    );
  });
}
