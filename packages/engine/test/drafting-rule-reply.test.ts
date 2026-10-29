import { RuleSpecSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { checkReply } from '../src/drafting/envelope';
import type { Attached } from '../src/drafting/files';
import { readTable } from '../src/drafting/table';
import { bikeShop, POLICY } from './support/rule-data';
import { bikeDraft, costType, step, wireBike, wireCol, wireNum } from './support/rule-draft';

const bike = bikeShop();

function attached(): Attached {
  const table = (name: string, text: string) => ({
    name,
    kind: 'table' as const,
    bytes: Buffer.from(text),
    table: readTable(name, text),
  });
  return {
    files: [
      table('customers.csv', bike.customersCsv),
      table('tickets.csv', bike.ticketsCsv),
      { name: 'policy.md', kind: 'text', bytes: Buffer.from(POLICY), text: POLICY },
    ],
    tasks: null,
  };
}

function check(rule: Parameters<typeof costType>[0], said = { description: '', answers: '' }) {
  return checkReply(bikeDraft([costType(rule)]), { mustDraft: false, attached: attached(), said });
}

function problemsOf(rule: Parameters<typeof costType>[0]): string[] {
  const checked = check(rule);
  return checked.ok ? [] : checked.problems;
}

describe('a rule in the reply', () => {
  it('becomes a typed rule, with its columns, its categories and its lookup', () => {
    const checked = check({});
    if (!checked.ok || checked.reply.action !== 'draft') throw new Error('Expected a draft.');
    const [type] = checked.reply.job.types;
    expect(type?.ambiguities).toBeUndefined();
    const spec = type?.spec;
    expect(RuleSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec).toMatchObject({
      template: 'rule',
      table: 'tickets.csv',
      keyColumn: 'ticket_id',
      answerName: 'total',
      currency: 'USD',
      lookup: { table: 'customers.csv', keyColumn: 'customer_id', matchColumn: 'customer_id' },
      categories: [{ column: 'member', from: 'lookup', values: ['yes', 'no'] }],
      expression: { op: 'round', increment: '0.01', mode: 'half_up' },
    });
    expect(spec?.template === 'rule' && spec.sources).toHaveLength(2);
  });

  it('says where a step is wrong, in the numbers of its place in the rule', () => {
    expect(problemsOf({ expression: step('sum') })).toEqual([
      'Step 1 is "sum", which is not an operation. The operations are num, col, add, sub, mul, div, min, max, round and if.',
    ]);
    expect(problemsOf({ expression: step('', {}) })).toEqual(['Step 1 has no operation.']);
    const sub = step('sub', { args: [wireCol('a'), wireCol('b'), wireCol('c')] });
    expect(
      problemsOf({ expression: step('round', { value: '1', mode: 'up', args: [sub] }) }),
    ).toEqual(['Step 1.1 is "sub" with 3 steps inside it, and it takes 2.']);
    expect(
      problemsOf({
        expression: step('round', {
          value: '1',
          mode: 'up',
          args: [step('add', { args: [wireNum('1')] })],
        }),
      }),
    ).toEqual(['Step 1.1 is "add" with 1 step inside it, and it takes 2 to 4.']);
    expect(
      problemsOf({ expression: step('round', { value: '0.01', args: [wireNum('1')] }) }),
    ).toEqual(['Step 1 is a rounding with no mode. Use up, down or half_up.']);
    expect(
      problemsOf({
        expression: step('round', { value: 'cent', mode: 'up', args: [wireNum('1')] }),
      }),
    ).toEqual([
      'Step 1 rounds to "cent", which is not a number. Give the step size, such as 0.01.',
    ]);
    expect(
      problemsOf({
        expression: step('round', { value: '1', mode: 'up', args: [wireNum('1e3')] }),
      }),
    ).toEqual([
      'Step 1.1 is a number, but "1e3" is not one. Write digits and at most one point, such as 65 or 0.1.',
    ]);
  });

  it('wants a test first inside an if, and says there is no "not"', () => {
    const wrong = step('if', { args: [wireCol('member'), wireNum('1'), wireNum('2')] });
    expect(
      problemsOf({ expression: step('round', { value: '1', mode: 'up', args: [wrong] }) }),
    ).toEqual([
      'The first step inside an if (1.1.1) must be a test: equals, in, gt, gte, lt or lte, not "col". There is no "not": test for the values that count.',
    ]);
    const not = step('if', {
      args: [step('not_equals', { column: 'member', value: 'no' }), wireNum('1'), wireNum('2')],
    });
    expect(
      problemsOf({ expression: step('round', { value: '1', mode: 'up', args: [not] }) })[0],
    ).toContain('not "not_equals"');
    const gate = step('if', {
      args: [
        step('gt', { value: '8', args: [wireCol('labor_hours')] }),
        wireNum('1'),
        wireNum('2'),
      ],
    });
    expect(
      problemsOf({
        lookupTable: '',
        lookupKey: '',
        matchColumn: '',
        categories: [],
        expression: step('round', { value: '1', mode: 'up', args: [gate] }),
      }),
    ).toEqual([]);
  });

  it('wants a lookup to name its key and its table to be one that was attached', () => {
    expect(problemsOf({ lookupTable: 'staff.csv' })).toEqual([
      'Task type "cost": the lookup names "staff.csv", which isn\'t one of the attached CSV files (customers.csv, tickets.csv).',
    ]);
    expect(problemsOf({ lookupKey: '' })).toEqual([
      'Task type "cost": a lookup needs lookupKey and matchColumn.',
    ]);
    expect(
      problemsOf({
        expression: wireBike(),
        ambiguities: [{ question: '', options: [], changesAnswers: true }],
      }),
    ).toEqual([
      'Task type "cost": an open question that changes an answer needs the question and 2 to 4 different options.',
    ]);
  });
});

describe('the passages a rule quotes', () => {
  it('are found word for word, however the policy writes them, and kept as the policy writes them', () => {
    const checked = check({
      sources: [
        { file: 'policy.md', passage: '- Labor is billed at $65 an hour, in half-hour steps.' },
        { file: 'policy.md', passage: 'MEMBERS get 10% off   labor, never off parts.' },
      ],
    });
    if (!checked.ok || checked.reply.action !== 'draft') throw new Error('Expected a draft.');
    const spec = checked.reply.job.types[0]?.spec;
    expect(spec?.template === 'rule' && spec.sources).toEqual([
      { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
      { file: 'policy.md', passage: 'MEMBERS get 10% off labor, never off parts.' },
    ]);
  });

  it("may be the person's own description or answer, and are found there", () => {
    const said = {
      description: 'We charge by the half hour.',
      answers: 'Parts are at cost.',
    };
    const checked = check(
      {
        sources: [
          { file: 'description', passage: 'We charge by the half hour.' },
          { file: 'answers', passage: 'Parts are at cost.' },
        ],
      },
      said,
    );
    expect(checked.ok).toBe(true);
    const missing = check(
      { sources: [{ file: 'answers', passage: 'Parts are at cost.' }] },
      { description: '', answers: '' },
    );
    expect(missing.ok).toBe(false);
  });

  it('must be there, and are not paraphrased, not long, and not left out', () => {
    expect(problemsOf({ sources: [] })).toEqual([
      'Task type "cost": a rule has to quote the passages of the policy it comes from, word for word, in sources.',
    ]);
    expect(
      problemsOf({ sources: [{ file: 'policy.md', passage: 'Labor is $65 an hour.' }] })[0],
    ).toContain(
      '"Labor is $65 an hour." is not in the policy or in what the person said, word for word',
    );
    const long = 'Labor '.repeat(150);
    expect(problemsOf({ sources: [{ file: 'policy.md', passage: long }] })[0]).toContain(
      'longer than 600 characters',
    );
  });
});
