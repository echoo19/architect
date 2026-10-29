import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskSchema, type SplitConfig, type Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditSplits, divide, DIVISION_ATTEMPTS } from '../src/drafting/division';
import { generateTasks, splitSizes, type GeneratedType } from '../src/drafting/generate';
import type { RuleCase, Tables } from '../src/drafting/rule/cases';
import { auditSet } from '../src/drafting/rule/guards';
import * as q from '../src/drafting/rule/rational';
import type { TaskSplits } from '../src/loop/deps';
import { SplitError } from '../src/splits/split';
import { draftingWorld, TEACHER, type DraftingWorld } from './support/drafting-world';
import { bikeRule, bikeShop, bikeTables, col, num, POLICY } from './support/rule-data';
import { bikeDraft, costType, CONTACT_TYPE, step } from './support/rule-draft';

/*
 * A copy that passes the guard over all of a rule's cases can still pass the final test it was
 * divided into: with an 80% target, 79 copies in 100 cases are let through, and a final test of
 * 33 tasks can hold 27 of them. The sets are held to the guard as they are divided (decision 061).
 */

const bike = bikeShop({ offGrid: true });
const shop = bikeTables(bike);

/** Members pay five more than the parts cost as written, so the other tickets are a copy of it. */
const mostlyCopy = bikeRule({
  expression: {
    op: 'round',
    increment: '0.01',
    mode: 'half_up',
    arg: {
      op: 'if',
      when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
      then: { op: 'add', args: [col('parts_cost'), num('5')] },
      else: col('parts_cost'),
    },
  },
});

/** Whether the ticket of a task is one whose answer is the parts cost as written. */
function isCopy(task: Task): boolean {
  const ticket = bike.tickets.find((item) => item.id === task.meta?.['key']);
  const customer = bike.customers.find((item) => item.id === ticket?.customerId);
  return customer !== undefined && !customer.member;
}

describe('holding the sets as they are divided to the guard of a rule', () => {
  const made = generateTasks(
    [{ id: 'cost', label: 'Ticket totals', description: '', spec: mostlyCopy }],
    shop,
    11,
    { passRate: 0.8 },
  );
  const types: GeneratedType[] = made.types;
  const copies = made.tasks.filter(isCopy);
  const others = made.tasks.filter((task) => !isCopy(task));
  const empty: TaskSplits = { calibration: [], train: [], dev: [], test: [] };

  it('lets the rule through over all its cases, which are a copy in under four in five', () => {
    expect(made.rejected).toEqual([]);
    expect(copies.length / made.tasks.length).toBeLessThan(0.8);
    expect(copies.length / made.tasks.length).toBeGreaterThan(0.6);
  });

  it('refuses a final test of 33 that holds 27 copies, which is 82% against a target of 80%', () => {
    const test = [...copies.slice(0, 27), ...others.slice(0, 6)];
    const problems = auditSplits(types, { ...empty, test }, 0.8);
    expect(problems).toEqual([
      'Task type "cost" (Ticket totals): Of the 33 final-test tasks Architect set aside, 27 (82%) have the value of parts_cost for their answer, and the job asks for 80% right, so an agent that copies it would pass the final test without working anything out. A rule has to work something out.',
    ]);
  });

  it('lets a final test of 33 with 26 copies through, which is under the target', () => {
    const test = [...copies.slice(0, 26), ...others.slice(0, 7)];
    expect(auditSplits(types, { ...empty, test }, 0.8)).toEqual([]);
  });

  it('holds the check tasks to it too, since their target ends training', () => {
    const dev = [...copies.slice(0, 25), ...others.slice(0, 5)];
    const problems = auditSplits(types, { ...empty, dev }, 0.8);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('Of the 30 check tasks Architect set aside, 25 (83%)');
    expect(problems[0]).toContain('would reach the target on the check tasks without working');
  });

  it('counts only the tasks of the rule in the set, and holds nothing that has no rule', () => {
    const email = { ...copies[0], type: 'email' } as Task;
    const test = [...copies.slice(0, 27), ...others.slice(0, 6), ...Array(40).fill(email)];
    // Forty tasks of another kind don't dilute what a copy gets of this rule's own tasks.
    expect(auditSplits(types, { ...empty, test }, 0.8)).toHaveLength(1);
    const plain: GeneratedType = { ...(types[0] as GeneratedType) };
    delete plain.outcome;
    expect(auditSplits([plain], { ...empty, test }, 0.8)).toEqual([]);
  });

  it('names the key when the answer of most of them is the key, which needs no column to copy', () => {
    const echo = (key: string, answer: bigint) =>
      ({ key, answer: q.fraction(answer), row: {}, lookupRow: null }) as unknown as RuleCase;
    const cases = [echo('1', 1n), echo('2', 2n), echo('3', 3n), echo('4', 9n)];
    const tables = { source: { columns: [] }, lookup: null } as unknown as Tables;
    expect(
      auditSet(mostlyCopy, tables, cases, 0.7, {
        tasks: 'final-test tasks',
        passes: 'pass the final test',
      }),
    ).toEqual([
      'Of the 4 final-test tasks Architect set aside, 3 (75%) have the ticket_id for their answer, and the job asks for 70% right, so an agent that copies it would pass the final test without working anything out. A rule has to work something out.',
    ]);
  });
});

