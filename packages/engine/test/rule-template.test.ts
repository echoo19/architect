import type { RuleNode, RuleSpec } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { compareAnswer } from '../src/checker/compare';
import { significantDigits } from '../src/drafting/rule/guards';
import { readTable, type Table } from '../src/drafting/table';
import { conventionsOf, ruleVersion, runRule } from '../src/drafting/templates/rule';
import {
  bikeExpression,
  bikeRule,
  bikeShop,
  bikeTables,
  billedHours,
  col,
  num,
  truth,
  type Bike,
} from './support/rule-data';

const bike = bikeShop({ offGrid: true });

function run(spec: RuleSpec = bikeRule(), tables = bikeTables(bike)) {
  return runRule(spec, tables);
}

/** The tables of a shop whose records were edited by hand, for the test of one fault. */
function edited(
  edit: (tickets: string[][], customers: string[][]) => void,
  source: Bike = bike,
): Map<string, Table> {
  const split = (csv: string) =>
    csv
      .trim()
      .split('\n')
      .map((line) => line.split(','));
  const tickets = split(source.ticketsCsv);
  const customers = split(source.customersCsv);
  edit(tickets, customers);
  const join = (rows: string[][]) => `${rows.map((row) => row.join(',')).join('\n')}\n`;
  return new Map([
    ['tickets.csv', readTable('tickets.csv', join(tickets))],
    ['customers.csv', readTable('customers.csv', join(customers))],
  ]);
}

