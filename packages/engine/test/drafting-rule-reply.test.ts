import { RuleSpecSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { checkReply } from '../src/drafting/envelope';
import type { Attached } from '../src/drafting/files';
import { WireStepSchema } from '../src/drafting/rule-steps';
import { readTable } from '../src/drafting/table';
import { bikeShop, POLICY } from './support/rule-data';
import { bikeDraft, costType, step } from './support/rule-draft';

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

/** A rule worked out in steps without a lookup, for the problems of the steps alone. */
const alone = (steps: ReturnType<typeof step>[], result: string) => ({
  lookupTable: '',
  lookupKey: '',
  matchColumn: '',
  categories: [],
  steps,
  result,
});

const WHO = 'Task type "cost": ';

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

  it('is a tree once the steps are put together, a step used twice standing in both places', () => {
    const checked = check({});
    if (!checked.ok || checked.reply.action !== 'draft') throw new Error('Expected a draft.');
    const spec = checked.reply.job.types[0]?.spec;
    if (spec?.template !== 'rule') throw new Error('Expected a rule.');
    const sum = spec.expression.op === 'round' ? spec.expression.arg : null;
    const labor = sum?.op === 'add' ? sum.args[0] : null;
    if (labor?.op !== 'if') throw new Error('Expected an if.');
    const hours = { op: 'round', increment: '0.5', mode: 'up' };
    expect(labor.then).toMatchObject({ op: 'mul', args: [hours, { op: 'num', value: '65' }, {}] });
    expect(labor.else).toMatchObject({ op: 'mul', args: [hours, { op: 'num', value: '65' }] });
    expect(labor.when).toEqual({ test: 'equals', column: 'member', from: 'lookup', value: 'yes' });
  });

  it('takes a number written without quotes for the same number in quotes', () => {
    expect(WireStepSchema.parse({ id: 'rate', op: 'num', value: 65 }).value).toBe('65');
    expect(WireStepSchema.parse({ id: 'rate', op: 'num', value: 0.1 }).value).toBe('0.1');
    expect(WireStepSchema.parse({ id: 'rate', op: 'num', value: '65' }).value).toBe('65');
    const column = WireStepSchema.parse({ id: 'hours', op: 'col', column: 'labor_hours' });
    expect(column.value).toBeUndefined();
  });

  it('says which step is wrong, by the id the teacher gave it', () => {
    expect(problemsOf(alone([step('x', 'sum')], 'x'))).toEqual([
      `${WHO}Step "x" is "sum", which is not an operation. The operations are num, col, add, sub, mul, div, min, max, round and if.`,
    ]);
    expect(problemsOf(alone([step('x', '')], 'x'))).toEqual([`${WHO}Step "x" has no operation.`]);
    const three = [
      step('a', 'col', { column: 'labor_hours' }),
      step('b', 'col', { column: 'parts_cost' }),
      step('c', 'col', { column: 'ticket_id' }),
      step('d', 'sub', { args: ['a', 'b', 'c'] }),
      step('e', 'round', { value: '1', mode: 'up', args: ['d'] }),
    ];
    expect(problemsOf(alone(three, 'e'))).toEqual([
      `${WHO}Step "d" is "sub" with 3 steps inside it, and it takes 2.`,
    ]);
    const one = [
      step('a', 'num', { value: '1' }),
      step('s', 'add', { args: ['a'] }),
      step('r', 'round', { value: '1', mode: 'up', args: ['s'] }),
    ];
    expect(problemsOf(alone(one, 'r'))).toEqual([
      `${WHO}Step "s" is "add" with 1 step inside it, and it takes 2 to 4.`,
    ]);
    const round = (fields: Partial<ReturnType<typeof step>>) => [
      step('a', 'num', { value: '1' }),
      step('r', 'round', { args: ['a'], ...fields }),
    ];
    expect(problemsOf(alone(round({ value: '0.01' }), 'r'))).toEqual([
      `${WHO}Step "r" is a rounding with no mode. Use up, down or half_up.`,
    ]);
    expect(problemsOf(alone(round({ value: 'cent', mode: 'up' }), 'r'))).toEqual([
      `${WHO}Step "r" rounds to "cent", which is not a number. Give the step size, such as 0.01.`,
    ]);
    const odd = [
      step('n', 'num', { value: '1e3' }),
      step('r', 'round', { value: '1', mode: 'up', args: ['n'] }),
    ];
    expect(problemsOf(alone(odd, 'r'))).toEqual([
      `${WHO}Step "n" is a number, but "1e3" is not one. Write digits and at most one point, such as 65 or 0.1.`,
    ]);
  });

  it('says what is wrong with how the steps fit together', () => {
    const rounded = (args: string[]) => step('r', 'round', { value: '1', mode: 'up', args });
    expect(problemsOf(alone([rounded(['ghost'])], 'r'))).toEqual([
      `${WHO}Step "r" uses "ghost", which is not one of the steps.`,
    ]);
    expect(problemsOf(alone([rounded(['r'])], 'r'))).toEqual([
      `${WHO}The steps "r", then "r" use each other in a circle.`,
    ]);
    const loop = [
      step('a', 'round', { value: '1', mode: 'up', args: ['b'] }),
      step('b', 'round', { value: '1', mode: 'up', args: ['a'] }),
    ];
    expect(problemsOf(alone(loop, 'a'))).toEqual([
      `${WHO}The steps "a", then "b", then "a" use each other in a circle.`,
    ]);
    const twice = [step('a', 'num', { value: '1' }), step('a', 'num', { value: '2' })];
    expect(problemsOf(alone(twice, 'a'))).toEqual([
      `${WHO}Two steps of the rule are called "a". Every step needs its own id.`,
    ]);
    const extra = [
      step('a', 'num', { value: '1' }),
      step('b', 'num', { value: '2' }),
      rounded(['a']),
    ];
    expect(problemsOf(alone(extra, 'r'))).toEqual([
      `${WHO}Step "b" is not used by the rule. Leave it out, or use it.`,
    ]);
    expect(problemsOf(alone([], ''))).toEqual([`${WHO}The rule has no steps.`]);
    expect(problemsOf(alone([step('a', 'num', { value: '1' })], 'z'))).toEqual([
      `${WHO}result names "z", which is not one of the steps. Name the id of the last step, the rounding that gives the answer.`,
    ]);
  });

  it('does not let a step used over and over make a rule too big to count', () => {
    // Twenty steps that each use the one before twice: a million parts once they are all counted.
    const doubling = [
      step('s0', 'num', { value: '1' }),
      ...Array.from({ length: 20 }, (_, i) =>
        step(`s${i + 1}`, 'add', { args: [`s${i}`, `s${i}`] }),
      ),
      step('r', 'round', { value: '1', mode: 'up', args: ['s20'] }),
    ];
    const problems = problemsOf(alone(doubling, 'r'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('The rule uses its steps over and over');
    expect(problems[0]).toContain('more than 128 parts, and the most is 32');
  });

  it('wants a test for an if, and says there is no "not"', () => {
    const rounded = (args: string[]) => step('r', 'round', { value: '1', mode: 'up', args });
    const steps = (test: ReturnType<typeof step>) => [
      step('one', 'num', { value: '1' }),
      step('two', 'num', { value: '2' }),
      test,
      step('pick', 'if', { args: [test.id, 'one', 'two'] }),
      rounded(['pick']),
    ];
    expect(problemsOf(alone(steps(step('t', 'col', { column: 'member' })), 'r'))).toEqual([
      `${WHO}"t" is used as the test of an if, so it must be a test: equals, in, gt, gte, lt or lte, not "col". There is no "not": test for the values that count.`,
    ]);
    expect(
      problemsOf(alone(steps(step('t', 'not_equals', { column: 'member', value: 'no' })), 'r'))[0],
    ).toContain('not "not_equals"');
    expect(problemsOf(alone(steps(step('t', 'equals', { column: 'member' })), 'r'))).toEqual([
      `${WHO}Test "t" (equals) needs a column and a value.`,
    ]);
    const threshold = [
      step('hours', 'col', { column: 'labor_hours' }),
      step('long', 'gt', { value: '8', args: ['hours'] }),
      step('one', 'num', { value: '1' }),
      step('two', 'num', { value: '2' }),
      step('pick', 'if', { args: ['long', 'one', 'two'] }),
      rounded(['pick']),
    ];
    expect(problemsOf(alone(threshold, 'r'))).toEqual([]);
    expect(
      problemsOf(
        alone(
          threshold.map((s) => (s.id === 'long' ? { ...s, value: 'many' } : s)),
          'r',
        ),
      ),
    ).toEqual([`${WHO}Test "long" (gt) needs a number to compare with, not "many".`]);
  });

  it('wants a lookup to name its key and its table to be one that was attached', () => {
    expect(problemsOf({ lookupTable: 'staff.csv' })).toEqual([
      'Task type "cost": the lookup names "staff.csv", which isn\'t one of the attached CSV files (customers.csv, tickets.csv).',
    ]);
    expect(problemsOf({ lookupKey: '' })).toEqual([
      'Task type "cost": a lookup needs lookupKey and matchColumn.',
    ]);
    expect(
      problemsOf({ ambiguities: [{ question: '', options: [], changesAnswers: true }] }),
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
