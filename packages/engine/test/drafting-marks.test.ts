import { readFileSync, writeFileSync } from 'node:fs';
import {
  DraftRecordSchema,
  DraftTurnSchema,
  type DraftRecord,
  type DraftTurn,
  type MentorCompletionRequest,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_NOW } from '../src/drafting/envelope';
import { MAX_MARK_QUESTIONS, MAX_RULE_QUESTIONS } from '../src/drafting/drafter';
import { ruleVersion } from '../src/drafting/templates/rule';
import {
  draft,
  draftingWorld,
  NO_TYPE,
  TEACHER,
  type DraftingWorld,
} from './support/drafting-world';
import { bikeShop, editedBikeCsv, PARTS, POLICY } from './support/rule-data';
import { bikeDraft, CONTACT_TYPE, costType, step, wireRule } from './support/rule-draft';

/*
 * The question Architect asks about a mark such as N/A or a dash (decision 061). A rule leaves the
 * row of such a cell out, and the person can say that a mark means none. The teacher raised nothing
 * of it, and has no say in the answer: Architect finds the marks in the records, asks once for each
 * table, column and mark before any task is made, and applies the answer itself.
 */

const ZERO = 'Count it as zero';
const LEAVE = 'Leave those rows out';

const NA_QUESTION =
  'In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out.';
const dashQuestion = (mark: string) =>
  `In tickets.csv, parts_cost sometimes has a dash ("${mark}") where a number should be. Does a dash mean no parts cost? If it can also mean "not known yet", leave those rows out.`;
const QUESTION_MARK_QUESTION =
  'In tickets.csv, parts_cost sometimes has a question mark ("?") where a number should be. Does a question mark mean no parts cost? If it can also mean "not known yet", leave those rows out.';

const bike = bikeShop({ offGrid: true });
let world: DraftingWorld;

beforeEach(() => {
  world = draftingWorld({ marks: 'ask' });
});

afterEach(() => {
  world.cleanup();
});

const TEXT = (request: MentorCompletionRequest): string =>
  [request.system, JSON.stringify(request.json), ...request.messages.map((m) => m.content)].join(
    '\n',
  );

// The bike shop's export writes a ticket with no parts as N/A or as an empty cell, by turns.
const withoutParts = bike.tickets
  .map((ticket, at) => ({ ticket, at }))
  .filter(({ ticket }) => ticket.partsCents === null);
const notApplicable = withoutParts.filter(({ at }) => at % 2 === 0);
const empty = withoutParts.filter(({ at }) => at % 2 === 1);

/** The shop's files, with some of the tickets that say N/A written with another mark. */
function attach(kinds: Record<string, number> = {}): string[] {
  const { ticketsCsv, customersCsv } = editedBikeCsv(bike, (csv) => {
    let next = 0;
    for (const [mark, count] of Object.entries(kinds)) {
      for (let at = 0; at < count; at += 1) {
        const row = notApplicable[next]?.at;
        if (row === undefined) throw new Error('Not enough tickets that say N/A.');
        (csv.tickets[row + 1] as string[])[PARTS] = mark;
        next += 1;
      }
    }
  });
  return [
    world.attach('customers.csv', customersCsv),
    world.attach('tickets.csv', ticketsCsv),
    world.attach('policy.md', POLICY),
  ];
}

function recordOf(jobId: string): DraftRecord {
  return DraftRecordSchema.parse(JSON.parse(readFileSync(world.paths.draftingFile(jobId), 'utf8')));
}

const start = (files = attach()) => world.drafting.start('A repair desk', files, TEACHER);

function jobOf(turn: DraftTurn) {
  if (turn.draft === undefined) throw new Error(`Expected a draft, got: ${turn.message}`);
  return turn.draft;
}

/** What a mark does in a rule: the tokens the draft counted as zero in the parts cost. */
function tokensOf(record: DraftRecord): string[] | undefined {
  const spec = record.types.find((type) => type.id === 'cost')?.spec;
  return spec?.template === 'rule'
    ? spec.placeholderMeansZero?.flatMap((item) => item.tokens)
    : undefined;
}

