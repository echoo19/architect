import { TaskSchema, type RuleNode, type TaskSpec } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  allocate,
  generateTasks,
  limitRepeats,
  MAX_PER_FAMILY,
  MAX_SAME_ANSWER,
  MAX_TASKS,
  MIN_PER_TYPE,
  seedFrom,
  spread,
  splitSizes,
  trainable,
  type TypeInput,
} from '../src/drafting/generate';
import { describeAttached, shownRowsOf, type Attached } from '../src/drafting/files';
import { readTable } from '../src/drafting/table';
import type { Candidate } from '../src/drafting/templates/common';
import { splitTasks } from '../src/splits/split';
import { seededRandom } from '../src/splits/random';
import { shopData } from './support/drafting-data';
import { bikeRule, bikeShop, bikeTables, billedHours, col, num } from './support/rule-data';

const data = shopData('generate', 400, 150);
const tables = new Map([
  ['orders.csv', readTable('orders.csv', data.ordersCsv)],
  ['customers.csv', readTable('customers.csv', data.customersCsv)],
]);

const emails: TypeInput = {
  id: 'email',
  label: 'Emails',
  description: 'Look up a customer email.',
  spec: {
    template: 'lookup',
    table: 'customers.csv',
    keyColumn: 'customer_id',
    columns: ['email'],
    request: 'What is the email of customer {key}?',
  },
};

const pending: TypeInput = {
  id: 'pending',
  label: 'Pending orders',
  description: 'List the pending orders of a customer.',
  spec: {
    template: 'filtered_list',
    table: 'orders.csv',
    keyColumn: 'order_id',
    filters: [
      { column: 'status', op: 'equals', value: 'Pending', varies: false },
      { column: 'customer_id', op: 'equals', varies: true },
    ],
    request: 'Which orders of customer {customer_id} are still pending?',
  },
};

const totals: TypeInput = {
  id: 'totals',
  label: 'Region totals',
  description: 'Add up the orders of a region.',
  spec: {
    template: 'group_total',
    table: 'orders.csv',
    groupColumn: 'region',
    measure: 'sum',
    valueColumn: 'amount',
    dateColumn: 'order_date',
    unit: 'as_written',
    request: 'What is the total of orders in the {group} region from {from} to {to}?',
  },
};

function candidate(family: string, answerKey: string, n: number): Candidate {
  return {
    family,
    identity: `question ${n}`,
    prompt: `Request ${n}`,
    expected: { kind: 'answer', value: n, compare: { mode: 'exact' } },
    answerKey,
    meta: {},
  };
}

describe('sharing a quota among kinds of task', () => {
  it('gives each kind an equal share and passes on what a small one cannot use', () => {
    expect(allocate([200, 200, 200], 120)).toEqual([40, 40, 40]);
    expect(allocate([12, 200, 200], 120)).toEqual([12, 54, 54]);
    expect(allocate([5, 7], 120)).toEqual([5, 7]);
    expect(allocate([200], 120)).toEqual([120]);
    expect(allocate([100, 100, 100], 100)).toEqual([34, 33, 33]);
    expect(allocate([], 120)).toEqual([]);
  });
});

describe('choosing among the requests a table supports', () => {
  it('lets no answer repeat more than three times, and no family more than three', () => {
    const many = [
      ...Array.from({ length: 10 }, (_, i) => candidate(`f${i}`, '"same"', i)),
      ...Array.from({ length: 10 }, (_, i) => candidate('one', `"different ${i}"`, 100 + i)),
      ...Array.from({ length: 5 }, (_, i) => candidate(`g${i}`, '[]', 200 + i)),
    ];
    const kept = limitRepeats(many, seededRandom('limit'));
    expect(kept.filter((item) => item.answerKey === '"same"')).toHaveLength(MAX_SAME_ANSWER);
    expect(kept.filter((item) => item.family === 'one')).toHaveLength(MAX_PER_FAMILY);
    expect(kept.filter((item) => item.answerKey === '[]')).toHaveLength(2);
  });

  it('takes one request from each family before a second from any, in a fixed order', () => {
    const items = [
      candidate('a', 'a1', 1),
      candidate('a', 'a2', 2),
      candidate('b', 'b1', 3),
      candidate('b', 'b2', 4),
      candidate('c', 'c1', 5),
    ];
    expect(spread(items, 4).map((item) => item.prompt)).toEqual([
      'Request 1',
      'Request 3',
      'Request 5',
      'Request 2',
    ]);
    expect(spread(items, 10)).toHaveLength(5);
    expect(spread(items, 0)).toEqual([]);
  });
});