describe('the rule template on the bike shop', () => {
  it('works each answer out from the records, to the cent, and matches the truth', () => {
    const result = run();
    expect(result.problems).toEqual([]);
    const members = new Map(bike.customers.map((c) => [c.id, c.member]));
    const tickets = new Map(bike.tickets.map((t) => [t.id, t]));
    const withParts = bike.tickets.filter((t) => t.partsCents !== null);
    expect(result.candidates).toHaveLength(withParts.length);
    for (const candidate of result.candidates) {
      const ticket = tickets.get(String(candidate.meta['key']));
      if (ticket === undefined) throw new Error('A task for a ticket that is not there.');
      expect(candidate.expected).toEqual({
        kind: 'answer',
        value: { total: truth(ticket, members.get(ticket.customerId) ?? false) / 100 },
        compare: { mode: 'number', tolerance: 0.005 },
      });
      expect(candidate.prompt.split('\n')).toEqual([
        `What does ticket ${ticket.id} cost the customer?`,
        'Give the amount in US dollars as a plain number, without a currency sign or commas.',
        'End with: ANSWER: {"total": <number>}',
      ]);
      expect(candidate.family).toBe(`rule:tickets.csv:ticket_id=${ticket.id.toLowerCase()}`);
    }
  });

  it('is passed by the right answer and failed by one cent off, the way the checker compares', () => {
    const [candidate] = run().candidates;
    if (candidate?.expected.kind !== 'answer') throw new Error('Expected an answer.');
    const { value, compare } = candidate.expected;
    const total = (value as { total: number }).total;
    expect(compareAnswer({ total }, value, compare)).toBeNull();
    expect(compareAnswer({ total: `${total}` }, value, compare)).toBeNull();
    expect(
      compareAnswer({ total: Math.round((total + 0.01) * 100) / 100 }, value, compare),
    ).toMatch(/Expected total to be/);
    expect(
      compareAnswer({ total: Math.round((total - 0.01) * 100) / 100 }, value, compare),
    ).toMatch(/Expected total to be/);
  });

  it('states the rule in plain words, and the details that go with it', () => {
    const result = run();
    expect(result.rule).toBe(
      'Work out total for each ticket_id of tickets.csv: Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
    );
    const details = result.outcome?.details;
    expect(details?.statement).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
    );
    expect(details?.passages).toEqual(bikeRule().sources);
    expect(details?.cases).toEqual({ total: 160, eligible: result.candidates.length });
    expect(
      details?.branches.map((branch) => [branch.label, branch.cases > 0, branch.changes > 0]),
    ).toEqual([
      ['member (customers.csv) is yes', true, true],
      ['member (customers.csv) is no', true, true],
    ]);
    expect(details?.conventions).toEqual(conventionsOf(bikeRule()));
    expect(details?.conventions.join(' ')).toContain('it is never counted as zero');
    expect(details?.conventions.join(' ')).toContain('US dollars (USD)');
  });

  it('leaves out a row with a missing input and says so, never counting it as zero', () => {
    const result = run();
    const missing = bike.tickets.filter((t) => t.partsCents === null).length;
    expect(missing).toBeGreaterThan(10);
    expect(result.outcome?.details.excluded).toEqual([
      {
        reason: 'parts_cost is empty or N/A',
        count: missing,
        example: expect.stringMatching(/^T-\d+$/),
      },
    ]);
    expect(result.notes[0]).toMatch(
      /^\d+ rows of tickets.csv left out because parts_cost is empty or N\/A, such as T-\d+\.$/,
    );
    // Not one of the left-out tickets is a task, and none was priced as free parts.
    const asked = new Set(result.candidates.map((candidate) => candidate.meta['key']));
    for (const ticket of bike.tickets.filter((t) => t.partsCents === null)) {
      expect(asked.has(ticket.id)).toBe(false);
    }
  });

  it('counts each way a row can fail apart: unreadable, unknown category, no match, a key shared', () => {
    const tables = edited((tickets, customers) => {
      const row = (i: number) => tickets[i] as string[];
      row(1)[3] = 'abc';
      row(2)[3] = '';
      row(3)[2] = row(3)[2] as string;
      row(4)[1] = 'C-999';
      row(5)[1] = '';
      customers.push(['C-101', 'A second C-101', 'again@example.com', 'yes']);
      (customers[10] as string[])[3] = 'maybe';
      (customers[11] as string[])[3] = '';
      row(6)[0] = row(7)[0] as string;
    });
    const result = runRule(bikeRule(), tables);
    expect(result.problems).toEqual([]);
    const reasons = new Map(
      result.outcome?.details.excluded.map((item) => [item.reason, item.count]),
    );
    expect(reasons.get("labor_hours can't be read as a number")).toBe(1);
    expect(reasons.get('labor_hours is empty or N/A')).toBe(1);
    expect(reasons.get('customer_id has no row in customers.csv')).toBe(1);
    expect(reasons.get('customer_id is empty, so there is nothing to look up')).toBe(1);
    expect(reasons.get('ticket_id is used by more than one row')).toBe(2);
    expect(reasons.get('customers.csv lists the same customer_id more than once')).toBeGreaterThan(
      0,
    );
    expect(
      reasons.get('member (customers.csv) has a value the rule does not list'),
    ).toBeGreaterThan(0);
    expect(reasons.get('member (customers.csv) is empty')).toBeGreaterThan(0);
  });

  it('refuses a lookup key that is not a key', () => {
    const tables = edited((_tickets, customers) => {
      for (let i = 1; i < 20; i += 1) (customers[i] as string[])[0] = 'C-101';
    });
    const result = runRule(bikeRule(), tables);
    expect(result.candidates).toEqual([]);
    // The teacher is told how many rows share a value, and the person which value.
    expect(result.problems).toEqual([
      "customer_id isn't a key in customers.csv: 19 of 40 rows share their value with another row.",
    ]);
    expect(result.inFull?.get(result.problems[0] ?? '')).toBe(
      'customer_id isn\'t a key in customers.csv: 19 of 40 rows share their value with another row, such as "c-101".',
    );
  });

  it('holds amounts to the currency it declared, and refuses a column that mixes currencies', () => {
    // A column of plain amounts, one of them written in euros.
    const plain = (tickets: string[][]) => {
      for (const row of tickets.slice(1)) row[4] = (row[4] ?? '').replaceAll('$', '');
    };
    const euro = edited((tickets) => {
      plain(tickets);
      (tickets[1] as string[])[4] = '\u{20ac}12.50';
    });
    const result = runRule(bikeRule(), euro);
    expect(result.problems).toEqual([]);
    expect(result.outcome?.details.excluded.map((item) => item.reason)).toContain(
      'parts_cost is written in a currency other than US dollars',
    );
    // The same column read in euros is what it says it is.
    expect(runRule(bikeRule({ currency: 'EUR' }), euro).outcome?.details.excluded).toEqual(
      expect.arrayContaining([expect.objectContaining({ reason: 'parts_cost is empty or N/A' })]),
    );

    const mixed = edited((tickets) => {
      plain(tickets);
      (tickets[1] as string[])[4] = '\u{20ac}12.50';
      (tickets[2] as string[])[4] = '$20.00';
    });
    const refused = runRule(bikeRule(), mixed);
    expect(refused.candidates).toEqual([]);
    expect(refused.problems).toEqual([
      'parts_cost in tickets.csv mixes currencies, and adding amounts in different currencies gives an amount in neither.',
    ]);

    const undeclared = runRule(bikeRule({ currency: undefined }), bikeTables(bike));
    expect(undeclared.problems).toEqual([
      'parts_cost in tickets.csv has currency signs, so the rule has to name the currency its amounts are in.',
    ]);
  });

  it('reads amounts written in won or rubles, by code or by sign, when the rule declares that currency', () => {
    for (const [code, sign] of [
      ['KRW', '\u{20a9}'],
      ['RUB', '\u{20bd}'],
    ] as const) {
      const written = edited((tickets) => {
        for (const row of tickets.slice(1)) row[4] = (row[4] ?? '').replaceAll('$', '');
        (tickets[1] as string[])[4] = `${code} 1200`;
        (tickets[2] as string[])[4] = `${sign}2500`;
      });
      const keys = (written.get('tickets.csv')?.rows ?? [])
        .slice(0, 2)
        .map((row) => row['ticket_id']);
      expect(keys).toHaveLength(2);
      const result = runRule(bikeRule({ currency: code }), written);
      expect(result.problems, code).toEqual([]);
      const reasons = result.outcome?.details.excluded.map((item) => item.reason) ?? [];
      expect(reasons.join(' '), code).not.toContain("can't be read as a number");
      const worked = result.candidates.map((candidate) => candidate.meta['key']);
      for (const key of keys) expect(worked, `${code} ${key}`).toContain(key);
      // Declared in dollars instead, the same two cells are in another currency, not unreadable.
      const dollars = runRule(bikeRule(), written);
      expect(dollars.outcome?.details.excluded.map((item) => item.reason)).toContain(
        'parts_cost is written in a currency other than US dollars',
      );
    }
  });

  it('refuses a rule whose answers have more digits than a number can be checked by, and takes money to the cent', () => {
    // 999999999.00000003 and 999999999.00000006 are different answers, but one number to a
    // checker that compares numbers, so a wrong answer could be right.
    const rows = Array.from({ length: 30 }, (_, i) => `K-${i},${111_111_111 + i}.00000001`);
    const amounts = new Map([
      ['amounts.csv', readTable('amounts.csv', ['id,value', ...rows].join('\n'))],
    ]);
    const spec = (increment: string): RuleSpec => ({
      template: 'rule',
      table: 'amounts.csv',
      keyColumn: 'id',
      request: 'What is the amount for {key}?',
      answerName: 'amount',
      categories: [],
      expression: {
        op: 'round',
        arg: { op: 'mul', args: [col('value'), num('3')] },
        increment,
        mode: 'half_up',
      },
      sources: [{ file: 'policy.md', passage: 'Triple it.' }],
    });
    const fine = runRule(spec('0.01'), amounts);
    expect(fine.problems).toEqual([]);
    expect(fine.candidates).toHaveLength(30);

    const fineGrained = runRule(spec('0.00000001'), amounts);
    expect(fineGrained.candidates).toEqual([]);
    // The teacher is told how long the longest answer is, and the person which answer it is.
    expect(fineGrained.problems).toEqual([
      'The longest answer has 17 digits, and an answer is graded as a number that holds 13 exactly, so a wrong answer could be taken for the right one. Round the answer to a coarser step, such as the cent for money.',
    ]);
    expect(fineGrained.inFull?.get(fineGrained.problems[0] ?? '')).toBe(
      'An answer such as 333333333.00000003 has 17 digits, and an answer is graded as a number that holds 13 exactly, so a wrong answer could be taken for the right one. Round the answer to a coarser step, such as the cent for money.',
    );
    // Fewer digits after the point is as fine, and small numbers need few digits however small.
    expect(runRule(spec('0.0001'), amounts).problems).toEqual([]);
    expect(significantDigits('0.00000001')).toBe(1);
    expect(significantDigits('-120.50')).toBe(5);
    expect(significantDigits('0')).toBe(0);
  });

  it('refuses a column that holds words where the rule adds numbers', () => {
    const result = runRule(
      bikeRule({
        lookup: undefined,
        categories: [],
        expression: { op: 'round', arg: col('status'), increment: '1', mode: 'up' },
      }),
      bikeTables(bike),
    );
    expect(result.problems).toEqual([
      "status in tickets.csv holds words or dates, not numbers, so a rule can't add it up.",
    ]);
    const nothing = edited((tickets) => {
      for (const row of tickets.slice(1)) row[4] = 'N/A';
    });
    expect(runRule(bikeRule(), nothing).problems).toEqual([
      "parts_cost in tickets.csv has no values, so a rule can't use it.",
    ]);
  });

  it('writes a column as its table does, and says which one a table lacks', () => {
    const lower = bikeRule({ keyColumn: 'TICKET_ID', expression: bikeExpression() });
    const ok = run(lower);
    expect(ok.problems).toEqual([]);
    expect(ok.spec).toMatchObject({ keyColumn: 'ticket_id' });

    const wrong = run(
      bikeRule({
        expression: { op: 'round', arg: col('parts'), increment: '0.01', mode: 'half_up' },
        lookup: undefined,
        categories: [],
      }),
    );
    expect(wrong.problems).toEqual([
      'The column "parts" isn\'t a column of tickets.csv. Its columns are ticket_id, customer_id, status, labor_hours, parts_cost.',
    ]);
    expect(
      run(bikeRule({ lookup: { table: 'staff.csv', keyColumn: 'id', matchColumn: 'customer_id' } }))
        .problems[0],
    ).toBe("The lookup names staff.csv, which isn't one of the attached tables.");
    expect(run(bikeRule({ request: 'What does it cost?' })).problems).toEqual([
      'The request must contain {key}.',
    ]);
  });

  it('keeps the cases of one entity in one family when the teacher names the entity', () => {
    const result = run(bikeRule({ familyColumn: 'customer_id' }));
    expect(result.problems).toEqual([]);
    const families = new Set(result.candidates.map((candidate) => candidate.family));
    expect(families.size).toBeLessThan(result.candidates.length);
    expect([...families][0]).toMatch(/^rule:tickets\.csv:customer_id=c-\d+$/);
    const tickets = new Map(bike.tickets.map((t) => [t.id, t.customerId.toLowerCase()]));
    for (const candidate of result.candidates) {
      expect(candidate.family.endsWith(`=${tickets.get(String(candidate.meta['key']))}`)).toBe(
        true,
      );
    }
  });
});