describe('the question about a mark', () => {
  it('is asked by Architect when the teacher raised nothing, before any task is made', async () => {
    world.mentor.script = () => bikeDraft();
    const turn = await start();
    expect(turn.draft).toBeUndefined();
    expect(turn.ended).toBeUndefined();
    expect(turn.message).toBe(NA_QUESTION);
    // It is Architect asking, not the teacher, and the conversation can say so.
    expect(turn.from).toBe('architect');
    expect(DraftTurnSchema.safeParse(turn).success).toBe(true);
    // Two answers a rule can do, in the order the empty cell's are, and no way to draft anyway.
    expect(turn.options).toEqual([ZERO, LEAVE]);
    expect(turn.options).not.toContain(DRAFT_NOW);
    expect(world.store.jobs.list()).toEqual([]);
    // The teacher drafted once and was not asked for the question: it came from the records.
    expect(world.mentor.requests).toHaveLength(1);
  });

  it('carries a choice and nothing of the records: no count, no row, no set', async () => {
    world.mentor.script = () => bikeDraft();
    const turn = await start();
    expect(turn.message.replace('tickets.csv', '')).not.toMatch(/\d/);
    for (const ticket of bike.tickets) expect(turn.message).not.toContain(ticket.id);
    expect(turn.message).not.toMatch(/test|split|practice|check task|score|rows? of/i);
    // Nothing of it reaches the teacher, before the answer or after it.
    await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    for (const request of world.mentor.requests) {
      const sent = TEXT(request);
      expect(sent).not.toContain('sometimes says');
      expect(sent).not.toContain(ZERO);
      expect(sent).not.toContain('placeholder');
    }
  });

  it('is never answered by itself: "Draft it now", a word that is no choice, and zero typed are not', async () => {
    world.mentor.script = () => bikeDraft();
    const first = await start();
    const calls = world.mentor.requests.length;

    // "Draft it now" asks it again, with the reason, and drafts nothing.
    const now = await world.drafting.reply(first.sessionId, DRAFT_NOW, TEACHER);
    expect(now.draft).toBeUndefined();
    expect(now.message).toBe(
      `${NA_QUESTION}\n\nThis changes the numbers the agent is tested on, so it needs an answer before I can draft the job.`,
    );
    expect(now.options).toEqual([ZERO, LEAVE]);
    expect(now.from).toBe('architect');
    const typed = await world.drafting.reply(first.sessionId, 'draft it now', TEACHER);
    expect(typed.draft).toBeUndefined();
    expect(typed.options).toEqual([ZERO, LEAVE]);

    // Neither is a reply that is not one of the two, however zero it sounds.
    for (const reply of ['Use the average', 'zero', '0', 'yes', 'Count it', '']) {
      const turn = await world.drafting.reply(first.sessionId, reply, TEACHER);
      expect(turn.draft, reply).toBeUndefined();
      expect(turn.message, reply).toBe(
        `${NA_QUESTION}\n\nChoose one of the answers: it decides what "N/A" counts as in parts_cost of tickets.csv, in every row.`,
      );
      expect(turn.options, reply).toEqual([ZERO, LEAVE]);
      expect(turn.from, reply).toBe('architect');
    }
    // Nothing was recorded or made, and the teacher was not called.
    expect(world.mentor.requests).toHaveLength(calls);
    expect(world.store.jobs.list()).toEqual([]);

    // The words of the choice, in any case and spacing, are the answer.
    const chosen = await world.drafting.reply(first.sessionId, ' count it AS zero ', TEACHER);
    expect(chosen.draft).toBeDefined();
  });

  it('counts the mark as zero when the person chose it, and applies it without calling the teacher again', async () => {
    world.mentor.script = () => bikeDraft();
    const first = await start();
    const turn = await world.drafting.reply(first.sessionId, ZERO, TEACHER);
    const job = jobOf(turn);
    expect(turn.from).toBeUndefined();
    expect(world.mentor.requests).toHaveLength(1);
    expect(world.teachers).toHaveLength(1);

    const record = recordOf(job.id);
    expect(record.answers).toEqual([
      {
        question: NA_QUESTION,
        answer: ZERO,
        placeholder: { table: 'tickets.csv', column: 'parts_cost', mark: 'N/A', means: 'zero' },
      },
    ]);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.spec).toMatchObject({
      template: 'rule',
      placeholderMeansZero: [{ column: 'parts_cost', from: 'row', tokens: ['N/A'] }],
    });
    // What was not named is what it was: the empty cell still leaves its row out.
    expect(cost?.spec).not.toHaveProperty('emptyMeansZero');
    expect(cost?.details?.excluded.map((item) => [item.reason, item.count])).toEqual([
      ['parts_cost is empty', empty.length],
    ]);
    expect(cost?.details?.cases).toEqual({ total: 160, eligible: 160 - empty.length });
    expect(cost?.details?.statement).toMatch(/ "N\/A" in parts cost counts as 0, as you said\.$/);
    expect(cost?.details?.flags).toContain(
      `${notApplicable.length} rows have "N/A" in parts cost, which counts as 0, as you said.`,
    );
    // The tickets that said N/A are tasks now.
    const keys = new Set<string>();
    for (const split of ['calibration', 'train', 'dev'] as const) {
      for (const task of await world.jobs.tasks(job.id, split)) {
        keys.add(String(task.meta?.['key']));
      }
    }
    expect(notApplicable.some(({ ticket }) => keys.has(ticket.id))).toBe(true);
    expect(empty.some(({ ticket }) => keys.has(ticket.id))).toBe(false);
  });

  it('shows the answer beside its question and the rule as steps, for the person to confirm', async () => {
    world.mentor.script = () => bikeDraft();
    const first = await start();
    const job = jobOf(await world.drafting.reply(first.sessionId, ZERO, TEACHER));
    const plan = await world.jobs.taskPlan(job.id);
    const details = plan.types.find((type) => type.id === 'cost')?.details;
    // The answer is a passage the rule rests on, and carries the question that was put.
    expect(details?.passages).toEqual([
      { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
      { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
      { file: 'answers', passage: ZERO, question: NA_QUESTION },
    ]);
    expect(details?.steps?.map((item) => [item.text, item.note])).toEqual([
      ['Round labor hours up to a multiple of 0.5.', undefined],
      ['Multiply by 65.', undefined],
      ['When member (customers.csv) is yes, take 10% off.', undefined],
      ['Add parts cost.', '"N/A" in parts cost counts as 0, as you said.'],
      ['Round the result to the nearest cent; half a cent rounds up.', undefined],
    ]);
    // Rows are still left out, for the other marks and for what is empty, and the line says so.
    expect(details?.cases.total).toBe(160);
    expect(details?.cases.eligible).toBe(160 - empty.length);
    expect(details?.conventions[1]).toBe(
      '"N/A" in parts_cost counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
    );
  });

  it('keeps the answer about an empty cell beside its own question when the one about N/A was answered too', async () => {
    // Both answers read "Count it as zero". What tells them apart is the question each was given to.
    const EMPTY = {
      question: 'What parts amount should be used when a ticket lists no parts cost?',
      options: [],
      changesAnswers: true,
      blankColumn: 'parts_cost',
      blankFrom: 'row',
    };
    world.mentor.script = () => bikeDraft([costType({ ambiguities: [EMPTY] }), CONTACT_TYPE]);
    let turn = await start();
    expect(turn.message).toBe(EMPTY.question);
    expect(turn.from).toBeUndefined();
    turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    expect(turn.message).toBe(NA_QUESTION);
    const job = jobOf(await world.drafting.reply(turn.sessionId, ZERO, TEACHER));
    // The teacher was called for the empty cell's answer, and for nothing after it.
    expect(world.mentor.requests).toHaveLength(2);
    const plan = await world.jobs.taskPlan(job.id);
    const details = plan.types.find((type) => type.id === 'cost')?.details;
    expect(details?.passages.filter((item) => item.file === 'answers')).toEqual([
      { file: 'answers', passage: ZERO, question: EMPTY.question },
      { file: 'answers', passage: ZERO, question: NA_QUESTION },
    ]);
    expect(details?.steps?.find((item) => item.note !== undefined)?.note).toBe(
      'An empty parts cost or "N/A" counts as 0, as you said.',
    );
    expect(details?.excluded).toEqual([]);
    expect(details?.cases).toEqual({ total: 160, eligible: 160 });
    // Nothing is left out for being empty or N/A now, so the screen has no rows to account for.
    const record = recordOf(job.id);
    expect(record.types.find((type) => type.id === 'cost')?.spec).toMatchObject({
      emptyMeansZero: [{ column: 'parts_cost', from: 'row' }],
      placeholderMeansZero: [{ column: 'parts_cost', from: 'row', tokens: ['N/A'] }],
    });
  });

  it('keeps "leave those rows out" as an answer, and the rule is the one it always was', async () => {
    world.mentor.script = () => bikeDraft();
    const first = await start();
    const job = jobOf(await world.drafting.reply(first.sessionId, LEAVE, TEACHER));
    const record = recordOf(job.id);
    expect(record.answers).toEqual([
      {
        question: NA_QUESTION,
        answer: LEAVE,
        placeholder: {
          table: 'tickets.csv',
          column: 'parts_cost',
          mark: 'N/A',
          means: 'leave_out',
        },
      },
    ]);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.spec).not.toHaveProperty('placeholderMeansZero');
    expect(cost?.details?.passages).toHaveLength(2);
    expect(cost?.details?.excluded.map((item) => item.reason)).toEqual([
      'parts_cost is empty or N/A',
    ]);
    expect(cost?.details?.statement).not.toContain('counts as 0');
    // The same rule as one that was never asked: the version is the plain one.
    expect(cost?.details?.version).toBe(
      ruleVersion(cost?.spec?.template === 'rule' ? cost.spec : (undefined as never)),
    );
  });

  it('asks again in a new conversation: the answers to an old one are not kept', async () => {
    world.mentor.script = () => bikeDraft();
    const first = await start();
    await world.drafting.reply(first.sessionId, ZERO, TEACHER);
    const again = await start();
    expect(again.message).toBe(NA_QUESTION);
  });
});

