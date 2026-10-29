import type { FilteredListSpec, GroupTotalSpec, LookupSpec } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { compareAnswer, checkFacts } from '../src/checker/compare';
import { seededRandom } from '../src/splits/random';
import { readTable } from '../src/drafting/table';
import { runFilteredList } from '../src/drafting/templates/filtered-list';
import { runGroupTotal } from '../src/drafting/templates/group-total';
import { runLookup } from '../src/drafting/templates/lookup';
import { REGIONS, shopData } from './support/drafting-data';

const data = shopData('templates', 400, 150);
const customers = readTable('customers.csv', data.customersCsv);
const orders = readTable('orders.csv', data.ordersCsv);

const lookup = (overrides: Partial<LookupSpec> = {}): LookupSpec => ({
  template: 'lookup',
  table: 'customers.csv',
  keyColumn: 'customer_id',
  columns: ['email', 'region'],
  request: 'What are the email and region of customer {key}?',
  ...overrides,
});

describe('the lookup template', () => {
  it('asks for the values of a row by its key and works each answer out from the file', () => {
    const run = runLookup(lookup(), customers);
    expect(run.problems).toEqual([]);
    expect(run.candidates).toHaveLength(150);
    expect(run.rule).toBe('Look up email and region by customer_id, from customers.csv');
    const truth = new Map(data.customers.map((customer) => [customer.id, customer]));
    for (const candidate of run.candidates) {
      const key = String(candidate.meta['key']);
      const customer = truth.get(key);
      expect(customer, key).toBeDefined();
      expect(candidate.expected.kind).toBe('facts');
      if (candidate.expected.kind !== 'facts') continue;
      const facts = Object.fromEntries(candidate.expected.facts.map((f) => [f.path, f.value]));
      expect(facts['email']).toBe(customer?.email);
      expect(String(facts['region']).toLowerCase()).toBe(customer?.region.toLowerCase());
      expect(candidate.prompt.split('\n')).toEqual([
        `What are the email and region of customer ${key}?`,
        'End with: ANSWER: {"email": "<text>", "region": "<text>"}',
      ]);
      expect(candidate.family).toBe(`row:customers.csv:customer_id=${key.toLowerCase()}`);
    }
  });

  it('is passed by the right answer however it is spelled, and failed by a wrong one', () => {
    const [candidate] = runLookup(lookup(), customers).candidates;
    if (candidate?.expected.kind !== 'facts') throw new Error('Expected facts.');
    const email = String(candidate.expected.facts[0]?.value);
    const region = String(candidate.expected.facts[1]?.value);
    const right = { email: ` ${email.toUpperCase()} `, region: region.toLowerCase() };
    expect(checkFacts(right, candidate.expected.facts)).toBeNull();
    expect(
      checkFacts({ ...right, email: 'someone.else@example.com' }, candidate.expected.facts),
    ).toMatch(/Expected email to be/);
    expect(checkFacts({ email }, candidate.expected.facts)).toMatch(/has no region/);
  });

  it('reads dates and numbers as such, with the unit of the answer in the request', () => {
    const run = runLookup(lookup({ columns: ['member_since'] }), customers);
    expect(run.problems).toEqual([]);
    const withDate = data.customers.filter((customer) => customer.since !== null);
    expect(run.candidates).toHaveLength(withDate.length);
    const [first] = run.candidates;
    expect(first?.prompt).toContain('Write dates as YYYY-MM-DD.');
    expect(first?.prompt).toContain('{"member_since": "<YYYY-MM-DD>"}');
    const since = new Map(withDate.map((customer) => [customer.id, customer.since]));
    for (const candidate of run.candidates) {
      if (candidate.expected.kind !== 'facts') throw new Error('Expected facts.');
      expect(candidate.expected.facts[0]?.value).toBe(since.get(String(candidate.meta['key'])));
    }
    expect(run.notes.join(' ')).toContain('lack a value');

    const amounts = runLookup(
      lookup({
        table: 'orders.csv',
        keyColumn: 'order_id',
        columns: ['amount'],
        request: 'What was order {key} for?',
      }),
      orders,
    );
    expect(amounts.problems).toEqual([]);
    const cents = new Map(data.orders.map((order) => [order.id, order.cents]));
    expect(amounts.candidates.length).toBeGreaterThan(300);
    for (const candidate of amounts.candidates) {
      if (candidate.expected.kind !== 'facts') throw new Error('Expected facts.');
      const truth = cents.get(String(candidate.meta['key']));
      expect(candidate.expected.facts[0]?.value).toBe((truth ?? 0) / 100);
    }
    expect(amounts.candidates[0]?.prompt).toContain(
      'Write numbers as plain digits, without currency signs or commas.',
    );
    expect(amounts.candidates[0]?.prompt).toContain('{"amount": <number>}');
  });

  it('leaves out a row whose key another row shares', () => {
    const table = readTable(
      'people.csv',
      [
        'id,name',
        ...Array.from({ length: 30 }, (_, i) => `P-${i},Name ${i}`),
        'P-1,Another',
        ' p-2 ,Third',
      ].join('\n'),
    );
    const run = runLookup(
      lookup({ table: 'people.csv', keyColumn: 'id', columns: ['name'] }),
      table,
    );
    expect(run.problems).toEqual([]);
    expect(run.candidates).toHaveLength(28);
    expect(run.notes[0]).toBe(
      '4 rows share their id with another row, so Architect left them out.',
    );
    expect(run.candidates.map((candidate) => candidate.meta['key'])).not.toContain('P-1');
  });

  it('says what is wrong with a specification instead of guessing', () => {
    const unknown = runLookup(lookup({ keyColumn: 'customer', columns: ['mail'] }), customers);
    expect(unknown.candidates).toEqual([]);
    expect(unknown.problems).toEqual([
      'The key column "customer" isn\'t a column of customers.csv. Its columns are customer_id, name, email, region, member_since.',
      'The column "mail" isn\'t a column of customers.csv. Its columns are customer_id, name, email, region, member_since.',
    ]);
    expect(runLookup(lookup({ request: 'What is the email?' }), customers).problems).toEqual([
      'The request must contain {key}.',
    ]);
    expect(
      runLookup(lookup({ request: 'Email of {customer}? {key}' }), customers).problems[0],
    ).toContain('uses {customer}');
    expect(runLookup(lookup({ request: '{key}? ANSWER: x' }), customers).problems[0]).toContain(
      'must not contain "ANSWER:"',
    );
    expect(runLookup(lookup({ columns: ['email', 'email'] }), customers).problems).toContain(
      'A column is asked for twice.',
    );
    expect(runLookup(lookup({ columns: ['customer_id'] }), customers).problems[0]).toContain(
      'is the key',
    );
    const region = runLookup(lookup({ keyColumn: 'region', columns: ['email'] }), customers);
    expect(region.problems[0]).toContain("region isn't a key");
  });

  it('accepts a column named in another case, and writes it as the header does', () => {
    const run = runLookup(lookup({ keyColumn: 'CUSTOMER_ID', columns: ['Email'] }), customers);
    expect(run.problems).toEqual([]);
    expect(run.spec).toMatchObject({ keyColumn: 'customer_id', columns: ['email'] });
  });
});

