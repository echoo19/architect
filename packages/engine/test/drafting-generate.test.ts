import { TaskSchema, type TaskSpec } from '@architect/shared';
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
import { readTable } from '../src/drafting/table';
import type { Candidate } from '../src/drafting/templates/common';
import { splitTasks } from '../src/splits/split';
import { seededRandom } from '../src/splits/random';
import { shopData } from './support/drafting-data';

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
    expect(made.rejected).toEqual([
      {
        id: 'constant',
        label: 'Constant',
        problems: [
          'Every request would have the same answer, {"region":"North"}, so an agent could pass without reading the data.',
        ],
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