describe('making the tasks of a job', () => {
  it('makes valid tasks of each kind, up to the quota, with a family each', () => {
    const made = generateTasks([emails, pending, totals], tables, 7);
    expect(made.rejected).toEqual([]);
    expect(made.thin).toEqual([]);
    expect(made.tasks).toHaveLength(MAX_TASKS);
    const chosen = Object.fromEntries(made.types.map((type) => [type.id, type.chosen]));
    // Region totals can give only as many different requests as four regions have date ranges.
    expect(chosen['totals']).toBeLessThan(40);
    expect(chosen['totals']).toBeGreaterThanOrEqual(12);
    expect(Math.abs((chosen['email'] ?? 0) - (chosen['pending'] ?? 0))).toBeLessThanOrEqual(1);
    expect(chosen['email']).toBeGreaterThan(40);
    for (const task of made.tasks) {
      expect(TaskSchema.safeParse(task).success).toBe(true);
      expect(task.family).not.toBe('');
    }
    expect(new Set(made.tasks.map((task) => task.id)).size).toBe(made.tasks.length);
    expect(made.tasks[0]?.id).toBe('email-001');
    expect(made.types[0]?.rule).toBe('Look up email by customer_id, from customers.csv');
  });

  it('repeats no answer more than three times within a kind', () => {
    const made = generateTasks([pending, totals], tables, 7);
    for (const type of ['pending', 'totals']) {
      const answers = new Map<string, number>();
      for (const task of made.tasks.filter((item) => item.type === type)) {
        const key = JSON.stringify(task.expected);
        answers.set(key, (answers.get(key) ?? 0) + 1);
      }
      expect(Math.max(...answers.values())).toBeLessThanOrEqual(MAX_SAME_ANSWER);
    }
  });

  it('makes the same tasks from the same files, answers and seed, and others from another seed', () => {
    const first = generateTasks([emails, totals], tables, 7);
    const again = generateTasks([emails, totals], tables, 7);
    const other = generateTasks([emails, totals], tables, 8);
    expect(again.tasks).toEqual(first.tasks);
    expect(other.tasks).not.toEqual(first.tasks);
  });

  it('keeps one kind of task unchanged when another is added', () => {
    const alone = generateTasks([emails], tables, 7);
    const together = generateTasks([emails, totals], tables, 7);
    const sameEmails = together.tasks.filter((task) => task.type === 'email');
    expect(alone.tasks.slice(0, sameEmails.length)).toEqual(sameEmails);
  });

  it('rejects a kind with a reason when its requests would all be one answer', () => {
    const constant: TypeInput = {
      id: 'constant',
      label: 'Constant',
      description: 'Every answer is the same.',
      spec: {
        template: 'lookup',
        table: 'customers.csv',
        keyColumn: 'customer_id',
        columns: ['region'],
        request: 'Region of {key}?',
      },
    };
    const same = readTable(
      'customers.csv',
      ['customer_id,region', ...Array.from({ length: 30 }, (_, i) => `C-${i},North`)].join('\n'),
    );
    const made = generateTasks([constant], new Map([['customers.csv', same]]), 1);
    expect(made.tasks).toEqual([]);
    // The teacher is told the answers are all one, and the person which: it is a value of rows.
    const problem =
      'Every request would have the same answer, so an agent could pass without reading the data.';
    expect(made.rejected).toEqual([
      {
        id: 'constant',
        label: 'Constant',
        problems: [problem],
        inFull: new Map([
          [
            problem,
            'Every request would have the same answer, {"region":"North"}, so an agent could pass without reading the data.',
          ],
        ]),
      },
    ]);
  });

  it('rejects a kind that names a table or a column that is not there', () => {
    const noTable: TypeInput = {
      ...emails,
      spec: { ...emails.spec, table: 'people.csv' } as TaskSpec,
    };
    const noColumn: TypeInput = {
      ...totals,
      id: 'bad',
      spec: { ...totals.spec, groupColumn: 'area' } as TaskSpec,
    };
    const made = generateTasks([noTable, noColumn, emails], tables, 1);
    expect(made.rejected.map((item) => [item.id, item.problems[0]])).toEqual([
      ['email', 'There is no table called people.csv.'],
      [
        'bad',
        'The grouping column "area" isn\'t a column of orders.csv. Its columns are order_id, customer_id, region, status, amount, order_date, shipped_on.',
      ],
    ]);
    expect(made.types.map((type) => type.id)).toEqual(['email']);
  });

  it('sets aside a kind whose table supports too few requests', () => {
    const small = readTable(
      'customers.csv',
      [
        'customer_id,email',
        ...Array.from({ length: MIN_PER_TYPE - 1 }, (_, i) => `C-${i},c${i}@example.com`),
      ].join('\n'),
    );
    const made = generateTasks([emails], new Map([['customers.csv', small]]), 1);
    expect(made.tasks).toEqual([]);
    expect(made.thin).toEqual([{ id: 'email', label: 'Emails', available: MIN_PER_TYPE - 1 }]);
  });

  it('shares the quota with a kind that can give only some', () => {
    const few = readTable(
      'customers.csv',
      [
        'customer_id,email',
        ...Array.from({ length: 15 }, (_, i) => `C-${i},c${i}@example.com`),
      ].join('\n'),
    );
    const made = generateTasks(
      [emails, pending, totals],
      new Map([...tables, ['customers.csv', few]]),
      7,
    );
    const chosen = Object.fromEntries(made.types.map((type) => [type.id, type.chosen]));
    expect(chosen['email']).toBe(15);
    expect(chosen['pending'] ?? 0).toBeGreaterThan(40);
    expect(made.tasks).toHaveLength(MAX_TASKS);
  });

  it('can be split by the job rules, with every family in one set and every type in the final test', () => {
    const made = generateTasks([emails, pending, totals], tables, 7);
    const sizes = splitSizes(made.tasks.length);
    const splits = splitTasks(made.tasks, { seed: 7, ...sizes });
    expect(splits.test).toHaveLength(sizes.test);
    expect(splits.unused).toEqual([]);
    const home = new Map<string, string>();
    for (const name of ['calibration', 'train', 'dev', 'test'] as const) {
      for (const task of splits[name]) {
        const seen = home.get(task.family);
        expect(seen === undefined || seen === name, task.family).toBe(true);
        home.set(task.family, name);
      }
    }
    for (const type of ['email', 'pending', 'totals']) {
      expect(splits.test.some((task) => task.type === type)).toBe(true);
      expect(splits.train.some((task) => task.type === type)).toBe(true);
    }
  });
});