describe('an empty cell the person said counts as zero', () => {
  // The bike shop's export writes a ticket with no parts as an empty cell, or as N/A, by turns.
  const withoutParts = bike.tickets.filter((ticket) => ticket.partsCents === null);
  const empty = withoutParts.filter((ticket) => bike.tickets.indexOf(ticket) % 2 === 1);
  const notApplicable = withoutParts.filter((ticket) => bike.tickets.indexOf(ticket) % 2 === 0);
  const zero = (extra: Partial<RuleSpec> = {}) =>
    bikeRule({ emptyMeansZero: [{ column: 'parts_cost', from: 'row' }], ...extra });

  it('counts an empty cell as zero in the column named, and no other blank', () => {
    expect(empty.length).toBeGreaterThan(5);
    expect(notApplicable.length).toBeGreaterThan(5);
    const result = run(zero());
    expect(result.problems).toEqual([]);
    const members = new Map(bike.customers.map((c) => [c.id, c.member]));
    const worked = new Map(
      result.candidates.map((candidate) => [candidate.meta['key'], candidate]),
    );
    for (const ticket of empty) {
      const candidate = worked.get(ticket.id);
      expect(candidate, ticket.id).toBeDefined();
      expect(candidate?.expected).toMatchObject({
        value: { total: truth(ticket, members.get(ticket.customerId) ?? false) / 100 },
      });
    }
    // N/A is not nothing: nobody knows what was spent, so the ticket has no answer.
    for (const ticket of notApplicable) expect(worked.has(ticket.id), ticket.id).toBe(false);
    const reasons = result.outcome?.details.excluded.map((item) => item.reason) ?? [];
    expect(reasons).toEqual(['parts_cost says N/A or a dash, which is not the same as empty']);
    expect(result.outcome?.details.excluded[0]?.count).toBe(notApplicable.length);
    expect(result.outcome?.details.cases.eligible).toBe(bike.tickets.length - notApplicable.length);
  });

  it('never does it by default: a rule that was not told leaves the empty rows out', () => {
    const result = run();
    const worked = new Set(result.candidates.map((candidate) => candidate.meta['key']));
    for (const ticket of empty) expect(worked.has(ticket.id), ticket.id).toBe(false);
    expect(result.outcome?.details.excluded.map((item) => item.reason)).toEqual([
      'parts_cost is empty or N/A',
    ]);
    expect(result.outcome?.details.statement).not.toContain('counts as 0');
  });

  it('says so in the rule in words, in how numbers are read and in what it reaches', () => {
    const result = run(zero());
    const details = result.outcome?.details;
    expect(details?.statement).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up. An empty parts cost counts as 0, as you said.',
    );
    expect(details?.conventions).toContain(
      'An empty parts_cost counts as 0, as you said. N/A or words in it still leave the row out.',
    );
    expect(details?.conventions[0]).toContain('Nothing is counted as zero unless you said so.');
    expect(details?.conventions[0]).not.toContain('it is never counted as zero');
    expect(details?.flags).toContain(
      `${empty.length} of ${bike.tickets.length} rows have an empty parts cost, which counts as 0, as you said.`,
    );
    expect(result.notes).toContain(
      `${empty.length} of ${bike.tickets.length} rows have an empty parts cost, which counts as 0, as you said.`,
    );
    // A different rule: confirming one is not confirming the other.
    expect(ruleVersion(zero())).not.toBe(ruleVersion(bikeRule()));
    // A column that is read and has no empty cell has nothing to say.
    const none = runRule(
      zero({ emptyMeansZero: [{ column: 'labor_hours', from: 'row' }] }),
      bikeTables(bike),
    );
    expect(none.problems).toEqual([]);
    expect(none.outcome?.details.flags.join(' ')).not.toContain('counts as 0');
  });

  it('refuses a column the rule does not read, and one the table lacks', () => {
    const unread = run(zero({ emptyMeansZero: [{ column: 'status', from: 'row' }] }));
    expect(unread.candidates).toEqual([]);
    expect(unread.problems).toEqual([
      "status is said to count as zero when it is empty, but the rule doesn't read it.",
    ]);
    const lacking = run(zero({ emptyMeansZero: [{ column: 'discount', from: 'row' }] }));
    expect(lacking.problems[0]).toContain('The column "discount" isn\'t a column of tickets.csv.');
  });

  it('tells the answers apart by it, so the same questions asked with and without it are two rules', () => {
    const asked = (spec: RuleSpec) => run(spec).candidates.map((candidate) => candidate.identity);
    const plain = new Set(asked(bikeRule()));
    const counted = asked(zero());
    expect(counted.filter((identity) => plain.has(identity))).toEqual([]);
  });
});