/** A task of a kind, for dividing; the family is its own so that any division is possible. */
function task(type: string, n: number): Task {
  return TaskSchema.parse({
    id: `${type}-${n}`,
    type,
    family: `${type}-${n}`,
    prompt: `Request ${type} ${n}`,
    expected: { kind: 'answer', value: n, compare: { mode: 'exact' } },
  });
}

const FORTY = [
  ...Array.from({ length: 24 }, (_, n) => task('a', n)),
  ...Array.from({ length: 16 }, (_, n) => task('b', n)),
];

function sets(list: readonly Task[], config: SplitConfig): TaskSplits {
  return {
    calibration: list.slice(0, config.calibration),
    train: list.slice(config.calibration, config.calibration + config.train),
    dev: list.slice(
      config.calibration + config.train,
      config.calibration + config.train + config.dev,
    ),
    test: list.slice(list.length - config.test),
  };
}

describe('dividing the tasks of a job', () => {
  it('uses the seed the tasks were made with when no set can be passed by a copy', () => {
    const seeds: number[] = [];
    const division = divide(
      FORTY,
      500,
      (list, config) => {
        seeds.push(config.seed);
        return sets(list, config);
      },
      () => [],
    );
    expect(seeds).toEqual([500]);
    expect(division).toMatchObject({ kind: 'divided', seed: 500 });
    expect(division.kind === 'divided' && division.tasks).toHaveLength(40);
  });

  it('divides them again with the next seed when a set could be passed by a copy', () => {
    const seeds: number[] = [];
    const division = divide(
      FORTY,
      500,
      (list, config) => {
        seeds.push(config.seed);
        return sets(list, config);
      },
      () => (seeds.length < 3 ? ['A copy would pass.'] : []),
    );
    expect(seeds).toEqual([500, 501, 502]);
    expect(division).toMatchObject({ kind: 'divided', seed: 502 });
  });

  it('refuses them, with the reasons of the first division, when no seed makes them safe', () => {
    const seeds: number[] = [];
    const division = divide(
      FORTY,
      500,
      (list, config) => {
        seeds.push(config.seed);
        return sets(list, config);
      },
      () => [`A copy would pass (${seeds.length}).`],
    );
    expect(seeds).toHaveLength(DIVISION_ATTEMPTS);
    expect(division).toEqual({
      kind: 'unsafe',
      problems: [
        'A copy would pass (1).',
        `Architect divided the tasks ${DIVISION_ATTEMPTS} ways, and in each the final test or the check tasks could be passed by copying.`,
      ],
    });
  });

  it('keeps its seeds inside the range tasks are chosen with', () => {
    const seeds: number[] = [];
    divide(
      FORTY,
      2_147_483_646,
      (list, config) => {
        seeds.push(config.seed);
        return sets(list, config);
      },
      () => ['A copy would pass.'],
    );
    expect(seeds.slice(0, 3)).toEqual([2_147_483_646, 0, 1]);
  });

  it('gives up the last task of the largest kind when they cannot be divided, as it always did', () => {
    const division = divide(
      FORTY,
      500,
      (list, config) => {
        if (list.length > 38) throw new SplitError('Too many families for the sets.');
        return sets(list, config);
      },
      () => [],
    );
    expect(division.kind).toBe('divided');
    if (division.kind !== 'divided') return;
    expect(division.tasks).toHaveLength(38);
    expect(division.tasks.filter((item) => item.type === 'a')).toHaveLength(22);
    expect(division.tasks.filter((item) => item.type === 'b')).toHaveLength(16);
  });

  it('skips a seed that cannot divide them once another has, and does not give a task up for it', () => {
    let calls = 0;
    const division = divide(
      FORTY,
      500,
      (list, config) => {
        calls += 1;
        if (calls === 2) throw new SplitError('This seed cannot.');
        return sets(list, config);
      },
      () => (calls < 3 ? ['A copy would pass.'] : []),
    );
    expect(division).toMatchObject({ kind: 'divided', seed: 502 });
    expect(division.kind === 'divided' && division.tasks).toHaveLength(40);
  });

  it('says there are too few when fewer than thirty are left to divide', () => {
    expect(
      divide(
        FORTY.slice(0, 29),
        500,
        (list, config) => sets(list, config),
        () => [],
      ),
    ).toEqual({ kind: 'too_few' });
  });

  it('is not given a division it cannot make, and says so', () => {
    expect(
      divide(
        FORTY,
        500,
        () => {
          throw new SplitError('Never.');
        },
        () => [],
      ),
    ).toEqual({ kind: 'too_few' });
  });

  it("lets an error that is not the splitter's through", () => {
    expect(() =>
      divide(
        FORTY,
        500,
        () => {
          throw new Error('Out of memory.');
        },
        () => [],
      ),
    ).toThrow('Out of memory.');
  });

  it('has its sizes from the number of tasks, as a job is divided', () => {
    const sizes: SplitConfig[] = [];
    divide(
      FORTY,
      500,
      (list, config) => {
        sizes.push(config);
        return sets(list, config);
      },
      () => [],
    );
    expect(sizes[0]).toEqual({ seed: 500, ...splitSizes(40) });
  });
});

