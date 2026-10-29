import { describe, expect, it } from 'vitest';
import { checkReply, DRAFT_NOW, replyJsonSchema, type Understood } from '../src/drafting/envelope';
import type { Attached } from '../src/drafting/files';
import { readTable } from '../src/drafting/table';
import {
  draft,
  EMAIL_TYPE,
  NO_TYPE,
  PENDING_TYPE,
  question,
  TOTAL_TYPE,
} from './support/drafting-world';

/** Two tables and a text file, as the conversation holds them. */
function attached(tasks: Attached['tasks'] = null): Attached {
  const table = (name: string, text: string) => ({
    name,
    kind: 'table' as const,
    bytes: Buffer.from(text),
    table: readTable(name, text),
  });
  return {
    files: [
      table('customers.csv', 'customer_id,email\nC-1,a@example.com\n'),
      table('orders.csv', 'order_id,status\nO-1,Pending\n'),
      { name: 'policy.md', kind: 'text', bytes: Buffer.from('# Policy'), text: '# Policy' },
    ],
    tasks,
  };
}

function jobOf(reply: Understood | undefined) {
  if (reply?.action !== 'draft') throw new Error('Expected a draft.');
  return reply.job;
}

function check(raw: unknown, mustDraft = false, files: Attached = attached()) {
  return checkReply(raw, { mustDraft, attached: files });
}