describe('the version of a rule', () => {
  it('names a rule by its content, however its keys were ordered, and changes with any part of it', () => {
    const rule = bikeRule();
    const sorted = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sorted)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.keys(value)
                .sort()
                .reverse()
                .map((key) => [key, sorted((value as Record<string, unknown>)[key])]),
            )
          : value;
    const reordered = sorted(rule) as RuleSpec;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(rule));
    expect(ruleVersion(rule)).toMatch(/^[0-9a-f]{12}$/);
    expect(ruleVersion(reordered)).toBe(ruleVersion(rule));
    expect(ruleVersion(bikeRule({ expression: bikeExpression('0.85') }))).not.toBe(
      ruleVersion(rule),
    );
    expect(ruleVersion(bikeRule({ request: 'What is the bill for {key}?' }))).not.toBe(
      ruleVersion(rule),
    );
    expect(ruleVersion(bikeRule({ currency: 'CAD' }))).not.toBe(ruleVersion(rule));
    expect(run().outcome?.details.version).toBe(ruleVersion(run().spec as RuleSpec));
  });
});

describe('what a rule must not be', () => {
  const rounded = (arg: RuleNode, increment = '0.01'): RuleNode => ({
    op: 'round',
    arg,
    increment,
    mode: 'half_up',
  });
  const only = (spec: Partial<RuleSpec>) =>
    runRule(bikeRule({ lookup: undefined, categories: [], ...spec }), bikeTables(bike));

  it('refuses an answer that is the same for every case', () => {
    const result = only({ expression: rounded(num('65')) });
    expect(result.candidates).toEqual([]);
    // The teacher is told the answers are all one; the person, which one.
    expect(result.problems[0]).toBe(
      'Every row of tickets.csv that can be worked out comes to the same total, so an agent could pass without working anything out.',
    );
    expect(result.inFull?.get(result.problems[0] ?? '')).toBe(
      'Every row of tickets.csv that can be worked out comes to the same total, 65, so an agent could pass without working anything out.',
    );
  });

  it('refuses an answer that is the key', () => {
    const numbered = readTable(
      'tickets.csv',
      [
        'ticket_id,hours',
        ...Array.from({ length: 40 }, (_, i) => `${1000 + i},${1 + (i % 5)}`),
      ].join('\n'),
    );
    const result = runRule(
      bikeRule({
        lookup: undefined,
        categories: [],
        expression: rounded(col('ticket_id'), '1'),
      }),
      new Map([['tickets.csv', numbered]]),
    );
    expect(result.candidates).toEqual([]);
    expect(result.problems).toEqual([
      'The answer is just the ticket_id, which the request already gives. A rule has to work something out.',
    ]);
  });

  it('refuses an answer that copies a column, and mentions one that is often written in a column', () => {
    const copy = only({ expression: rounded(col('parts_cost')) });
    expect(copy.candidates).toEqual([]);
    expect(copy.problems).toEqual([
      'The answer is just the value of parts_cost, which needs no rule. A rule has to work something out.',
    ]);

    // Parts alone for members' tickets, labor added for the others: the answer is the column in part.
    const part = runRule(
      bikeRule({
        expression: rounded({
          op: 'if',
          when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
          then: col('parts_cost'),
          else: { op: 'add', args: [col('parts_cost'), num('5')] },
        }),
      }),
      bikeTables(bike),
    );
    expect(part.problems).toEqual([]);
    expect(part.outcome?.details.flags.join(' ')).toMatch(
      /^In \d+% of the rows the answer is already written in parts_cost, so an agent could read it instead of working it out\./,
    );
  });

  it('refuses a rule that copies a column in as many cases as the job asks to get right, not only in nine in ten', () => {
    // Non-members' tickets are the parts cost as it is written, members' have five more.
    const mostly = bikeRule({
      expression: rounded({
        op: 'if',
        when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
        then: { op: 'add', args: [col('parts_cost'), num('5')] },
        else: col('parts_cost'),
      }),
    });
    const tables = bikeTables(bike);
    const usual = runRule(mostly, tables);
    expect(usual.problems).toEqual([]);
    const flag = usual.outcome?.details.flags.join(' ') ?? '';
    const share = Number(/In (\d+)% of the rows/.exec(flag)?.[1]);
    expect(share).toBeGreaterThan(50);
    expect(share).toBeLessThan(90);

    // A job that needs fewer right than the copy gets right would pass a copy.
    const lax = (share - 5) / 100;
    const refused = runRule(mostly, tables, lax);
    expect(refused.candidates).toEqual([]);
    expect(refused.problems).toEqual([
      `The answer is the value of parts_cost in ${share}% of the rows, and the job asks for ${share - 5}% right, so an agent that copies it would pass without working anything out. A rule has to work something out.`,
    ]);
    // One that needs more right than that is not passed by the copy, as before.
    expect(runRule(mostly, tables, (share + 5) / 100).problems).toEqual([]);
    // And a copy in nine in ten is still the old, plainer refusal at any pass rate.
    const copy = runRule(
      bikeRule({ lookup: undefined, categories: [], expression: rounded(col('parts_cost')) }),
      tables,
      0.6,
    );
    expect(copy.problems).toEqual([
      'The answer is just the value of parts_cost, which needs no rule. A rule has to work something out.',
    ]);
  });

  it('refuses a condition whose side no row takes, and one that never changes an answer', () => {
    const noMembers = edited((_tickets, customers) => {
      for (const row of customers.slice(1)) row[3] = 'no';
    });
    const unused = runRule(bikeRule(), noMembers);
    expect(unused.candidates).toEqual([]);
    expect(unused.problems).toEqual([
      'The rule never changes an answer where member (customers.csv) is yes: no row of tickets.csv that can be worked out is like that. Add records where it does, or leave it out of the rule and say it is left open.',
    ]);

    const same = runRule(
      bikeRule({
        expression: rounded({
          op: 'add',
          args: [
            {
              op: 'if',
              when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
              then: billedHours,
              else: billedHours,
            },
            col('parts_cost'),
          ],
        }),
      }),
      bikeTables(bike),
    );
    expect(same.problems).toHaveLength(2);
    expect(same.problems[0]).toContain('the answer is the same on either side for all');
  });

  it('counts a side as changing an answer only when the final answer changes, not a difference the rounding wipes out', () => {
    const labor: RuleNode = { op: 'mul', args: [col('labor_hours'), num('65')] };
    const member = (more: string): RuleNode => ({
      op: 'if',
      when: { test: 'equals', column: 'member', from: 'lookup', value: 'yes' },
      then: { op: 'add', args: [col('parts_cost'), num(more)] },
      else: col('parts_cost'),
    });
    const withMore = (more: string) =>
      runRule(
        bikeRule({ expression: rounded({ op: 'add', args: [labor, member(more)] }) }),
        bikeTables(bike),
      );

    // A tenth of a cent more for members is a difference before the rounding and none after it.
    const wiped = withMore('0.001');
    expect(wiped.candidates).toEqual([]);
    expect(wiped.problems).toHaveLength(2);
    expect(wiped.problems[0]).toMatch(
      /^The rule never changes an answer where member \(customers\.csv\) is yes: the answer is the same on either side for all \d+ rows that are\./,
    );
    expect(wiped.problems[1]).toContain('where member (customers.csv) is no');
    // Five cents more is a difference in the answer, so both sides count.
    const real = withMore('0.05');
    expect(real.problems).toEqual([]);
    expect(real.outcome?.details.branches.map((branch) => branch.changes > 0)).toEqual([
      true,
      true,
    ]);
  });

  it('counts an operand of a smaller-of or larger-of only when leaving it out changes the final answer', () => {
    const labor: RuleNode = { op: 'mul', args: [col('labor_hours'), num('65')] };
    const result = runRule(
      bikeRule({
        lookup: undefined,
        categories: [],
        expression: rounded({
          op: 'add',
          args: [
            labor,
            {
              op: 'max',
              args: [col('parts_cost'), { op: 'add', args: [col('parts_cost'), num('0.001')] }],
            },
          ],
        }),
      }),
      bikeTables(bike),
    );
    expect(result.candidates).toEqual([]);
    // The first never wins. The second always does, but without it the answer is the same.
    expect(result.problems).toContainEqual(
      expect.stringMatching(
        /where parts cost is the larger one: no row of tickets\.csv that can be worked out is like that/,
      ),
    );
    expect(result.problems).toContainEqual(
      expect.stringMatching(
        /where parts cost plus 0\.001 is the larger one: the answer is the same without it for all \d+ rows that are/,
      ),
    );
  });

  it('refuses a cap that no row reaches, and a smaller-of whose one side always wins', () => {
    const capped = (limit: string) =>
      runRule(
        bikeRule({
          lookup: undefined,
          categories: [],
          expression: rounded({ op: 'min', args: [col('parts_cost'), num(limit)] }),
        }),
        bikeTables(bike),
      );
    const never = capped('999999');
    expect(never.candidates).toEqual([]);
    expect(never.problems).toContain(
      'The rule never changes an answer where 999999 is the smaller one: no row of tickets.csv that can be worked out is like that. Add records where it does, or leave it out of the rule and say it is left open.',
    );
    const works = capped('100');
    expect(works.problems).toEqual([]);
    expect(works.outcome?.details.branches.map((b) => [b.label, b.cases > 0])).toEqual([
      ['parts cost is the smaller one', true],
      ['100 is the smaller one', true],
    ]);
  });

  it('says when a rounding never changed a value, and keeps the rule', () => {
    const onGrid = bikeShop({ offGrid: false });
    const result = runRule(bikeRule(), bikeTables(onGrid));
    expect(result.problems).toEqual([]);
    // Said plainly, of any rounding step, and without the tie that the rule's own words give.
    expect(result.outcome?.details.flags).toContain(
      'None of your records needed rounding up to a multiple of 0.5, so no task tests it.',
    );
    expect(result.outcome?.details.flags).toContain(
      'None of your records needed rounding to the nearest cent, so no task tests it.',
    );
    expect(run().outcome?.details.flags).not.toContain(
      'None of your records needed rounding up to a multiple of 0.5, so no task tests it.',
    );
    // The hours are rounded the same way on both sides of the member test: one thing to say.
    expect(result.outcome?.details.flags).toHaveLength(2);
    expect(result.notes.filter((note) => note.includes('up to a multiple of 0.5'))).toHaveLength(1);
  });

  it('refuses a rule for which no row can be worked out, with the main reasons', () => {
    const none = edited((tickets) => {
      for (const row of tickets.slice(1)) row[1] = 'C-999';
    });
    const result = runRule(bikeRule(), none);
    expect(result.problems).toEqual([
      'No row of tickets.csv can be worked out: 160 because customer_id has no row in customers.csv.',
    ]);
  });

  it('turns an answer below zero into a left-out row, not a task', () => {
    const credit = edited((tickets) => {
      (tickets[1] as string[])[4] = '-5000.00';
    });
    const result = runRule(bikeRule(), credit);
    expect(result.problems).toEqual([]);
    expect(result.outcome?.details.excluded.map((item) => item.reason)).toContain(
      'the answer comes out below zero',
    );
  });
});