const list = (overrides: Partial<FilteredListSpec> = {}): FilteredListSpec => ({
  template: 'filtered_list',
  table: 'orders.csv',
  keyColumn: 'order_id',
  filters: [
    { column: 'status', op: 'equals', value: 'Pending', varies: false },
    { column: 'customer_id', op: 'equals', varies: true },
  ],
  request: 'Which orders of customer {customer_id} are still pending?',
  ...overrides,
});

describe('the filtered list template', () => {
  it('lists the keys of the rows that meet the conditions, for each value in turn', () => {
    const run = runFilteredList(list(), orders);
    expect(run.problems).toEqual([]);
    expect(run.rule).toBe(
      'List the order_id in orders.csv where status is Pending, for each customer_id',
    );
    const customersWithOrders = new Set(data.orders.map((order) => order.customerId));
    expect(run.candidates).toHaveLength(customersWithOrders.size);
    for (const candidate of run.candidates) {
      const customer = String(candidate.meta['customer_id']);
      const truth = data.orders
        .filter((order) => order.customerId === customer && order.status === 'Pending')
        .map((order) => order.id)
        .sort();
      if (candidate.expected.kind !== 'answer') throw new Error('Expected an answer.');
      expect([...(candidate.expected.value as string[])].sort()).toEqual(truth);
      expect(candidate.expected.compare).toEqual({ mode: 'set' });
      expect(candidate.prompt.split('\n')).toEqual([
        `Which orders of customer ${customer} are still pending?`,
        'List each order_id once, in any order, and use [] if there are none.',
        'End with: ANSWER: ["<order_id>", ...]',
      ]);
    }
    expect(run.candidates.some((candidate) => candidate.answerKey === '[]')).toBe(true);
  });

  it('is passed by the keys in any order and spelling, and failed by a missing or extra one', () => {
    const run = runFilteredList(list(), orders);
    const candidate = run.candidates.find((item) => {
      const value = item.expected.kind === 'answer' ? (item.expected.value as string[]) : [];
      return value.length >= 2;
    });
    if (candidate?.expected.kind !== 'answer') throw new Error('Expected a list of two.');
    const keys = candidate.expected.value as string[];
    const reversed = [...keys].reverse().map((key) => ` ${key.toLowerCase()} `);
    expect(compareAnswer(reversed, keys, candidate.expected.compare)).toBeNull();
    expect(compareAnswer(keys.slice(1), keys, candidate.expected.compare)).toMatch(/to include/);
    expect(compareAnswer([...keys, 'ORD-1'], keys, candidate.expected.compare)).toMatch(
      /which was not expected/,
    );
    expect(compareAnswer({ orders: keys }, keys, candidate.expected.compare)).toMatch(
      /to be a list/,
    );
  });

  it('takes two columns together, and leaves out lists that are too long to write out', () => {
    const small = readTable('orders.csv', shopData('small', 60, 20).ordersCsv);
    const run = runFilteredList(
      list({
        filters: [
          { column: 'region', op: 'equals', varies: true },
          { column: 'status', op: 'equals', varies: true },
        ],
        request: 'Which {status} orders are in the {region} region?',
      }),
      small,
    );
    expect(run.problems).toEqual([]);
    expect(run.candidates.length).toBeGreaterThan(6);
    for (const candidate of run.candidates) {
      if (candidate.expected.kind !== 'answer') throw new Error('Expected an answer.');
      expect((candidate.expected.value as string[]).length).toBeLessThanOrEqual(20);
    }

    const tooLong = runFilteredList(
      list({
        filters: [{ column: 'region', op: 'equals', varies: true }],
        request: 'Which orders are in the {region} region?',
      }),
      orders,
    );
    expect(tooLong.candidates).toEqual([]);
    expect(tooLong.problems[0]).toContain('Every list is longer than 20');
  });

  it('understands empty, filled and "is not" conditions', () => {
    const unshipped = runFilteredList(
      list({
        filters: [
          { column: 'shipped_on', op: 'empty', varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    expect(unshipped.problems).toEqual([]);
    const first = unshipped.candidates[0];
    const customer = String(first?.meta['customer_id']);
    expect(first?.expected).toMatchObject({
      value: data.orders
        .filter((order) => order.customerId === customer && order.shipped === null)
        .map((order) => order.id)
        .sort(),
    });
    expect(unshipped.rule).toContain('where shipped_on is empty');

    const notCancelled = runFilteredList(
      list({
        filters: [
          { column: 'status', op: 'not_equals', value: ' cancelled ', varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    const one = notCancelled.candidates[0];
    const who = String(one?.meta['customer_id']);
    expect(one?.expected).toMatchObject({
      value: data.orders
        .filter((order) => order.customerId === who && order.status !== 'Cancelled')
        .map((order) => order.id)
        .sort(),
    });
    expect(notCancelled.rule).toContain('where status is not cancelled, for each customer_id');
  });

  it('keeps the rows whose value is in a set it is told, and no row with an empty or unexpected one', () => {
    const kept = ['Pending', 'Shipped'];
    const open = runFilteredList(
      list({
        filters: [
          { column: 'status', op: 'in', values: kept, varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    expect(open.problems).toEqual([]);
    expect(open.rule).toContain('where status is Pending or Shipped, for each customer_id');
    const first = open.candidates[0];
    const customer = String(first?.meta['customer_id']);
    expect(first?.expected).toMatchObject({
      value: data.orders
        .filter((order) => order.customerId === customer && kept.includes(order.status))
        .map((order) => order.id)
        .sort(),
    });
    // The answers never hold a cancelled order, whatever the customer's other orders are.
    for (const candidate of open.candidates) {
      if (candidate.expected.kind !== 'answer') throw new Error('Expected an answer.');
      const ids = new Set(candidate.expected.value as string[]);
      const cancelled = data.orders.filter((order) => order.status === 'Cancelled');
      expect(cancelled.some((order) => ids.has(order.id))).toBe(false);
    }
    expect(open.notes.join(' ')).toContain('status also holds Cancelled (');
    expect(open.notes.join(' ')).toContain('only Pending or Shipped count');
  });

  it('keeps a row out of a set when its value is blank or one nobody listed, which "is not" does not', () => {
    const rows = [
      'ticket_id,customer_id,status',
      ...Array.from(
        { length: 12 },
        (_, i) => `T-${i},C-${i % 3},${i % 4 === 0 ? 'Open' : 'Ready'}`,
      ),
      'T-90,C-0,Picked up',
      'T-91,C-0,',
      'T-92,C-0,Mystery',
    ].join('\n');
    const tickets = readTable('tickets.csv', rows);
    const set = (filter: object) =>
      runFilteredList(
        list({
          table: 'tickets.csv',
          keyColumn: 'ticket_id',
          filters: [filter as never, { column: 'customer_id', op: 'equals', varies: true }],
          request: 'Which tickets of {customer_id} are still open?',
        }),
        tickets,
      );
    const listed = (run: ReturnType<typeof set>): string[] => {
      const zero = run.candidates.find((candidate) => candidate.meta['customer_id'] === 'C-0');
      if (zero?.expected.kind !== 'answer') throw new Error('Expected an answer.');
      return zero.expected.value as string[];
    };
    const complement = set({
      column: 'status',
      op: 'not_equals',
      value: 'Picked up',
      varies: false,
    });
    expect(listed(complement)).toEqual(expect.arrayContaining(['T-91', 'T-92']));
    const members = set({
      column: 'status',
      op: 'in',
      values: ['Open', 'Ready'],
      varies: false,
    });
    expect(members.problems).toEqual([]);
    expect(listed(members)).not.toContain('T-90');
    expect(listed(members)).not.toContain('T-91');
    expect(listed(members)).not.toContain('T-92');
    expect(members.notes.join(' ')).toContain(
      'status also holds Picked up (1 row) and Mystery (1 row). Rows with those values are not listed, because only Open or Ready count.',
    );
    expect(members.notes.join(' ')).toContain('1 row has no status, so it is not listed.');
  });

  it('refuses a set that names a value the column does not hold, or no values at all', () => {
    const wrong = runFilteredList(
      list({
        filters: [
          { column: 'status', op: 'in', values: ['Pending', 'Waiting'], varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    expect(wrong.candidates).toEqual([]);
    expect(wrong.problems).toEqual([
      'No row of orders.csv has "Waiting" in status. status holds Pending, Shipped, Cancelled.',
    ]);
    const none = runFilteredList(
      list({
        filters: [
          { column: 'status', op: 'in', varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    expect(none.problems).toContain('The filter on status needs the values it keeps.');
  });

  it('says what is wrong with a specification instead of guessing', () => {
    const noVarying = runFilteredList(
      list({ filters: [{ column: 'status', op: 'equals', value: 'Pending', varies: false }] }),
      orders,
    );
    expect(noVarying.problems[0]).toContain(
      'One filter must take each value of its column in turn',
    );

    const unknownValue = runFilteredList(
      list({
        filters: [
          { column: 'status', op: 'equals', value: 'Unshipped', varies: false },
          { column: 'customer_id', op: 'equals', varies: true },
        ],
      }),
      orders,
    );
    expect(unknownValue.problems).toEqual([
      'No row of orders.csv meets "status is Unshipped". status holds Pending, Shipped, Cancelled.',
    ]);

    const wrongColumn = runFilteredList(
      list({
        filters: [{ column: 'area', op: 'equals', varies: true }],
        request: 'Orders in {area}?',
      }),
      orders,
    );
    expect(wrongColumn.problems[0]).toContain(
      'The filter column "area" isn\'t a column of orders.csv',
    );

    expect(
      runFilteredList(list({ request: 'Which orders are pending?' }), orders).problems,
    ).toEqual(['The request must contain {customer_id}.']);
    expect(
      runFilteredList(
        list({
          filters: [
            { column: 'status', op: 'equals', varies: false },
            { column: 'customer_id', op: 'equals', varies: true },
          ],
        }),
        orders,
      ).problems,
    ).toContain('The filter on status needs the value it compares with.');
    expect(runFilteredList(list({ keyColumn: 'customer_id' }), orders).problems).toContain(
      "customer_id is what is listed, so it can't also be a filter.",
    );
  });
});

const total = (overrides: Partial<GroupTotalSpec> = {}): GroupTotalSpec => ({
  template: 'group_total',
  table: 'orders.csv',
  groupColumn: 'region',
  measure: 'sum',
  valueColumn: 'amount',
  dateColumn: 'order_date',
  unit: 'as_written',
  request: 'What is the total of orders in the {group} region from {from} to {to}?',
  ...overrides,
});

/** The truth: cents of the orders in a region, and in a range of days if one is given. */
function truth(
  region: string,
  range?: { from: string; to: string },
): { cents: number; rows: number } {
  const inside = data.orders.filter(
    (order) =>
      order.region.toLowerCase() === region.toLowerCase() &&
      (range === undefined || (order.date >= range.from && order.date <= range.to)),
  );
  return { cents: inside.reduce((sum, order) => sum + (order.cents ?? 0), 0), rows: inside.length };
}

describe('the group total template', () => {
  it('adds up a column for a group within a range of dates, both ends included', () => {
    const run = runGroupTotal(total(), orders, seededRandom('range'));
    expect(run.problems).toEqual([]);
    expect(run.rule).toBe(
      'Total of amount for each region, within a range of dates in order_date, from orders.csv',
    );
    expect(run.candidates.length).toBeGreaterThan(10);
    let touchesAnEnd = 0;
    for (const candidate of run.candidates) {
      const range = { from: String(candidate.meta['from']), to: String(candidate.meta['to']) };
      const { cents } = truth(String(candidate.meta['group']), range);
      if (candidate.expected.kind !== 'answer') throw new Error('Expected an answer.');
      expect(candidate.expected.value).toEqual({ total: cents / 100 });
      expect(candidate.expected.compare).toEqual({ mode: 'number', tolerance: 0.005 });
      if (data.orders.some((order) => order.date === range.from || order.date === range.to)) {
        touchesAnEnd += 1;
      }
      const [question, hint, shape] = candidate.prompt.split('\n');
      expect(question).toBe(
        `What is the total of orders in the ${candidate.meta['group']} region from ${range.from} to ${range.to}? Both dates are included.`,
      );
      expect(hint).toBe('Write the number as plain digits, without currency signs or commas.');
      expect(shape).toBe('End with: ANSWER: {"total": <number>}');
      expect(candidate.family).toBe(
        `total:orders.csv:region=${String(candidate.meta['group']).toLowerCase()}:${range.from}`,
      );
    }
    expect(touchesAnEnd).toBeGreaterThan(0);
    expect(run.notes).toEqual([]);
  });

  it('never gives one group two ranges that overlap, so no two requests share rows', () => {
    const run = runGroupTotal(total(), orders, seededRandom('disjoint'));
    const byGroup = new Map<string, { from: string; to: string }[]>();
    for (const candidate of run.candidates) {
      const group = String(candidate.meta['group']).toLowerCase();
      byGroup.set(group, [
        ...(byGroup.get(group) ?? []),
        { from: String(candidate.meta['from']), to: String(candidate.meta['to']) },
      ]);
    }
    expect(byGroup.size).toBe(REGIONS.length);
    for (const ranges of byGroup.values()) {
      expect(ranges.length).toBeGreaterThanOrEqual(3);
      for (const [index, range] of ranges.entries()) {
        for (const other of ranges.slice(index + 1)) {
          expect(range.from <= other.to && range.to >= other.from).toBe(false);
        }
      }
    }
    expect(new Set(run.candidates.map((candidate) => candidate.family)).size).toBe(
      run.candidates.length,
    );
  });

  it('is passed by a number within the tolerance and failed by a wrong total', () => {
    const [candidate] = runGroupTotal(total(), orders, seededRandom('range')).candidates;
    if (candidate?.expected.kind !== 'answer') throw new Error('Expected an answer.');
    const value = (candidate.expected.value as { total: number }).total;
    expect(
      compareAnswer({ total: value + 0.004 }, candidate.expected.value, candidate.expected.compare),
    ).toBeNull();
    expect(
      compareAnswer({ total: String(value) }, candidate.expected.value, candidate.expected.compare),
    ).toBeNull();
    expect(
      compareAnswer({ total: value + 0.02 }, candidate.expected.value, candidate.expected.compare),
    ).toMatch(/Expected total to be/);
    expect(compareAnswer(value, candidate.expected.value, candidate.expected.compare)).toMatch(
      /to be an object/,
    );
  });

  it('totals every date when the specification names no date column', () => {
    const run = runGroupTotal(
      total({ dateColumn: undefined, request: 'What is the total of the {group} region?' }),
      orders,
      seededRandom('all'),
    );
    expect(run.problems).toEqual([]);
    expect(run.candidates).toHaveLength(REGIONS.length);
    for (const candidate of run.candidates) {
      const { cents } = truth(String(candidate.meta['group']));
      expect(candidate.expected).toMatchObject({ value: { total: cents / 100 } });
      expect(candidate.prompt).not.toContain('Both dates');
    }
    expect(run.rule).toBe('Total of amount for each region, from orders.csv');
  });

  it('counts rows, and gives a total in cents as a whole number', () => {
    const counted = runGroupTotal(
      total({
        measure: 'count',
        valueColumn: undefined,
        dateColumn: undefined,
        request: 'How many orders are there in the {group} region?',
      }),
      orders,
      seededRandom('count'),
    );
    expect(counted.problems).toEqual([]);
    for (const candidate of counted.candidates) {
      expect(candidate.expected).toMatchObject({
        value: { count: truth(String(candidate.meta['group'])).rows },
        compare: { mode: 'number', tolerance: 0 },
      });
      expect(candidate.prompt).toContain('Give it as a whole number.');
      expect(candidate.prompt).toContain('{"count": <number>}');
    }
    expect(counted.rule).toBe('Number of rows for each region, from orders.csv');

    const cents = runGroupTotal(
      total({
        unit: 'cents',
        dateColumn: undefined,
        request: 'What is the {group} region worth, in cents?',
      }),
      orders,
      seededRandom('cents'),
    );
    expect(cents.problems).toEqual([]);
    for (const candidate of cents.candidates) {
      expect(candidate.expected).toMatchObject({
        value: { total_cents: truth(String(candidate.meta['group'])).cents },
        compare: { mode: 'number', tolerance: 0 },
      });
      expect(candidate.prompt).toContain('Give it in cents, as a whole number.');
    }
  });

  it('counts only the rows that have a value when a column is named', () => {
    const run = runGroupTotal(
      total({
        measure: 'count',
        valueColumn: 'amount',
        dateColumn: undefined,
        request: 'How many {group} orders have an amount?',
      }),
      orders,
      seededRandom('filled'),
    );
    for (const candidate of run.candidates) {
      const group = String(candidate.meta['group']).toLowerCase();
      const expected = data.orders.filter(
        (o) => o.region.toLowerCase() === group && o.cents !== null,
      ).length;
      expect(candidate.expected).toMatchObject({ value: { count: expected } });
    }
    expect(run.rule).toBe('Number of rows with a amount for each region, from orders.csv');
  });

  it('stops at a cell it cannot read instead of making a total from a guess', () => {
    const broken = readTable(
      'orders.csv',
      [
        'region,amount,order_date',
        ...Array.from(
          { length: 40 },
          (_, i) =>
            `${i % 2 === 0 ? 'North' : 'South'},${10 + i},2026-10-${String((i % 28) + 1).padStart(2, '0')}`,
        ),
        'North,twelve dollars,2026-10-05',
        'South,5,sometime in May',
      ].join('\n'),
    );
    const run = runGroupTotal(total(), broken, seededRandom('broken'));
    expect(run.candidates).toEqual([]);
    expect(run.problems).toEqual([
      'amount has 1 values Architect can\'t read as numbers, such as "twelve dollars".',
      'order_date has 1 values Architect can\'t read as dates, such as "sometime in May".',
    ]);
  });

  it('reads dates written day first when the file shows it, and says when it has to assume', () => {
    const rows = Array.from({ length: 60 }, (_, i) => {
      const day = (i % 28) + 1;
      const month = i < 30 ? 9 : 10;
      return {
        region: i % 2 === 0 ? 'North' : 'South',
        amount: i + 1,
        day: `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        text: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/2026`,
      };
    });
    const dayFirst = runGroupTotal(
      total(),
      readTable(
        'orders.csv',
        ['region,amount,order_date', ...rows.map((r) => `${r.region},${r.amount},${r.text}`)].join(
          '\n',
        ),
      ),
      seededRandom('dayfirst'),
    );
    expect(dayFirst.problems).toEqual([]);
    expect(dayFirst.notes).toEqual([]);
    expect(dayFirst.candidates.length).toBeGreaterThan(2);
    for (const candidate of dayFirst.candidates) {
      const from = String(candidate.meta['from']);
      const to = String(candidate.meta['to']);
      const group = String(candidate.meta['group']);
      const sum = rows
        .filter((r) => r.region === group && r.day >= from && r.day <= to)
        .reduce((all, r) => all + r.amount, 0);
      expect(candidate.expected).toMatchObject({ value: { total: sum } });
    }

    const ambiguous = runGroupTotal(
      total(),
      readTable(
        'orders.csv',
        [
          'region,amount,order_date',
          ...Array.from(
            { length: 40 },
            (_, i) =>
              `${i % 2 ? 'North' : 'South'},${i + 1},0${(i % 9) + 1}/0${((i + 3) % 9) + 1}/2026`,
          ),
        ].join('\n'),
      ),
      seededRandom('ambiguous'),
    );
    expect(ambiguous.notes[0]).toContain('could be read either way');
  });

  it('says what is wrong with a specification instead of guessing', () => {
    expect(
      runGroupTotal(total({ groupColumn: 'area' }), orders, seededRandom('x')).problems[0],
    ).toContain('The grouping column "area" isn\'t a column of orders.csv');
    expect(
      runGroupTotal(total({ valueColumn: undefined }), orders, seededRandom('x')).problems,
    ).toContain('A total needs the column to add up.');
    expect(
      runGroupTotal(total({ request: 'Total for {group}?' }), orders, seededRandom('x')).problems,
    ).toEqual(['The request must contain {from}.', 'The request must contain {to}.']);
    expect(
      runGroupTotal(
        total({
          measure: 'count',
          unit: 'cents',
          valueColumn: undefined,
          dateColumn: undefined,
          request: '{group}?',
        }),
        orders,
        seededRandom('x'),
      ).problems,
    ).toContain('Cents only apply to a total, not to a count.');
    const fewDays = readTable(
      'orders.csv',
      [
        'region,amount,order_date',
        ...Array.from({ length: 12 }, (_, i) => `North,${i},2026-10-0${(i % 5) + 1}`),
      ].join('\n'),
    );
    expect(runGroupTotal(total(), fewDays, seededRandom('x')).problems[0]).toContain(
      'cover 5 days, too few to ask about ranges of dates',
    );
    const fractions = readTable(
      'orders.csv',
      ['region,amount', ...Array.from({ length: 12 }, (_, i) => `North,${i}.125`)].join('\n'),
    );
    expect(
      runGroupTotal(
        total({ unit: 'cents', dateColumn: undefined, request: '{group}?' }),
        fractions,
        seededRandom('x'),
      ).problems[0],
    ).toContain('more than two decimal places');
  });
});