describe('a question for each mark', () => {
  const KINDS = { '-': 5, '\u2014': 3, '?': 2 };

  it('is asked once for each mark a column holds, the most common first, the dash apart from the N/A', async () => {
    world.mentor.script = () => bikeDraft();
    let turn = await start(attach(KINDS));
    expect(turn.message).toBe(NA_QUESTION);
    turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    expect(turn.message).toBe(dashQuestion('-'));
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    expect(turn.message).toBe(dashQuestion('\u2014'));
    turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    expect(turn.message).toBe(QUESTION_MARK_QUESTION);
    expect(turn.options).toEqual([ZERO, LEAVE]);
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    const job = jobOf(turn);

    // Four answers, each about its own mark, and the teacher was called once for all of it.
    expect(world.mentor.requests).toHaveLength(1);
    const record = recordOf(job.id);
    expect(
      record.answers?.map((item) => [item.placeholder?.mark, item.placeholder?.means]),
    ).toEqual([
      ['N/A', 'zero'],
      ['-', 'leave_out'],
      ['\u2014', 'zero'],
      ['?', 'leave_out'],
    ]);
    // Only the marks the person said so for count as zero. The others leave their rows out, each
    // for what it says.
    expect(tokensOf(record)).toEqual(['N/A', '\u2014']);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(new Map(cost?.details?.excluded.map((item) => [item.reason, item.count]))).toEqual(
      new Map([
        ['parts_cost is empty', empty.length],
        ['parts_cost says a dash ("-"), which is not counted as 0', 5],
        ['parts_cost says a question mark ("?"), which is not counted as 0', 2],
      ]),
    );
    // One passage for each answer that counts, each beside the question it answered.
    expect(cost?.details?.passages.filter((item) => item.file === 'answers')).toEqual([
      { file: 'answers', passage: ZERO, question: NA_QUESTION },
      { file: 'answers', passage: ZERO, question: dashQuestion('\u2014') },
    ]);
  });

  it('reads N/A and n/a as one mark, and asks about the first spelling the column uses most', async () => {
    const files = [
      world.attach('customers.csv', editedBikeCsv(bike, () => undefined).customersCsv),
      world.attach(
        'tickets.csv',
        editedBikeCsv(bike, (csv) => {
          for (const [index, { at }] of notApplicable.entries()) {
            if (index % 3 === 0) (csv.tickets[at + 1] as string[])[PARTS] = 'n/a';
          }
        }).ticketsCsv,
      ),
      world.attach('policy.md', POLICY),
    ];
    world.mentor.script = () => bikeDraft();
    const turn = await start(files);
    // N/A is what most of them say, and n/a is the same mark: one question, in the common spelling.
    expect(turn.message).toBe(NA_QUESTION);
    const done = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    const record = recordOf(jobOf(done).id);
    expect(record.answers).toHaveLength(1);
    expect(tokensOf(record)).toEqual(['N/A']);
    // Every one of them counted, whichever way it was written.
    expect(
      record.types.find((type) => type.id === 'cost')?.details?.excluded.map((item) => item.count),
    ).toEqual([empty.length]);
  });

  it('asks nothing about a mark in a column the rule does not add up, or a column of words', async () => {
    const files = [
      world.attach('customers.csv', bike.customersCsv),
      world.attach(
        'tickets.csv',
        editedBikeCsv(bike, (csv) => {
          // The status says N/A in places, and so does the key's neighbor: neither is added up.
          for (const at of [3, 9, 14]) (csv.tickets[at] as string[])[2] = 'N/A';
          // An empty cell is not a mark: a column with only those asks nothing.
          for (const row of csv.tickets.slice(1)) {
            if (row[PARTS] === 'N/A') row[PARTS] = '';
          }
        }).ticketsCsv,
      ),
      world.attach('policy.md', POLICY),
    ];
    world.mentor.script = () => bikeDraft();
    const turn = await start(files);
    expect(turn.draft).toBeDefined();
    expect(turn.message).not.toContain('sometimes');
    expect(world.mentor.requests).toHaveLength(1);
  });
});