describe('rounding at an edge shows in the answers', () => {
  it('rounds half a cent up, which a member discount of 15% makes happen', () => {
    const result = run(bikeRule({ expression: bikeExpression('0.85') }));
    expect(result.problems).toEqual([]);
    const members = new Map(bike.customers.map((c) => [c.id, c.member]));
    const tickets = new Map(bike.tickets.map((t) => [t.id, t]));
    let ties = 0;
    for (const candidate of result.candidates) {
      const ticket = tickets.get(String(candidate.meta['key']));
      if (ticket === undefined || candidate.expected.kind !== 'answer') continue;
      const member = members.get(ticket.customerId) ?? false;
      // Labor in hundredths of a cent: 32.50 x 0.85 = 27.625 a half hour.
      const halfHours = Math.ceil(ticket.hours * 2 - 1e-9);
      const laborMilli = member ? halfHours * 27_625 : halfHours * 32_500;
      const cents = Math.floor((laborMilli + 5) / 10) + (ticket.partsCents ?? 0);
      if (member && (halfHours * 2762.5) % 1 === 0.5) ties += 1;
      expect((candidate.expected.value as { total: number }).total).toBe(cents / 100);
    }
    expect(ties).toBeGreaterThan(0);
    expect(result.outcome?.details.flags.join(' ')).not.toContain('to the nearest cent');
  });
});