describe('drafting a job whose final test a copy could pass', () => {
  let world: DraftingWorld;

  beforeEach(() => {
    world = draftingWorld();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    world.cleanup();
  });

  function attachBike(): string[] {
    return [
      world.attach('customers.csv', bike.customersCsv),
      world.attach('tickets.csv', bike.ticketsCsv),
      world.attach('policy.md', POLICY),
    ];
  }

  /** The draft: the near-copy rule beside a lookup, asked to be right in 65% of the final test. */
  function nearCopy() {
    const reply = bikeDraft([
      costType({
        steps: [
          step('parts', 'col', { column: 'parts_cost', from: 'row' }),
          step('five', 'num', { value: '5' }),
          step('more', 'add', { args: ['parts', 'five'] }),
          step('is_member', 'equals', { column: 'member', from: 'lookup', value: 'yes' }),
          step('pick', 'if', { args: ['is_member', 'more', 'parts'] }),
          step('total', 'round', { value: '0.01', mode: 'half_up', args: ['pick'] }),
        ],
      }),
      CONTACT_TYPE,
    ]);
    world.mentor.script = () => ({ ...reply, job: { ...reply.job, passRate: 0.65 } });
  }

  /** What the splitter makes of the tasks, but with every copy of the rule put into the final test. */
  function skewed(real: TaskSplits): TaskSplits {
    const cost = [...real.test, ...real.dev, ...real.train, ...real.calibration].filter(
      (item) => item.type === 'cost',
    );
    const room = real.test.filter((item) => item.type === 'cost').length;
    const intoTest = cost.filter(isCopy).slice(0, room);
    const left = cost.filter((item) => !intoTest.includes(item));
    const other = (list: Task[]): Task[] => list.filter((item) => item.type !== 'cost');
    return {
      calibration: other(real.calibration),
      train: [...other(real.train), ...left],
      dev: other(real.dev),
      test: [...other(real.test), ...intoTest],
    };
  }

  const shareOf = (list: readonly Task[]): number => {
    const mine = list.filter((item) => item.type === 'cost');
    return mine.filter(isCopy).length / mine.length;
  };

  it('is divided again, and the final test it keeps is one a copy could not pass', async () => {
    nearCopy();
    const real = world.deps.runtime.splitTasks.bind(world.deps.runtime);
    let calls = 0;
    vi.spyOn(world.deps.runtime, 'splitTasks').mockImplementation((tasks, config) => {
      const divided = real(tasks, config);
      calls += 1;
      return calls === 1 ? skewed(divided) : divided;
    });
    const turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const job = turn.draft;
    if (job === undefined) throw new Error(turn.message);

    // The first division was a copy's, so the job divides its tasks with another seed.
    const record = JSON.parse(readFileSync(world.paths.draftingFile(job.id), 'utf8')) as {
      seed: number;
    };
    expect(job.splits.seed).not.toBe(record.seed);
    // The final test that was sealed, and the check tasks, are what the guard was told they are.
    const sealed = readFileSync(join(world.dataDir, 'vault', job.id, 'test.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Task);
    expect(sealed.filter((item) => item.type === 'cost').length).toBeGreaterThan(5);
    expect(shareOf(sealed)).toBeLessThan(0.65);
    expect(shareOf(await world.jobs.tasks(job.id, 'dev'))).toBeLessThan(0.65);
  });

  it('is refused, with the reason, when every way of dividing it leaves a copy that passes', async () => {
    nearCopy();
    const real = world.deps.runtime.splitTasks.bind(world.deps.runtime);
    vi.spyOn(world.deps.runtime, 'splitTasks').mockImplementation((tasks, config) =>
      skewed(real(tasks, config)),
    );
    await expect(world.drafting.start('A repair desk', attachBike(), TEACHER)).rejects.toThrow(
      /Task type "cost" \(Ticket totals\): Of the \d+ final-test tasks Architect set aside, \d+ \(100%\) have the value of parts_cost for their answer/,
    );
    // The teacher was told, once, and could not change what the records hold.
    expect(world.mentor.requests).toHaveLength(2);
    const told = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(told).toContain('would pass the final test without working anything out');
    expect(told).toContain(`Architect divided the tasks ${DIVISION_ATTEMPTS} ways`);
    expect(world.store.jobs.list()).toEqual([]);
    expect(world.vault.isSealed('repair-desk')).toBe(false);
  });

  it('is divided with the seed it was made with when no copy could pass, as it always was', async () => {
    world.mentor.script = () => bikeDraft();
    const turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const job = turn.draft;
    if (job === undefined) throw new Error(turn.message);
    const record = JSON.parse(readFileSync(world.paths.draftingFile(job.id), 'utf8')) as {
      seed: number;
    };
    expect(job.splits.seed).toBe(record.seed);
  });
});