describe('a question for each table and each column', () => {
  function surcharge(table: string, key: string, request: string, columns: string[]) {
    const read = columns.map((column) => step(column, 'col', { column, from: 'row' }));
    return {
      ...NO_TYPE,
      id: `${table.replace('.csv', '')}_total`,
      label: `Totals of ${table}`,
      description: `Work out what a row of ${table} comes to.`,
      template: 'rule' as const,
      table,
      keyColumn: key,
      request,
      rule: wireRule({
        currency: '',
        lookupTable: '',
        lookupKey: '',
        matchColumn: '',
        categories: [],
        sources: [{ file: 'description', passage: 'Both carry a ten percent surcharge.' }],
        steps: [
          ...read,
          ...(columns.length > 1 ? [step('both', 'add', { args: columns })] : []),
          step('rate', 'num', { value: '1.1' }),
          step('priced', 'mul', {
            args: [columns.length > 1 ? 'both' : (columns[0] ?? ''), 'rate'],
          }),
          step('total', 'round', { value: '0.01', mode: 'half_up', args: ['priced'] }),
        ],
        result: 'total',
      }),
    };
  }

  /** Seventy rows with an amount and a fee, some written N/A. */
  function table(key: string, prefix: string, odd: (i: number) => boolean): string {
    const rows = Array.from({ length: 70 }, (_, i) =>
      [
        `${prefix}-${1000 + i}`,
        `C-${100 + (i % 20)}`,
        odd(i) ? 'N/A' : (10 + i * 1.5).toFixed(2),
        i % 11 === 0 ? 'N/A' : (1 + (i % 7)).toFixed(2),
      ].join(','),
    );
    return `${[`${key},customer_id,amount,fee`, ...rows].join('\n')}\n`;
  }

  const SAID = 'Tickets and invoices. Both carry a ten percent surcharge.';
  const questionOf = (file: string, column: string) =>
    `In ${file}, ${column} sometimes says "N/A". Does "N/A" mean no ${column}? If it can also mean "not known yet", leave those rows out.`;

  it("asks about each table's column on its own, and keeps each answer for the table it was about", async () => {
    world.mentor.script = () =>
      draft({
        files: [
          { name: 'tickets.csv', description: 'Repair tickets.', access: 'read' },
          { name: 'invoices.csv', description: 'Invoices.', access: 'read' },
        ],
        taskTypes: [
          surcharge('tickets.csv', 'ticket_id', 'What does ticket {key} come to?', ['amount']),
          surcharge('invoices.csv', 'invoice_id', 'What does invoice {key} come to?', ['amount']),
        ],
      });
    const files = [
      world.attach(
        'tickets.csv',
        table('ticket_id', 'T', (i) => i % 5 === 0),
      ),
      world.attach(
        'invoices.csv',
        table('invoice_id', 'INV', (i) => i % 5 === 0),
      ),
    ];
    let turn = await world.drafting.start(SAID, files, TEACHER);
    expect(turn.message).toBe(questionOf('tickets.csv', 'amount'));
    turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    // The answer was about the tickets' amount: the invoices' is a question of its own.
    expect(turn.draft).toBeUndefined();
    expect(turn.message).toBe(questionOf('invoices.csv', 'amount'));
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    const record = recordOf(jobOf(turn).id);
    expect(record.answers?.map((item) => item.placeholder)).toEqual([
      { table: 'tickets.csv', column: 'amount', mark: 'N/A', means: 'zero' },
      { table: 'invoices.csv', column: 'amount', mark: 'N/A', means: 'leave_out' },
    ]);
    const tickets = record.types.find((type) => type.id === 'tickets_total');
    const invoices = record.types.find((type) => type.id === 'invoices_total');
    expect(tickets?.spec).toMatchObject({
      placeholderMeansZero: [{ column: 'amount', from: 'row', tokens: ['N/A'] }],
    });
    expect(invoices?.spec).not.toHaveProperty('placeholderMeansZero');
    expect(tickets?.details?.statement).toContain('"N/A" in amount counts as 0');
    expect(invoices?.details?.statement).not.toContain('counts as 0');
    expect(world.mentor.requests).toHaveLength(1);
  });

  it('asks about each column a rule adds up on its own, and an answer about one is no answer about the other', async () => {
    world.mentor.script = () =>
      draft({
        files: [{ name: 'tickets.csv', description: 'Repair tickets.', access: 'read' }],
        taskTypes: [
          surcharge('tickets.csv', 'ticket_id', 'What does ticket {key} come to?', [
            'amount',
            'fee',
          ]),
        ],
      });
    const files = [
      world.attach(
        'tickets.csv',
        table('ticket_id', 'T', (i) => i % 5 === 0),
      ),
    ];
    let turn = await world.drafting.start(SAID, files, TEACHER);
    // The amount says N/A in more rows than the fee, so it is asked first.
    expect(turn.message).toBe(questionOf('tickets.csv', 'amount'));
    turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    expect(turn.message).toBe(questionOf('tickets.csv', 'fee'));
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    const record = recordOf(jobOf(turn).id);
    const spec = record.types[0]?.spec;
    expect(spec?.template === 'rule' && spec.placeholderMeansZero).toEqual([
      { column: 'amount', from: 'row', tokens: ['N/A'] },
    ]);
  });
});

