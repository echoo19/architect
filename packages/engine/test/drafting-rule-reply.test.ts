import { RuleSpecSchema } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { checkReply } from '../src/drafting/envelope';
import type { Attached } from '../src/drafting/files';
import type { TableBlank, TableMark } from '../src/drafting/rule-reply';
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

/**
 * The tickets' parts cost says N/A in places, which Architect asks the person about. These tests are
 * about something else, so the person has said to leave those rows out, as a rule always did.
 */
const leaveOut = (table: string): TableMark => ({
  table,
  column: 'parts_cost',
  mark: 'N/A',
  means: 'leave_out',
  question: `In ${table}, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost?`,
});

function check(
  rule: Parameters<typeof costType>[0],
  said: { description: string; answers: string; marks?: TableMark[] } = {
    description: '',
    answers: '',
  },
) {
  return checkReply(bikeDraft([costType(rule)]), {
    mustDraft: false,
    attached: attached(),
    said: { marks: [leaveOut('tickets.csv')], ...said },
  });
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

describe('what the person chose for an empty cell, table by table', () => {
  // Two tables with a column of the same name, both with empty cells in it.
  const EMPTY = {
    question: 'What should an empty parts cost count as?',
    options: [],
    changesAnswers: true,
    blankColumn: 'parts_cost',
    blankFrom: 'row',
  };
  const archive = (): Attached => {
    const base = attached();
    return {
      ...base,
      files: [
        ...base.files,
        {
          name: 'archive.csv',
          kind: 'table' as const,
          bytes: Buffer.from(bike.ticketsCsv),
          table: readTable('archive.csv', bike.ticketsCsv),
        },
      ],
    };
  };
  const SAID = { description: '', answers: 'Count it as zero' };
  const zeroForTickets: TableBlank = {
    table: 'tickets.csv',
    column: 'parts_cost',
    from: 'row',
    means: 'zero',
  };

  /** What the reply makes of a rule over one of the tables, given what the person has chosen. */
  function made(table: string, blanks: TableBlank[]) {
    const checked = checkReply(bikeDraft([costType({ ambiguities: [EMPTY] }, { table })]), {
      mustDraft: false,
      attached: archive(),
      said: { ...SAID, blanks, marks: [leaveOut('tickets.csv'), leaveOut('archive.csv')] },
    });
    if (!checked.ok || checked.reply.action !== 'draft') throw new Error('Expected a draft.');
    const [type] = checked.reply.job.types;
    return { spec: type?.spec, asked: type?.ambiguities };
  }

  it('counts an empty cell as zero in the table the person said so for, and asks nothing more of it', () => {
    const { spec, asked } = made('tickets.csv', [zeroForTickets]);
    expect(asked).toBeUndefined();
    expect(spec?.template === 'rule' && spec.emptyMeansZero).toEqual([
      { column: 'parts_cost', from: 'row' },
    ]);
  });

  it('does not take that answer for a column of the same name in another table, and asks about it', () => {
    const { spec, asked } = made('archive.csv', [zeroForTickets]);
    expect(spec?.template === 'rule' && spec.emptyMeansZero).toBeUndefined();
    expect(asked).toEqual([
      {
        question: EMPTY.question,
        options: ['Count it as zero', 'Leave those rows out'],
        blank: { table: 'archive.csv', column: 'parts_cost', from: 'row' },
      },
    ]);
  });

  it('keeps what was chosen for each table apart when both have been answered', () => {
    const blanks: TableBlank[] = [
      zeroForTickets,
      { table: 'archive.csv', column: 'parts_cost', from: 'row', means: 'leave_out' },
    ];
    expect(made('tickets.csv', blanks).spec).toMatchObject({
      emptyMeansZero: [{ column: 'parts_cost', from: 'row' }],
    });
    const other = made('archive.csv', blanks);
    expect(other.asked).toBeUndefined();
    expect(other.spec?.template === 'rule' && other.spec.emptyMeansZero).toBeUndefined();
  });

  it('knows the table by the name it was attached under, whatever the case or spacing', () => {
    const { asked } = made('tickets.csv', [{ ...zeroForTickets, table: ' Tickets.CSV ' }]);
    expect(asked).toBeUndefined();
  });
});

describe('what the person chose for a mark such as N/A, mark by mark and table by table', () => {
  // The tickets, and an archive of them in which some of the N/A are dashes.
  const archiveCsv = bike.ticketsCsv.replace(/,N\/A\n/g, (found, at: number) =>
    at % 3 === 0 ? ',-\n' : found,
  );
  const both = (): Attached => {
    const base = attached();
    return {
      ...base,
      files: [
        ...base.files,
        {
          name: 'archive.csv',
          kind: 'table' as const,
          bytes: Buffer.from(archiveCsv),
          table: readTable('archive.csv', archiveCsv),
        },
      ],
    };
  };
  const answer = (
    table: string,
    mark: string,
    means: TableMark['means'],
    column = 'parts_cost',
  ): TableMark => ({
    table,
    column,
    mark,
    means,
    question: `In ${table}, ${column} sometimes says "${mark}". Does "${mark}" mean no ${column}?`,
  });

  /** What the reply makes of the rule over one table, given what the person has chosen so far. */
  function made(
    table: string,
    marks: TableMark[],
    rule: Parameters<typeof costType>[0] = {},
    files: Attached = both(),
  ) {
    const checked = checkReply(bikeDraft([costType(rule, { table })]), {
      mustDraft: false,
      attached: files,
      said: { description: '', answers: '', marks },
    });
    if (!checked.ok || checked.reply.action !== 'draft') {
      throw new Error(checked.ok ? 'Expected a draft.' : checked.problems.join(' '));
    }
    const [type] = checked.reply.job.types;
    return { spec: type?.spec, asked: type?.ambiguities };
  }

  const tokensOf = (spec: ReturnType<typeof made>['spec']) =>
    spec?.template === 'rule' ? spec.placeholderMeansZero : undefined;

  it('asks for a mark the teacher raised nothing about, once for each, the most common first', () => {
    const { asked, spec } = made('archive.csv', []);
    expect(tokensOf(spec)).toBeUndefined();
    expect(asked?.map((item) => item.mark)).toEqual([
      { table: 'archive.csv', column: 'parts_cost', mark: 'N/A' },
      { table: 'archive.csv', column: 'parts_cost', mark: '-' },
    ]);
    expect(asked?.[0]?.options).toEqual(['Count it as zero', 'Leave those rows out']);
    expect(asked?.[0]?.question).toBe(
      'In archive.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out.',
    );
    expect(asked?.[1]?.question).toContain('has a dash ("-") where a number should be');
  });

  it("asks the teacher's own questions first, and its own after them", () => {
    const open = {
      question: 'Does the discount apply to parts?',
      options: ['No', 'Yes'],
      changesAnswers: true,
    };
    const { asked } = made('archive.csv', [], { ambiguities: [open] });
    expect(asked?.map((item) => item.question)).toEqual([
      open.question,
      expect.stringContaining('sometimes says "N/A"'),
      expect.stringContaining('sometimes has a dash'),
    ]);
    expect(asked?.map((item) => item.mark !== undefined)).toEqual([false, true, true]);
  });

  it('counts as zero the marks the person said so for, and asks only about the rest', () => {
    const { asked, spec } = made('archive.csv', [answer('archive.csv', 'N/A', 'zero')]);
    expect(tokensOf(spec)).toEqual([{ column: 'parts_cost', from: 'row', tokens: ['N/A'] }]);
    expect(asked?.map((item) => item.mark?.mark)).toEqual(['-']);
    // The rule rests on the answer: it is a passage, beside the question it was given to.
    expect(spec?.template === 'rule' && spec.sources.at(-1)).toEqual({
      file: 'answers',
      passage: 'Count it as zero',
      question: 'In archive.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts_cost?',
    });
  });

  it('keeps leaving out as an answer: it is not asked again, and the rule is not changed by it', () => {
    const { asked, spec } = made('archive.csv', [
      answer('archive.csv', 'N/A', 'leave_out'),
      answer('archive.csv', '-', 'leave_out'),
    ]);
    expect(asked).toBeUndefined();
    expect(tokensOf(spec)).toBeUndefined();
    expect(spec?.template === 'rule' && spec.sources).toHaveLength(2);
  });

  it('takes n/a for N/A, but a dash for neither, one table for another, or one column for another', () => {
    // n/a and N/A are one mark.
    const same = made('archive.csv', [
      answer('archive.csv', 'n/a', 'zero'),
      answer('archive.csv', '-', 'leave_out'),
    ]);
    expect(same.asked).toBeUndefined();
    expect(tokensOf(same.spec)).toEqual([{ column: 'parts_cost', from: 'row', tokens: ['N/A'] }]);
    // The tickets' answer is not the archive's, and the archive's dash is not N/A.
    const { asked, spec } = made('archive.csv', [
      answer('tickets.csv', 'N/A', 'zero'),
      answer('archive.csv', '-', 'zero'),
    ]);
    expect(asked?.map((item) => item.mark?.mark)).toEqual(['N/A']);
    expect(tokensOf(spec)).toEqual([{ column: 'parts_cost', from: 'row', tokens: ['-'] }]);
    // Another column of the same table is a question of its own.
    const other = made('archive.csv', [answer('archive.csv', 'N/A', 'zero', 'labor_hours')]);
    expect(other.asked?.map((item) => item.mark?.mark)).toEqual(['N/A', '-']);
    expect(tokensOf(other.spec)).toBeUndefined();
  });

  it('knows the table and the column by the name they were attached under, whatever the case or spacing', () => {
    const { asked, spec } = made('tickets.csv', [
      { ...answer(' Tickets.CSV ', 'N/A', 'zero'), column: ' PARTS_COST ' },
    ]);
    expect(asked).toBeUndefined();
    expect(tokensOf(spec)).toEqual([{ column: 'parts_cost', from: 'row', tokens: ['N/A'] }]);
  });

  it('asks nothing of a column the rule does not add up', () => {
    // The status says N/A in places too, but the rule reads the hours and the parts cost only.
    const sheet = bike.ticketsCsv.replace(/,Open,/g, ',N/A,');
    expect(sheet).not.toBe(bike.ticketsCsv);
    const files = attached();
    const tickets = files.files.find((file) => file.name === 'tickets.csv');
    if (tickets === undefined) throw new Error('No tickets.');
    tickets.table = readTable('tickets.csv', sheet);
    const { asked } = made('tickets.csv', [answer('tickets.csv', 'N/A', 'leave_out')], {}, files);
    expect(asked).toBeUndefined();
  });

  it('asks nothing about a column of numbers the rule does not add up', () => {
    // The rule reads the hours only. The parts cost says N/A in places, but it is not in the rule.
    const hoursOnly = alone(
      [
        step('hours', 'col', { column: 'labor_hours', from: 'row' }),
        step('rate', 'num', { value: '65' }),
        step('price', 'mul', { args: ['hours', 'rate'] }),
        step('total', 'round', { value: '0.01', mode: 'half_up', args: ['price'] }),
      ],
      'total',
    );
    const { asked, spec } = made('tickets.csv', [], hoursOnly);
    expect(asked).toBeUndefined();
    expect(tokensOf(spec)).toBeUndefined();
  });

  it('asks nothing about a column that holds words, even when the rule reads it as a number', () => {
    // The rule is wrong to add up a status, and runRule says so. The person is not asked about it.
    const sheet = bike.ticketsCsv.replace(/,Open,/g, ',N/A,');
    const files = attached();
    const tickets = files.files.find((file) => file.name === 'tickets.csv');
    if (tickets === undefined) throw new Error('No tickets.');
    tickets.table = readTable('tickets.csv', sheet);
    const status = alone(
      [
        step('hours', 'col', { column: 'labor_hours', from: 'row' }),
        step('state', 'col', { column: 'status', from: 'row' }),
        step('sum', 'add', { args: ['hours', 'state'] }),
        step('total', 'round', { value: '0.01', mode: 'half_up', args: ['sum'] }),
      ],
      'total',
    );
    const { asked } = made('tickets.csv', [], status, files);
    expect(asked).toBeUndefined();
  });

  it('holds the teacher to eight passages, so that the answers Architect adds always have room', () => {
    const passages = [
      'Labor is billed',
      'at $65 an hour',
      'in half-hour steps',
      'Members get 10% off labor',
      'never off parts',
      'A ticket is still open',
      'Waiting on parts',
      'Picked up means',
      'Parts costs are what the shop paid',
    ].map((passage) => ({ file: 'policy.md', passage }));
    expect(problemsOf({ sources: passages })).toEqual([
      'Task type "cost": a rule quotes at most 8 passages. Quote just the sentences it rests on.',
    ]);
    const { spec } = made('tickets.csv', [answer('tickets.csv', 'N/A', 'zero')], {
      sources: passages.slice(0, 8),
    });
    expect(spec?.template === 'rule' && spec.sources).toHaveLength(9);
    expect(tokensOf(spec)).toBeDefined();
  });
});