/** A list of orders for each pair of a customer and a region, with the two named in this order. */
function ordersBy(id: string, first: string, second: string, request: string): TypeInput {
  return {
    id,
    label: `Orders of ${first} and ${second} (${id})`,
    description: 'List the orders of a customer in a region.',
    spec: {
      template: 'filtered_list',
      table: 'orders.csv',
      keyColumn: 'order_id',
      filters: [
        { column: first, op: 'equals', varies: true },
        { column: second, op: 'equals', varies: true },
      ],
      request,
    },
  };
}

/** What a task asks, apart from how its type worded it. */
const askedOf = (task: { meta?: Record<string, unknown> }): string =>
  JSON.stringify([task.meta?.['customer_id'], task.meta?.['region']]);

describe('asking one question once', () => {
  // Reordering the two conditions of a list makes the same questions with the same answers, which
  // used to be given different families: one could be a practice task and the other a final test.
  const crowd = readTable('orders.csv', shopData('twice', 200, 40).ordersCsv);
  const small = new Map([['orders.csv', crowd]]);
  const forward = ordersBy(
    'forward',
    'customer_id',
    'region',
    'Which orders did customer {customer_id} place in the {region} region?',
  );

  it('leaves out a kind of task that asks what an earlier one asks with its conditions reordered', () => {
    const backward = ordersBy(
      'backward',
      'region',
      'customer_id',
      'Which orders did customer {customer_id} place in the {region} region?',
    );
    const made = generateTasks([forward, backward], small, 5);
    expect(made.types.map((type) => type.id)).toEqual(['forward']);
    expect(made.rejected).toHaveLength(1);
    expect(made.rejected[0]?.id).toBe('backward');
    expect(made.rejected[0]?.problems[0]).toContain(
      `asks what "${forward.label}" already asks, in other words`,
    );
    const prompts = made.tasks.map((task) => task.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('knows the same question when it is worded differently', () => {
    const reworded = ordersBy(
      'reworded',
      'region',
      'customer_id',
      'In the {region} region, list the orders of {customer_id}.',
    );
    const made = generateTasks([forward, reworded], small, 5);
    expect(made.rejected.map((item) => item.id)).toEqual(['reworded']);
    expect(made.tasks.every((task) => task.type === 'forward')).toBe(true);
  });

  it('never lets the same question land in the practice tasks and in the final test', () => {
    const swapped = ordersBy(
      'swapped',
      'region',
      'customer_id',
      'Which orders did customer {customer_id} place in the {region} region?',
    );
    // The reproduction: two kinds of list over the same two conditions, ordered each way, beside
    // a lookup and a total, split as a job is. Before, some final-test questions were also
    // practice tasks, since the two kinds gave the same question different families.
    const made = generateTasks([forward, swapped, emails, totals], tables, 3);
    const lists = (names: readonly ('calibration' | 'train' | 'dev' | 'test')[]) =>
      names.flatMap((name) =>
        splits[name]
          .filter((task) => task.type === 'forward' || task.type === 'swapped')
          .map((task) => askedOf(task)),
      );
    const sizes = splitSizes(made.tasks.length);
    const splits = splitTasks(made.tasks, { seed: 3, ...sizes });
    const visible = new Set(lists(['calibration', 'train', 'dev']));
    const heldOut = lists(['test']);
    expect(heldOut.length).toBeGreaterThan(0);
    expect(heldOut.filter((question) => visible.has(question))).toEqual([]);
    expect(made.tasks.filter((task) => task.type === 'swapped')).toEqual([]);
  });

  it('knows a question asked with a value fixed from the same question with the value taken in turn', () => {
    const northOnly: TypeInput = {
      id: 'north',
      label: 'North orders',
      description: 'List the orders of a customer in the North region.',
      spec: {
        template: 'filtered_list',
        table: 'orders.csv',
        keyColumn: 'order_id',
        filters: [
          { column: 'region', op: 'equals', value: 'North', varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
        request: 'Which orders did customer {customer_id} place in the North region?',
      },
    };
    const made = generateTasks([forward, northOnly], small, 5);
    const asked = made.tasks
      .filter((task) => task.type === 'forward')
      .filter((task) => task.meta?.['region'] === 'North')
      .map((task) => task.meta?.['customer_id']);
    const alsoAsked = made.tasks
      .filter((task) => task.type === 'north')
      .map((task) => task.meta?.['customer_id']);
    expect(alsoAsked.filter((customer) => asked.includes(customer))).toEqual([]);
  });
});

const bike = bikeShop({ offGrid: true });
const shop = bikeTables(bike);

/**
 * What a ticket costs: the labor at 65 an hour in half hours and the parts, in the order given,
 * asked in the words given.
 */
function cost(
  id: string,
  order: 'labor first' | 'parts first',
  family?: string,
  request?: string,
): TypeInput {
  const labor: RuleNode = { op: 'mul', args: [billedHours, num('65')] };
  const args = order === 'labor first' ? [labor, col('parts_cost')] : [col('parts_cost'), labor];
  // The member discount is left out, so the rule reads no other table.
  const { lookup: _lookup, ...rule } = bikeRule({
    categories: [],
    expression: { op: 'round', increment: '0.01', mode: 'half_up', arg: { op: 'add', args } },
    ...(family === undefined ? {} : { familyColumn: family }),
    ...(request === undefined ? {} : { request }),
  });
  return {
    id,
    label: `Ticket totals (${id})`,
    description: 'Work out what a repair ticket costs.',
    spec: rule,
  };
}

describe('asking one question once, whichever rule is behind it', () => {
  // The reproduction: the same sum written in the other order, asking the same request, and told
  // apart by a family column, which made the two rules' questions different to Architect and the
  // same to the agent. Both could then be split apart, one as practice and one as the final test.
  it('leaves out a rule that asks the same request as an earlier one in another order', () => {
    const first = cost('first', 'labor first');
    const second = cost('second', 'parts first', 'customer_id');
    const made = generateTasks([first, second], shop, 11);
    expect(made.types.map((type) => type.id)).toEqual(['first']);
    expect(made.rejected.map((type) => type.id)).toEqual(['second']);
    expect(made.rejected[0]?.problems[0]).toContain(
      `asks what "${first.label}" already asks, in the same words`,
    );
    const prompts = made.tasks.map((task) => task.prompt);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it('never lets a question come up as a practice task and as a final-test task', () => {
    const made = generateTasks(
      [cost('first', 'labor first'), cost('second', 'parts first', 'customer_id'), emails],
      new Map([...shop, ...tables]),
      13,
    );
    const sizes = splitSizes(made.tasks.length);
    const splits = splitTasks(made.tasks, { seed: 13, ...sizes });
    const seenAs = new Map<string, string>();
    for (const name of ['calibration', 'train', 'dev', 'test'] as const) {
      for (const task of splits[name]) {
        const where = seenAs.get(task.prompt);
        expect(where === undefined || where === name, task.prompt).toBe(true);
        seenAs.set(task.prompt, name);
      }
    }
  });

  it('knows the same words put by another kind of task, which asks something else of the row', () => {
    const lookup: TypeInput = {
      id: 'parts',
      label: 'Parts of a ticket',
      description: 'Look up what parts a ticket used.',
      spec: {
        template: 'lookup',
        table: 'tickets.csv',
        keyColumn: 'ticket_id',
        columns: ['parts_cost'],
        request: 'What does ticket {key} cost the customer?',
      },
    };
    const made = generateTasks([cost('first', 'labor first'), lookup], shop, 11);
    expect(made.types.map((type) => type.id)).toEqual(['first']);
    expect(made.rejected.map((type) => type.id)).toEqual(['parts']);
    expect(made.rejected[0]?.problems[0]).toContain('in the same words');
  });
});

describe('asking the same words of two tables', () => {
  /** The ids of a file and an amount of each id, as the file writes them. */
  const records = (ids: readonly string[], amount: (index: number) => number): string =>
    `id,amount\n${ids.map((id, index) => `${id},${amount(index).toFixed(2)}`).join('\n')}\n`;
  const ids = (prefix: string, count: number): string[] =>
    Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}`);
  const tablesOf = (tickets: readonly string[], archive: readonly string[]) =>
    new Map([
      [
        'tickets.csv',
        readTable(
          'tickets.csv',
          records(tickets, (index) => 100 + index * 2.5),
        ),
      ],
      [
        'archive.csv',
        readTable(
          'archive.csv',
          records(archive, (index) => 7000 + index * 3.1),
        ),
      ],
    ]);
  const amountIn = (
    table: string,
    request = 'What is the amount for record {key}?',
  ): TypeInput => ({
    id: table.replace('.csv', ''),
    label: `Amounts in ${table}`,
    description: 'Look up the amount of a record.',
    spec: { template: 'lookup', table, keyColumn: 'id', columns: ['amount'], request },
  });
  /** What an agent reads in each task, set against what it is to answer: one prompt, one answer. */
  const answersOf = (made: ReturnType<typeof generateTasks>): Map<string, Set<string>> => {
    const answers = new Map<string, Set<string>>();
    for (const task of made.tasks) {
      const prompt = task.prompt.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
      answers.set(prompt, (answers.get(prompt) ?? new Set()).add(JSON.stringify(task.expected)));
    }
    return answers;
  };
  const tasksOf = (made: ReturnType<typeof generateTasks>, type: string) =>
    made.tasks.filter((task) => task.type === type);

  it('sends the second kind back to say which table, when the same words and key have two answers', () => {
    // Record R-1 is in both files, with the answer of each: asked in the same words of both, an
    // agent is given one prompt and two right answers.
    const both = tablesOf(ids('R', 40), ids('R', 40));
    const made = generateTasks([amountIn('tickets.csv'), amountIn('archive.csv')], both, 5);
    expect(made.types.map((type) => type.id)).toEqual(['tickets']);
    expect(made.rejected.map((type) => type.id)).toEqual(['archive']);
    const told =
      '40 of its 40 requests read exactly like requests of "Amounts in tickets.csv", which asks about tickets.csv, so an agent could not tell which table to read.';
    const say = 'Say which table the request is about, for example "in archive.csv".';
    expect(made.rejected[0]?.problems).toEqual([`${told} ${say}`]);
    // The teacher is told no key; the person is shown one request that reads the same in both.
    expect(made.rejected[0]?.problems.join(' ')).not.toMatch(/R-\d/);
    expect(made.rejected[0]?.inFull.get(`${told} ${say}`)).toMatch(
      /^40 of its 40 requests .*to read\. One is "What is the amount for record R-\d+\?"\. Say which/,
    );
    // No prompt of the job has two answers, whichever file is asked first.
    for (const [prompt, answers] of answersOf(made)) expect(answers.size, prompt).toBe(1);
    const swapped = generateTasks([amountIn('archive.csv'), amountIn('tickets.csv')], both, 5);
    expect(swapped.types.map((type) => type.id)).toEqual(['archive']);
    expect(swapped.rejected.map((type) => type.id)).toEqual(['tickets']);
  });

  it('sends it back for a few requests too, since the words are the same for every key', () => {
    // Six of the archive's forty records are also in the tickets.
    const partly = tablesOf(ids('R', 40), [...ids('A', 34), ...ids('R', 6)]);
    const made = generateTasks([amountIn('tickets.csv'), amountIn('archive.csv')], partly, 5);
    expect(made.rejected.map((type) => type.id)).toEqual(['archive']);
    expect(made.rejected[0]?.problems[0]).toMatch(
      /^6 of its 40 requests read exactly like requests of "Amounts in tickets\.csv"/,
    );
    for (const [prompt, answers] of answersOf(made)) expect(answers.size, prompt).toBe(1);
  });

  it('keeps both when the two files have no id in common, since no request reads the same', () => {
    const apart = tablesOf(ids('R', 40), ids('A', 40));
    const made = generateTasks([amountIn('tickets.csv'), amountIn('archive.csv')], apart, 5);
    expect(made.rejected).toEqual([]);
    expect(made.types.map((type) => type.id)).toEqual(['tickets', 'archive']);
    for (const type of ['tickets', 'archive']) {
      expect(tasksOf(made, type).length, type).toBeGreaterThan(30);
    }
    for (const [prompt, answers] of answersOf(made)) expect(answers.size, prompt).toBe(1);
  });

  it('keeps both when the words name the table, though both files have the same ids', () => {
    const both = tablesOf(ids('R', 40), ids('R', 40));
    const made = generateTasks(
      [
        amountIn('tickets.csv', 'What is the amount for record {key} in tickets.csv?'),
        amountIn('archive.csv', 'What is the amount for record {key} in archive.csv?'),
      ],
      both,
      5,
    );
    expect(made.rejected).toEqual([]);
    expect(made.types.map((type) => type.id)).toEqual(['tickets', 'archive']);
    // Record R-1 is asked about in each, in words that say which file, with each file's answer.
    const first = (type: string) =>
      tasksOf(made, type).find((task) => task.meta?.['key'] === 'R-1');
    expect(first('tickets')?.prompt).toContain('in tickets.csv?');
    expect(first('archive')?.prompt).toContain('in archive.csv?');
    expect(first('tickets')?.expected).not.toEqual(first('archive')?.expected);
    for (const [prompt, answers] of answersOf(made)) expect(answers.size, prompt).toBe(1);
  });
});

describe('asking about a row once, whatever the words', () => {
  const status: TypeInput = {
    id: 'status',
    label: 'Ticket statuses',
    description: 'Look up the status of a ticket.',
    spec: {
      template: 'lookup',
      table: 'tickets.csv',
      keyColumn: 'ticket_id',
      columns: ['status'],
      request: 'What is the status of ticket {key}?',
    },
  };
  // The same sum in the other order, in other words, with another family column: one question to
  // an agent, which the identity and the words of a request can't tie to each other.
  const total = cost('total', 'labor first', undefined, 'What is the total for ticket {key}?');
  const price = cost('price', 'parts first', 'customer_id', 'How much does ticket {key} cost?');

  it('gives each row to one kind, so a twin in other words is never on the other side of the boundary', () => {
    const made = generateTasks([total, price, status], shop, 21);
    expect(made.rejected).toEqual([]);
    const keys = made.tasks.map((task) => task.meta?.['key']);
    expect(new Set(keys).size).toBe(keys.length);
    for (const id of ['total', 'price', 'status']) {
      const mine = made.tasks.filter((task) => task.type === id);
      expect(mine.length, id).toBeGreaterThanOrEqual(MIN_PER_TYPE);
    }
    expect(made.tasks.length).toBeLessThanOrEqual(MAX_TASKS);
    // The sets are not starved: divided as a job is, every kind is in the practice tasks and in
    // the final test, and no ticket is in two sets.
    const splits = splitTasks(made.tasks, { seed: 21, ...splitSizes(made.tasks.length) });
    for (const id of ['total', 'price', 'status']) {
      expect(
        splits.test.some((task) => task.type === id),
        id,
      ).toBe(true);
      expect(
        splits.train.some((task) => task.type === id),
        id,
      ).toBe(true);
    }
    const homeOf = new Map<string, string>();
    for (const name of ['calibration', 'train', 'dev', 'test'] as const) {
      for (const task of splits[name]) {
        const key = String(task.meta?.['key']);
        expect(homeOf.has(key), key).toBe(false);
        homeOf.set(key, name);
      }
    }
  });

  it('says what a kind lost to another when the table has fewer rows than the kinds ask for', () => {
    // Sixty tickets can't give three kinds the rows they each ask for.
    const few = generateTasks([total, price, status], bikeTables(bikeShop({ tickets: 60 })), 21);
    const keys = few.tasks.map((task) => task.meta?.['key']);
    expect(new Set(keys).size).toBe(keys.length);
    expect(few.tasks.length).toBeLessThanOrEqual(60);
    for (const id of ['total', 'price', 'status']) {
      expect(few.tasks.filter((task) => task.type === id).length, id).toBeGreaterThanOrEqual(
        MIN_PER_TYPE,
      );
    }
    const notes = few.types.flatMap((type) => type.notes).join('\n');
    expect(notes).toMatch(
      /\d+ requests? (was|were) left out of tickets\.csv: another kind of task asks about the same rows, and a row is asked about once/,
    );
  });

  it('is the same job each time it is made', () => {
    const again = (): string[] =>
      generateTasks([total, price, status], shop, 21).tasks.map((task) => task.id);
    expect(again()).toEqual(again());
  });

  it('takes no row from a kind that asks about another table, or from one that lists or adds up', () => {
    const made = generateTasks([emails, total, pending, totals], new Map([...shop, ...tables]), 21);
    const notes = made.types.flatMap((type) => type.notes).join('\n');
    expect(notes).not.toContain('another kind of task asks about the same rows');
    const orders = made.tasks.filter((task) => ['pending', 'totals'].includes(task.type));
    expect(orders.length).toBeGreaterThan(10);
  });
});

describe('leaving out what the teacher was shown', () => {
  it('asks nothing whose answer is a row the teacher was shown, and the rest as before', () => {
    const shown = new Map([['customers.csv', new Set([0, 1, 2, 3, 4])]]);
    const hidden = generateTasks([emails], tables, 7, { shown });
    const first = tables
      .get('customers.csv')
      ?.rows.slice(0, 5)
      .map((row) => row['customer_id']);
    expect(first).toHaveLength(5);
    const keys = hidden.tasks.map((task) => task.meta?.['key']);
    for (const key of first ?? []) expect(keys).not.toContain(key);
    expect(keys.length).toBeGreaterThan(30);
    expect(hidden.types[0]?.notes.join(' ')).toContain(
      '5 requests were left out of customers.csv: the teacher read the rows they are about while drafting',
    );
    // Showing no rows leaves every row to ask about.
    const everything = generateTasks([emails], tables, 7);
    expect(everything.tasks.map((task) => task.meta?.['key'])).toContain(first?.[0]);
  });

  it('leaves out a list only when every row it is worked out from was shown', () => {
    const orders = tables.get('orders.csv');
    if (orders === undefined) throw new Error('Expected the orders.');
    const rows = (customer: string): number[] =>
      orders.rows.flatMap((row, at) => (row['customer_id']?.trim() === customer ? [at] : []));
    const owners = data.orders.map((order) => order.customerId);
    const alone = owners.find((id) => owners.filter((other) => other === id).length === 1);
    const several = owners.find((id) => owners.filter((other) => other === id).length >= 2);
    expect(alone).toBeDefined();
    expect(several).toBeDefined();
    const shown = new Map([
      ['orders.csv', new Set([...rows(alone ?? ''), ...(rows(several ?? '').slice(0, 1) ?? [])])],
    ]);
    const made = generateTasks([pending], tables, 7, { shown });
    const asked = made.tasks.map((task) => task.meta?.['customer_id']);
    expect(asked).not.toContain(alone);
    expect(asked).toContain(several);
  });
});

describe('leaving out what the rows the teacher read decide', () => {
  // The teacher read the first five rows. A total or a list is left out when those rows alone
  // decide its answer, which they have all of; when a row it rests on was not shown, the answer is
  // still the teacher's to work out, and the request stays whether or not it read another row.
  const shown = (name: string): Map<string, Set<number>> =>
    new Map([[name, new Set([0, 1, 2, 3, 4])]]);

  it('leaves out a total whose counted rows were all shown, and keeps one with a row it was not', () => {
    // A has a row shown and one not; B is a group of one, shown; C has a shown row and a row with
    // no amount, which adds nothing; D has two rows, both shown.
    const sales = readTable(
      'sales.csv',
      [
        'team,amount',
        'A,10',
        'B,20',
        'C,5',
        'D,7',
        'D,8',
        'A,30',
        'C,',
        ...Array.from({ length: 40 }, (_, i) => `G${i},${100 + i * 3}\nG${i},${200 + i * 7}`),
      ].join('\n'),
    );
    const totalsBy: TypeInput = {
      id: 'team',
      label: 'Team totals',
      description: 'Add up the amounts of a team.',
      spec: {
        template: 'group_total',
        table: 'sales.csv',
        groupColumn: 'team',
        measure: 'sum',
        valueColumn: 'amount',
        unit: 'as_written',
        request: 'What is the total of the amounts of team {group}?',
      },
    };
    const everyone = generateTasks([totalsBy], new Map([['sales.csv', sales]]), 3);
    const asked = (made: typeof everyone) => made.tasks.map((task) => task.meta?.['group']);
    expect(asked(everyone)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']));

    const made = generateTasks([totalsBy], new Map([['sales.csv', sales]]), 3, {
      shown: shown('sales.csv'),
    });
    // B, C and D are what the first five rows come to; A also rests on a row the teacher did not read.
    expect(asked(made)).toContain('A');
    for (const group of ['B', 'C', 'D']) expect(asked(made), group).not.toContain(group);
    expect(made.types[0]?.notes.join(' ')).toContain('3 requests were left out of sales.csv');
    // The groups of two hidden rows are all asked.
    expect(asked(made)).toEqual(expect.arrayContaining(['G0', 'G17', 'G39']));
  });

  it('counts only the rows that give a value, so a count the shown rows decide is left out', () => {
    // A: one amount, shown, and a row with none that was not. B: three amounts, all shown, and a
    // row with none that was not. C: two amounts, one shown and one not.
    const given = [
      ...['A,10', 'B,5', 'B,6', 'B,7', 'C,9'],
      ...['A,', 'C,12', 'B,'],
      ...Array.from({ length: 30 }, (_, i) =>
        Array.from({ length: [1, 3, 4, 5, 6, 7][i % 6] ?? 1 }, (_, n) => `H${i},${n + 1}`).join(
          '\n',
        ),
      ),
    ];
    const book = readTable('book.csv', ['team,amount', ...given].join('\n'));
    const counted: TypeInput = {
      id: 'counted',
      label: 'Amounts given',
      description: 'Count the rows of a team that give an amount.',
      spec: {
        template: 'group_total',
        table: 'book.csv',
        groupColumn: 'team',
        measure: 'count',
        valueColumn: 'amount',
        unit: 'as_written',
        request: 'How many amounts were given for team {group}?',
      },
    };
    const made = generateTasks([counted], new Map([['book.csv', book]]), 4, {
      shown: shown('book.csv'),
    });
    const groups = made.tasks.map((task) => task.meta?.['group']);
    expect(groups).toContain('C');
    expect(groups.length).toBeGreaterThan(10);
    for (const group of ['A', 'B']) expect(groups, group).not.toContain(group);
  });

  it('asks no total within dates that the rows the teacher read decide', () => {
    // A has two rows in January, shown, and one in March, not. B has three rows, all shown.
    const rows = [
      'team,amount,placed',
      ...[
        'A,10,2026-01-03',
        'A,20,2026-01-05',
        'B,5,2026-01-10',
        'B,6,2026-02-20',
        'B,7,2026-03-30',
      ],
      'A,40,2026-03-15',
      ...Array.from({ length: 40 }, (_, i) =>
        [
          `H${i},${10 + i},2026-01-${String((i % 27) + 1).padStart(2, '0')}`,
          `H${i},${60 + 2 * i},2026-02-${String(((i + 7) % 27) + 1).padStart(2, '0')}`,
          `H${i},${200 + 3 * i},2026-03-${String(((i + 13) % 27) + 1).padStart(2, '0')}`,
        ].join('\n'),
      ),
    ];
    const book = readTable('book.csv', rows.join('\n'));
    const ranged: TypeInput = {
      id: 'ranged',
      label: 'Team totals in a range',
      description: 'Add up the amounts of a team between two dates.',
      spec: {
        template: 'group_total',
        table: 'book.csv',
        groupColumn: 'team',
        measure: 'sum',
        valueColumn: 'amount',
        dateColumn: 'placed',
        unit: 'as_written',
        request: 'What is the total of team {group} from {from} to {to}?',
      },
    };
    const read = new Set([0, 1, 2, 3, 4]);
    /** The rows a total adds up, from the group and the days it names. */
    const addedUp = (task: { meta?: Record<string, unknown> }): number[] =>
      book.rows.flatMap((row, at) => {
        const day = row['placed'] ?? '';
        return row['team'] === task.meta?.['group'] &&
          day >= String(task.meta?.['from']) &&
          day <= String(task.meta?.['to']) &&
          (row['amount'] ?? '') !== ''
          ? [at]
          : [];
      });
    const tablesOf = new Map([['book.csv', book]]);
    // Asked of every row, some totals rest on the rows read alone, so the test has something to leave out.
    const everyone = generateTasks([ranged], tablesOf, 6);
    expect(everyone.tasks.filter((task) => addedUp(task).every((at) => read.has(at)))).not.toEqual(
      [],
    );
    const made = generateTasks([ranged], tablesOf, 6, { shown: new Map([['book.csv', read]]) });
    expect(made.tasks.length).toBeGreaterThan(40);
    for (const task of made.tasks) {
      expect(
        addedUp(task).some((at) => !read.has(at)),
        String(task.prompt),
      ).toBe(true);
    }
  });

  it('leaves out a list whose rows were all shown, the ones that make it or, for an empty list, all it looked at', () => {
    // Pending orders of each customer. A: its one pending order was shown, and its other order was
    // not. B: one pending order shown and one not. C: one shown, and one of another status not.
    // D: no pending order, and one of its two rows not shown.
    const orders = readTable(
      'orders.csv',
      [
        'order_id,customer,status',
        'O-1,A,Pending',
        'O-2,B,Pending',
        'O-3,B,Shipped',
        'O-4,C,Pending',
        'O-5,D,Shipped',
        'O-6,A,Shipped',
        'O-7,B,Pending',
        'O-8,C,Cancelled',
        'O-9,D,Shipped',
        ...Array.from({ length: 40 }, (_, i) => `P-${i},E${i},Pending`),
      ].join('\n'),
    );
    const pendingBy: TypeInput = {
      id: 'pending',
      label: 'Pending orders',
      description: 'List the pending orders of a customer.',
      spec: {
        template: 'filtered_list',
        table: 'orders.csv',
        keyColumn: 'order_id',
        filters: [
          { column: 'status', op: 'equals', value: 'Pending', varies: false },
          { column: 'customer', op: 'equals', varies: true },
        ],
        request: 'Which orders of customer {customer} are still pending?',
      },
    };
    const tablesOf = new Map([['orders.csv', orders]]);
    const everyone = generateTasks([pendingBy], tablesOf, 3);
    const asked = (made: typeof everyone) => made.tasks.map((task) => task.meta?.['customer']);
    expect(asked(everyone)).toEqual(expect.arrayContaining(['A', 'B', 'C', 'D']));

    const made = generateTasks([pendingBy], tablesOf, 3, { shown: shown('orders.csv') });
    // A and C: the pending orders are all read, whatever else those customers ordered.
    for (const customer of ['A', 'C']) expect(asked(made), customer).not.toContain(customer);
    // B has a pending order not shown. D has none, which its row not shown could have changed.
    for (const customer of ['B', 'D']) expect(asked(made), customer).toContain(customer);
    expect(asked(made)).toEqual(expect.arrayContaining(['E0', 'E39']));
  });
});

describe('asking about rows the teacher has not read', () => {
  // Ids and amounts that each name one row. The teacher is told the first rows and, of the rest,
  // only what several rows share, so what it reads of a row is something no task is about.
  const csv = `id,amount\n${Array.from(
    { length: 120 },
    (_, index) => `REC-${2000 + index},${(50 + index * 3.75).toFixed(2)}`,
  ).join('\n')}\n`;
  const table = readTable('records.csv', csv);
  const attached: Attached = {
    files: [{ name: 'records.csv', kind: 'table', bytes: Buffer.from(csv), table }],
    tasks: null,
  };
  const lookup: TypeInput = {
    id: 'amount',
    label: 'Amounts',
    description: 'Look up the amount of a record.',
    spec: {
      template: 'lookup',
      table: 'records.csv',
      keyColumn: 'id',
      columns: ['amount'],
      request: 'What is the amount of record {key}?',
    },
  };

  it('makes no request about a row any value of which the teacher was told', () => {
    const told = describeAttached(attached);
    const made = generateTasks([lookup], new Map([['records.csv', table]]), 9, {
      shown: shownRowsOf(attached),
    });
    expect(made.tasks.length).toBeGreaterThan(100);
    for (const task of made.tasks) {
      expect(told, String(task.meta?.['key'])).not.toContain(String(task.meta?.['key']));
    }
    // The first rows, which the teacher reads, have no task either.
    const keys = made.tasks.map((task) => task.meta?.['key']);
    for (const index of [0, 1, 2, 3, 4]) expect(keys).not.toContain(`REC-${2000 + index}`);
  });
});

describe('sizing the sets', () => {
  it('gives a third to the final test, a quarter to the check tasks and a twelfth to calibration', () => {
    expect(splitSizes(120)).toEqual({ calibration: 10, train: 40, dev: 30, test: 40 });
    expect(splitSizes(30)).toEqual({ calibration: 3, train: 9, dev: 8, test: 10 });
    expect(splitSizes(33)).toEqual({ calibration: 3, train: 11, dev: 8, test: 11 });
    for (let total = 30; total <= 120; total += 1) {
      const sizes = splitSizes(total);
      expect(sizes.calibration + sizes.train + sizes.dev + sizes.test).toBe(total);
      expect(sizes.train).toBeGreaterThanOrEqual(9);
      expect(sizes.dev).toBeGreaterThanOrEqual(8);
      expect(sizes.test).toBeGreaterThanOrEqual(8);
    }
  });

  it('calls thirty tasks enough to train on, and fewer not', () => {
    expect(trainable(29)).toBe(false);
    expect(trainable(30)).toBe(true);
    expect(trainable(120)).toBe(true);
    expect(trainable(0)).toBe(false);
  });

  it('makes a seed from what the job is made of', () => {
    expect(seedFrom(['a', 'b'])).toBe(seedFrom(['a', 'b']));
    expect(seedFrom(['a', 'b'])).not.toBe(seedFrom(['ab']));
    expect(seedFrom(['a', 'b'])).not.toBe(seedFrom(['a', 'c']));
    expect(Number.isInteger(seedFrom(['x']))).toBe(true);
  });
});