describe('a question asked once, whatever the teacher does after it', () => {
  it('is not asked again when the teacher has to draft the rule again, and keeps the answer', async () => {
    // The first rule would pass a copy of the parts cost for the job's pass rate, so it is sent
    // back after the person has answered, and the second is drafted: the answer stays.
    const copy = costType({
      steps: [
        step('parts', 'col', { column: 'parts_cost', from: 'row' }),
        step('five', 'num', { value: '5' }),
        step('more', 'add', { args: ['parts', 'five'] }),
        step('is_member', 'equals', { column: 'member', from: 'lookup', value: 'yes' }),
        step('pick', 'if', { args: ['is_member', 'more', 'parts'] }),
        step('total', 'round', { value: '0.01', mode: 'half_up', args: ['pick'] }),
      ],
    });
    const lax = bikeDraft([copy, CONTACT_TYPE]);
    world.mentor.script = (_request, call) =>
      call === 1 ? { ...lax, job: { ...lax.job, passRate: 0.5 } } : bikeDraft();
    const first = await start();
    expect(first.message).toBe(NA_QUESTION);
    const turn = await world.drafting.reply(first.sessionId, ZERO, TEACHER);
    const job = jobOf(turn);
    expect(world.mentor.requests).toHaveLength(2);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'That reply could not be used',
    );
    // Asked once, answered once, kept for the rule that was drafted second.
    const record = recordOf(job.id);
    expect(record.answers?.filter((item) => item.placeholder !== undefined)).toHaveLength(1);
    expect(tokensOf(record)).toEqual(['N/A']);
  });

  it("comes after the teacher's own questions, and is asked once, not again after the redraft they cause", async () => {
    const OPEN = {
      question: 'Does the 10% off for members also apply to the parts?',
      options: ['No, labor only', 'Yes, parts too'],
      changesAnswers: true,
    };
    world.mentor.script = (_request, call) =>
      call === 1 ? bikeDraft([costType({ ambiguities: [OPEN] }), CONTACT_TYPE]) : bikeDraft();
    let turn = await start();
    expect(turn.message).toBe(OPEN.question);
    expect(turn.from).toBeUndefined();
    turn = await world.drafting.reply(turn.sessionId, 'No, labor only', TEACHER);
    // The teacher drafted again with its answer, and now Architect asks about the mark, once.
    expect(turn.message).toBe(NA_QUESTION);
    expect(turn.from).toBe('architect');
    expect(world.mentor.requests).toHaveLength(2);
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    expect(turn.draft).toBeDefined();
    expect(world.mentor.requests).toHaveLength(2);
  });

  it("is not counted against the teacher's questions: three of them can be asked before it", async () => {
    const open = (n: number) => ({
      question: `Does exception number ${n} of the policy apply to the parts?`,
      options: ['No, labor only', 'Yes, parts too'],
      changesAnswers: true,
    });
    world.mentor.script = (_request, call) =>
      call <= MAX_RULE_QUESTIONS
        ? bikeDraft([costType({ ambiguities: [open(call)] }), CONTACT_TYPE])
        : bikeDraft();
    let turn = await start();
    for (let asked = 1; asked <= MAX_RULE_QUESTIONS; asked += 1) {
      expect(turn.message).toBe(open(asked).question);
      turn = await world.drafting.reply(turn.sessionId, 'No, labor only', TEACHER);
    }
    // Three of the teacher's questions used up what it may ask. Architect's own is still asked.
    expect(turn.ended).toBeUndefined();
    expect(turn.message).toBe(NA_QUESTION);
    turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    expect(turn.draft).toBeDefined();
  });

  it('stops asking after a few marks, leaves the rest out and says so, and never counts them', async () => {
    const kinds = { '-': 4, '--': 3, '---': 2, '----': 2, '?': 1, '??': 1, none: 1, null: 1 };
    world.mentor.script = () => bikeDraft();
    let turn = await start(attach(kinds));
    const asked: string[] = [turn.message];
    while (turn.draft === undefined) {
      turn = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
      if (turn.draft === undefined) asked.push(turn.message);
    }
    expect(asked).toHaveLength(MAX_MARK_QUESTIONS);
    expect(new Set(asked).size).toBe(MAX_MARK_QUESTIONS);
    const record = recordOf(jobOf(turn).id);
    expect(tokensOf(record)).toBeUndefined();
    // The marks nobody asked about are told as left open, and their rows stay out.
    const open = record.unresolved.filter((line) => line.includes('I did not ask what it means'));
    expect(open.length).toBeGreaterThan(0);
    expect(open[0]).toMatch(
      /^parts_cost in tickets\.csv also holds .+ I did not ask what it means, so those rows are left out\.$/,
    );
    expect(turn.message).toContain('I did not ask what it means');
  });
});