describe('holding a reply to the format', () => {
  it('asks for a reply that can ask or draft, and only draft when it must', () => {
    const schema = replyJsonSchema(false);
    expect(schema['required']).toEqual(['action', 'message', 'options', 'job']);
    expect(schema['additionalProperties']).toBe(false);
    const actions = (value: ReturnType<typeof replyJsonSchema>) =>
      (value['properties'] as { action: { enum: string[] } }).action.enum;
    expect(actions(schema)).toEqual(['ask', 'draft']);
    expect(actions(replyJsonSchema(true))).toEqual(['draft']);
  });

  it('says what is wrong with a reply that is not in the format', () => {
    for (const raw of [null, 'text', { action: 'maybe' }, { action: 'ask' }]) {
      const checked = check(raw);
      expect(checked.ok).toBe(false);
      if (!checked.ok) {
        expect(checked.problems[0]).toMatch(/^The reply doesn't have the shape asked for/);
      }
    }
  });
});

describe('a question', () => {
  it('needs two to four different options, and leaves the app to add "Draft it now"', () => {
    const ok = check(
      question('Which region?', [' North ', 'north', 'South', DRAFT_NOW.toLowerCase()]),
    );
    expect(ok).toEqual({
      ok: true,
      reply: { action: 'ask', message: 'Which region?', options: ['North', 'South'] },
    });
    for (const options of [['Only one'], ['a', 'b', 'c', 'd', 'e'], ['same', 'Same'], []]) {
      const checked = check(question('Which region?', options));
      expect(checked.ok).toBe(false);
      if (!checked.ok)
        expect(checked.problems[0]).toContain('A question needs 2 to 4 different options');
    }
    const empty = check(question('   ', ['a', 'b']));
    expect(empty).toEqual({ ok: false, problems: ['The question is empty.'] });
  });

  it('is refused when the teacher must draft', () => {
    expect(check(question('One more?', ['a', 'b']), true)).toEqual({
      ok: false,
      problems: ['Draft the job now. Do not ask another question.'],
    });
  });

  it('keeps a long option or question to a length a screen can hold', () => {
    const checked = check(question('word '.repeat(300), ['x'.repeat(200), 'b']));
    if (!checked.ok || checked.reply.action !== 'ask') throw new Error('Expected a question.');
    expect(checked.reply.message.length).toBeLessThanOrEqual(600);
    expect(checked.reply.options[0]?.length).toBeLessThanOrEqual(80);
  });
});

describe('a draft', () => {
  it('becomes a job with its files described and its kinds of task as specifications', () => {
    const checked = check(
      draft({ unresolved: ['Whether cancelled orders count.', 'whether cancelled orders count.'] }),
    );
    const job = jobOf(checked.ok ? checked.reply : undefined);
    expect(job).toMatchObject({
      name: 'Shop desk',
      businessDate: '2026-11-24',
      passRate: 0.9,
      unresolved: ['Whether cancelled orders count.'],
    });
    expect(job.files).toEqual([
      { name: 'customers.csv', description: 'One row per customer.', access: 'read' },
      { name: 'orders.csv', description: 'One row per order.', access: 'read' },
      { name: 'policy.md', description: '', access: 'read' },
    ]);
    expect(job.types.map((type) => [type.id, type.spec?.template])).toEqual([
      ['email', 'lookup'],
      ['pending', 'filtered_list'],
      ['totals', 'group_total'],
    ]);
    expect(job.types[1]?.spec).toMatchObject({
      template: 'filtered_list',
      filters: [
        { column: 'status', op: 'equals', value: 'Pending', varies: false },
        { column: 'customer_id', op: 'equals', varies: true },
      ],
    });
    // A varying filter carries no value, since each of its column's values is taken in turn.
    expect(job.types[1]?.spec).not.toMatchObject({ filters: [{}, { value: '' }] });
  });

  it('reads a pass rate written as a percentage, and refuses one that is out of range', () => {
    const rate = (passRate: number) => check(draft({ passRate } as never));
    expect(jobOf((rate(90) as { reply: Understood }).reply).passRate).toBe(0.9);
    expect(rate(0.3)).toEqual({
      ok: false,
      problems: ['passRate 0.3 must be between 0.5 and 1, such as 0.9.'],
    });
    expect(rate(0)).toMatchObject({ ok: false });
  });

  it('refuses a date that is not one, and a file that was not attached', () => {
    const bad = check(
      draft({
        businessDate: 'tomorrow',
        files: [{ name: 'invoices.csv', description: 'x', access: 'read' }],
      }),
    );
    expect(bad).toEqual({
      ok: false,
      problems: [
        'businessDate "tomorrow" isn\'t a date like 2026-11-24. Leave it empty if it isn\'t stated.',
        'The file "invoices.csv" wasn\'t attached. The attached files are customers.csv, orders.csv, policy.md.',
      ],
    });
    const nested = check(
      draft({ files: [{ name: 'data/Customers.CSV', description: 'x', access: 'write' }] }),
    );
    const job = jobOf(nested.ok ? nested.reply : undefined);
    expect(job.files[0]).toEqual({ name: 'customers.csv', description: 'x', access: 'write' });
  });

  it('needs one to three kinds of task, each with what its template asks for', () => {
    const none = check(draft({ taskTypes: [] }));
    expect(none).toEqual({ ok: false, problems: ['Choose 1 to 3 task types. There were 0.'] });
    const four = check(
      draft({ taskTypes: [EMAIL_TYPE, PENDING_TYPE, TOTAL_TYPE, { ...EMAIL_TYPE, id: 'more' }] }),
    );
    expect(four).toEqual({ ok: false, problems: ['Choose 1 to 3 task types. There were 4.'] });

    const problems = (types: object[]) => {
      const checked = check(draft({ taskTypes: types }));
      return checked.ok ? [] : checked.problems;
    };
    expect(problems([{ ...EMAIL_TYPE, id: 'Bad Id' }])).toEqual([
      'The task type id "Bad Id" must be lowercase letters, digits and underscores, starting with a letter.',
    ]);
    expect(problems([EMAIL_TYPE, EMAIL_TYPE])).toEqual(['The task type id "email" is used twice.']);
    expect(problems([{ ...EMAIL_TYPE, template: '' }])).toEqual([
      'Task type "email" needs a template: lookup, filtered_list, group_total or rule.',
    ]);
    expect(problems([{ ...EMAIL_TYPE, table: 'policy.md' }])[0]).toContain(
      'names the table "policy.md", which isn\'t one of the attached CSV files (customers.csv, orders.csv)',
    );
    expect(problems([{ ...EMAIL_TYPE, columns: [] }])).toEqual([
      'Task type "email" is a lookup: it needs a keyColumn and 1 to 3 columns.',
    ]);
    expect(problems([{ ...PENDING_TYPE, filters: [] }])).toEqual([
      'Task type "pending" is a filtered_list: it needs a keyColumn and 1 to 4 filters.',
    ]);
    expect(problems([{ ...TOTAL_TYPE, measure: '' }])).toEqual([
      'Task type "totals" is a group_total: it needs a groupColumn and a measure.',
    ]);
    expect(problems([{ ...EMAIL_TYPE, request: '  ' }])).toEqual([
      'Task type "email" needs a request.',
    ]);
    expect(
      problems([
        {
          ...NO_TYPE,
          id: 'plain',
          label: 'Plain',
          template: 'lookup',
          table: 'customers.csv',
          request: 'What is {key}?',
        },
      ])[0],
    ).toContain('is a lookup');
  });

  it('takes a set of values to keep, and refuses a filter that says what a row is not', () => {
    const filters = (kept: object) => [
      kept,
      { column: 'customer_id', op: 'equals', value: '', varies: true },
    ];
    const status = { column: 'status', value: '', varies: false };
    const set = check(
      draft({
        taskTypes: [
          {
            ...PENDING_TYPE,
            filters: filters({ ...status, op: 'in', values: [' Open ', 'open', 'Ready'] }),
          },
        ],
      }),
    );
    const job = jobOf(set.ok ? set.reply : undefined);
    expect(job.types[0]?.spec).toMatchObject({
      template: 'filtered_list',
      filters: [{ column: 'status', op: 'in', values: ['Open', 'Ready'], varies: false }, {}],
    });

    const complement = check(
      draft({
        taskTypes: [
          {
            ...PENDING_TYPE,
            filters: filters({ ...status, op: 'not_equals', value: 'Picked up' }),
          },
        ],
      }),
    );
    expect(complement.ok).toBe(false);
    if (!complement.ok) {
      expect(complement.problems).toEqual([
        'Task type "pending": the filter on status says what a row is not. That also keeps rows where it is empty or has a value nobody expected. Use op "in" and list every value that makes a row count, as the policy or the person names them.',
      ]);
    }

    // The format the teacher is held to offers the set and no longer offers "is not".
    const schema = replyJsonSchema(false) as unknown as {
      properties: {
        job: {
          properties: {
            taskTypes: {
              items: {
                properties: {
                  filters: {
                    items: { properties: { op: { enum: string[] }; values: { type: string } } };
                  };
                };
              };
            };
          };
        };
      };
    };
    const filter = schema.properties.job.properties.taskTypes.items.properties.filters.items;
    expect(filter.properties.op.enum).toEqual(['equals', 'in', 'empty', 'not_empty', '']);
    expect(filter.properties.values.type).toBe('array');
  });

  it('takes the types of an attached tasks file as they are, and only names and describes them', () => {
    const tasks: Attached['tasks'] = {
      name: 'tasks.jsonl',
      tasks: [],
      types: [
        { id: 'refund', count: 30 },
        { id: 'order_question', count: 30 },
      ],
    };
    const checked = check(
      draft({
        taskTypes: [
          { ...NO_TYPE, id: 'refund', label: 'Refunds', description: 'Decide a refund.' },
          { ...NO_TYPE, id: 'invented', label: 'Made up' },
        ],
      }),
      false,
      attached(tasks),
    );
    const job = jobOf(checked.ok ? checked.reply : undefined);
    expect(job.types).toEqual([
      { id: 'refund', label: 'Refunds', description: 'Decide a refund.' },
      { id: 'order_question', label: 'Order question', description: '' },
    ]);
  });
});