describe('the room a rule has for marks', () => {
  it('asks about four marks of a column and drafts when all four count as zero, telling the fifth', async () => {
    world.mentor.script = () => bikeDraft();
    let turn = await start(attach({ '-': 4, '--': 3, '---': 2, '?': 1 }));
    const asked: string[] = [];
    while (turn.draft === undefined) {
      asked.push(turn.message);
      turn = await world.drafting.reply(turn.sessionId, ZERO, TEACHER);
    }
    expect(asked).toEqual([
      NA_QUESTION,
      dashQuestion('-'),
      dashQuestion('--'),
      dashQuestion('---'),
    ]);
    const record = recordOf(jobOf(turn).id);
    expect(tokensOf(record)).toEqual(['N/A', '-', '--', '---']);
    expect(record.unresolved).toContain(
      'parts_cost in tickets.csv also holds a question mark ("?"). I did not ask what it means, so those rows are left out.',
    );
    // The teacher drafted once, and was never told of a mark or of a rule it could not hold.
    expect(world.mentor.requests).toHaveLength(1);
  });
});

describe('what only Architect can decide', () => {
  it('keeps the teacher from naming a mark: its reply has no field for one, and one it adds is ignored', async () => {
    world.mentor.script = () => bikeDraft();
    await start();
    const [request] = world.mentor.requests;
    const sent = TEXT(request as MentorCompletionRequest);
    expect(sent).not.toContain('placeholderMeansZero');
    expect(sent).not.toContain('emptyMeansZero');
    expect(JSON.stringify(request?.json)).not.toContain('tokens');
    // It is told that the marks are Architect's to ask about, and that it writes nothing for them.
    expect(request?.system).toContain('N/A, a dash');
    expect(request?.system).toContain('Architect asks the person about each one itself');

    // A rule that names a mark in its reply anyway: the field is not read, and the person is asked.
    const forged = costType({
      ...({
        placeholderMeansZero: [{ column: 'parts_cost', from: 'row', tokens: ['N/A', '-'] }],
        emptyMeansZero: [{ column: 'parts_cost', from: 'row' }],
      } as object),
    });
    world.mentor.script = () => bikeDraft([forged, CONTACT_TYPE]);
    const turn = await start();
    expect(turn.draft).toBeUndefined();
    expect(turn.message).toBe(NA_QUESTION);
    const done = await world.drafting.reply(turn.sessionId, LEAVE, TEACHER);
    const spec = recordOf(jobOf(done).id).types.find((type) => type.id === 'cost')?.spec;
    expect(spec).not.toHaveProperty('placeholderMeansZero');
    expect(spec).not.toHaveProperty('emptyMeansZero');
  });

  it("does not take the teacher's question about N/A, or the person's answer to it, for a mark counted as zero", async () => {
    // The tickets that say nothing are written N/A and none is empty, so the teacher's question
    // about an empty parts cost has nothing to ask about, and the rule is not changed by it.
    const files = [
      world.attach('customers.csv', bike.customersCsv),
      world.attach(
        'tickets.csv',
        editedBikeCsv(bike, (csv) => {
          for (const row of csv.tickets.slice(1)) if (row[PARTS] === '') row[PARTS] = 'N/A';
        }).ticketsCsv,
      ),
      world.attach('policy.md', POLICY),
    ];
    const EMPTY = {
      question: 'What parts amount should be used when a ticket lists no parts cost?',
      options: [],
      changesAnswers: true,
      blankColumn: 'parts_cost',
      blankFrom: 'row',
    };
    world.mentor.script = () => bikeDraft([costType({ ambiguities: [EMPTY] }), CONTACT_TYPE]);
    const turn = await start(files);
    expect(turn.message).toBe(NA_QUESTION);

    // A question of the teacher's own that asks for N/A to be counted as zero is answered by the
    // person, and the answer is the teacher's to follow in its steps: it does not set the mark.
    const ASKED = {
      question: 'Should N/A parts costs count as zero?',
      options: ['Yes, zero', 'No'],
      changesAnswers: true,
    };
    world.mentor.requests.length = 0;
    world.mentor.script = (_request, call) =>
      call === 1 ? bikeDraft([costType({ ambiguities: [ASKED] }), CONTACT_TYPE]) : bikeDraft();
    const first = await start(files);
    expect(first.message).toBe(ASKED.question);
    const second = await world.drafting.reply(first.sessionId, 'Yes, zero', TEACHER);
    expect(second.draft).toBeUndefined();
    expect(second.message).toBe(NA_QUESTION);
  });
});

describe('the confirmation of a rule that names a mark', () => {
  async function drafted(answer: string) {
    world.mentor.script = () => bikeDraft();
    const asked = await start();
    return jobOf(await world.drafting.reply(asked.sessionId, answer, TEACHER));
  }

  it('is a different rule from the one that leaves the rows out, so the two are confirmed apart', async () => {
    const zero = await drafted(ZERO);
    const leave = await drafted(LEAVE);
    expect(zero.id).not.toBe(leave.id);
    const [zeroPlan, leavePlan] = await Promise.all([
      world.jobs.taskPlan(zero.id),
      world.jobs.taskPlan(leave.id),
    ]);
    const version = (plan: typeof zeroPlan) =>
      plan.types.find((type) => type.id === 'cost')?.details?.version;
    expect(version(zeroPlan)).not.toBe(version(leavePlan));
    expect(zeroPlan.confirmation?.token).not.toBe(leavePlan.confirmation?.token);
    // One's token confirms nothing of the other.
    await expect(
      world.jobs.confirmRules(zero.id, leavePlan.confirmation?.token ?? ''),
    ).rejects.toMatchObject({ code: 'rule_changed' });
  });

  it('asks again when the mark that counts is changed after the person confirmed', async () => {
    const job = await drafted(ZERO);
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    expect((await world.jobs.ruleState(job.id))?.state).toBe('confirmed');

    const file = world.paths.draftingFile(job.id);
    const record = recordOf(job.id);
    const change = (placeholderMeansZero: unknown) => {
      writeFileSync(
        file,
        JSON.stringify({
          ...record,
          types: record.types.map((type) =>
            type.spec?.template === 'rule'
              ? { ...type, spec: { ...type.spec, placeholderMeansZero } }
              : type,
          ),
        }),
      );
    };
    // Another mark counted, or a mark no longer counted: not the rule that was confirmed.
    change([{ column: 'parts_cost', from: 'row', tokens: ['N/A', '-'] }]);
    const wider = await world.jobs.ruleState(job.id);
    expect(wider?.state).toBe('changed');
    expect(wider?.problem).toContain('The rule is not the one you confirmed');
    change(undefined);
    expect((await world.jobs.ruleState(job.id))?.state).toBe('changed');
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_changed',
    });
  });

  it('holds the sentence that says it, in the plan and in the report once confirmed', async () => {
    const job = await drafted(ZERO);
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    const [report] = await world.jobs.ruleReports(job.id);
    expect(report?.statement).toMatch(/ "N\/A" in parts cost counts as 0, as you said\.$/);
    expect(report?.steps?.find((item) => item.note !== undefined)?.note).toBe(
      '"N/A" in parts cost counts as 0, as you said.',
    );
    expect(report?.passages).toContainEqual({
      file: 'answers',
      passage: ZERO,
      question: NA_QUESTION,
    });
    expect(report?.conventions[1]).toContain('"N/A" in parts_cost counts as 0, as you said.');
  });
});

describe('the steps the teacher is told', () => {
  it('say that Architect asks about N/A and a dash, and that the teacher writes nothing for them', async () => {
    world.mentor.script = () => bikeDraft();
    await start();
    const [request] = world.mentor.requests;
    expect(request?.system).toContain(
      'N/A, a dash and other marks that stand where a number should be',
    );
    expect(request?.system).toContain('ask nothing about them');
    expect(request?.system).toContain('Architect asks the person about each one itself');
    expect(request?.system).toContain('a row that has one is left out');
  });
});
