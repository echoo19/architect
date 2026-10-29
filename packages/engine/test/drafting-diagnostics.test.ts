import type { MentorCompletionRequest } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  draft,
  draftingWorld,
  NO_TYPE,
  TEACHER,
  type DraftingWorld,
} from './support/drafting-world';
import { bikeShop, POLICY } from './support/rule-data';
import { bikeDraft, costType, CONTACT_TYPE, step } from './support/rule-draft';

/*
 * What Architect says is wrong with a draft goes back to the teacher, and the teacher has read the
 * first five rows of each table and nothing of the rest. A value of any other row may be the
 * subject, or the answer, of a check or final-test task, so a reason that names it would tell the
 * teacher what it must not know. Here every reason a draft can be sent back for that could name a
 * value is walked, over tables whose later rows each hold values no earlier row has, and nothing
 * of any later row may reach the teacher, while the person, whose records they are, is told in full.
 */

let world: DraftingWorld;

beforeEach(() => {
  world = draftingWorld();
});

afterEach(() => {
  world.cleanup();
});

/** Everything a request carries to the teacher, as one text. */
function textOf(request: MentorCompletionRequest): string {
  return [
    request.system,
    ...request.messages.map((message) => message.content),
    JSON.stringify(request.json),
  ].join('\n');
}

/** The row the teacher is not shown first. */
const SHOWN = 5;

/** The day `index` days into the year, as the file writes it. */
function dayOf(index: number): string {
  return new Date(Date.UTC(2026, 0, 1 + index)).toISOString().slice(0, 10);
}

/**
 * Sixty records. The first five have plain values; every other row has an id, an amount and a note
 * that only it has, marked LATE, and the cells a total can't read are all in later rows.
 */
const ROWS = Array.from({ length: 60 }, (_, index) => {
  const later = index >= SHOWN;
  const unreadable = [20, 33, 47].indexOf(index);
  return {
    id: later ? `LATE-${index + 1}` : `REC-${index + 1}`,
    status: index === 30 ? 'LATE-Reopened' : (['Open', 'Closed', 'Pending'][index % 3] ?? ''),
    region: ['North', 'South', 'East'][index % 3] ?? '',
    amount:
      unreadable >= 0
        ? (['LATE-twelve dollars', 'LATE-see invoice', 'LATE-tbd soon'][unreadable] ?? '')
        : (100 + index * 3.25).toFixed(2),
    placed: index === 22 ? 'LATE-sometime in May' : index === 41 ? 'LATE-next week' : dayOf(index),
    note: index === 17 ? 'LATE-lone note' : '',
    code: `c${index % 4}`,
  };
});

const LEDGER = [
  'id,status,region,amount,placed,note,code',
  ...ROWS.map((row) =>
    [row.id, row.status, row.region, row.amount, row.placed, row.note, row.code].join(','),
  ),
].join('\n');

/** The same records in another file, with an amount of its own for each. */
const ARCHIVE = [
  'id,amount',
  ...ROWS.map((row, index) => `${row.id},${(7000 + index * 3.1).toFixed(2)}`),
].join('\n');

const FILES = [
  { name: 'ledger.csv', description: 'One row per record.', access: 'read' },
  { name: 'archive.csv', description: 'The same records, as archived.', access: 'read' },
];

const lookup = (overrides: object) => ({
  ...NO_TYPE,
  template: 'lookup' as const,
  table: 'ledger.csv',
  keyColumn: 'id',
  columns: ['amount'],
  request: 'What is the amount for record {key}?',
  ...overrides,
});

const list = (filters: object[], request: string) => ({
  ...NO_TYPE,
  id: 'codes',
  label: 'Codes of a region',
  template: 'filtered_list' as const,
  table: 'ledger.csv',
  keyColumn: 'code',
  filters,
  request,
});

const total = (overrides: object) => ({
  ...NO_TYPE,
  template: 'group_total' as const,
  table: 'ledger.csv',
  groupColumn: 'region',
  unit: 'as_written' as const,
  ...overrides,
});

interface Walk {
  /** The reason, in words. */
  name: string;
  /** The task types the teacher drafts, both times it is asked. */
  types: object[];
  /** What the teacher is told is wrong, which names columns and counts. */
  told: RegExp[];
  /** What the person is told when it stays wrong, with the values of the records. */
  shown: RegExp[];
}

const WALKS: Walk[] = [
  {
    name: 'a list that keeps a value no row has',
    types: [
      list(
        [
          { column: 'id', op: 'in', value: '', values: ['MISSING'], varies: false },
          { column: 'region', op: 'equals', value: '', varies: true },
        ],
        'Which codes are in {region}?',
      ),
    ],
    told: [
      /No row of ledger\.csv has "MISSING" in id\. id has 60 different values, such as REC-1, REC-2, REC-3, REC-4 and REC-5\./,
    ],
    shown: [
      /No row of ledger\.csv has "MISSING" in id\. id holds REC-1, REC-2, REC-3, REC-4, REC-5, LATE-6, /,
    ],
  },
  {
    name: 'a list that needs a condition no row meets',
    types: [
      list(
        [
          { column: 'status', op: 'equals', value: 'Archived', varies: false },
          { column: 'region', op: 'equals', value: '', varies: true },
        ],
        'Which codes are in {region}?',
      ),
    ],
    told: [
      /No row of ledger\.csv meets "status is Archived"\. status has 4 different values, such as (Closed|Pending|Open), /,
    ],
    shown: [/status holds Open, Closed, Pending, LATE-Reopened\./],
  },
  {
    name: 'a total of a column with cells that are not numbers',
    types: [
      total({
        id: 'sums',
        label: 'Region sums',
        measure: 'sum',
        valueColumn: 'amount',
        request: 'What is the total of amount for {group}?',
      }),
    ],
    told: [/amount has 3 values Architect can't read as numbers\.(?! *such)/],
    shown: [
      /amount has 3 values Architect can't read as numbers, such as "LATE-twelve dollars", "LATE-see invoice", "LATE-tbd soon"\./,
    ],
  },
  {
    name: 'a total within dates over a column with cells that are not dates',
    types: [
      total({
        id: 'counts',
        label: 'Region counts',
        measure: 'count',
        dateColumn: 'placed',
        request: 'How many records did {group} have from {from} to {to}?',
      }),
    ],
    told: [/placed has 2 values Architect can't read as dates\.(?! *such)/],
    shown: [
      /placed has 2 values Architect can't read as dates, such as "LATE-sometime in May", "LATE-next week"\./,
    ],
  },
  {
    name: 'a lookup by a column whose values are shared by rows',
    types: [lookup({ id: 'by_status', label: 'By status', keyColumn: 'status', columns: ['id'] })],
    told: [/status isn't a key: 59 of 60 rows share their value with another row\.(?! *such)/],
    shown: [
      /status isn't a key: 59 of 60 rows share their value with another row, such as "open"\./,
    ],
  },
  {
    name: 'a lookup of a column that one row alone fills in',
    types: [lookup({ id: 'notes', label: 'Notes', columns: ['note'], request: 'Note of {key}?' })],
    told: [
      /Every request would have the same answer, so an agent could pass without reading the data\./,
    ],
    shown: [/Every request would have the same answer, \{"note":"LATE-lone note"\}, so an agent/],
  },
];

describe('what a draft is sent back for, over tables whose later rows each hold their own values', () => {
  /** Every value of a later row, which the teacher must be told none of. */
  const later = ROWS.slice(SHOWN).flatMap((row) => [row.id, row.amount]);

  it.each(WALKS)('tells the teacher counts and no value of a later row: $name', async (walk) => {
    world.mentor.script = () => draft({ files: FILES, taskTypes: walk.types });
    const error = await world.drafting
      .start(
        'A ledger',
        [world.attach('ledger.csv', LEDGER), world.attach('archive.csv', ARCHIVE)],
        TEACHER,
      )
      .then(
        () => undefined,
        (reason: unknown) => reason,
      );

    // The teacher was told what was wrong once, and asked again.
    expect(world.mentor.requests).toHaveLength(2);
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    for (const pattern of walk.told) expect(fix).toMatch(pattern);

    // Nothing of any later row reached it, in this or in anything else it was sent.
    const sent = world.mentor.requests.map(textOf).join('\n');
    expect(sent).not.toContain('LATE');
    for (const value of later.filter((item) => !item.startsWith('LATE'))) {
      expect(sent, value).not.toContain(value);
    }
    for (let index = 0; index < SHOWN; index += 1) {
      expect(sent).toContain(ROWS[index]?.id);
    }

    // The draft stayed unusable, and the person is told why, in full.
    expect(error).toBeInstanceOf(Error);
    const message = error instanceof Error ? error.message : '';
    expect(message).toMatch(/^The draft couldn't be used: /);
    for (const pattern of walk.shown) expect(message).toMatch(pattern);
  });
});

describe('what a rule is sent back for, over the repair shop whose later tickets each have an id', () => {
  const bike = bikeShop({ offGrid: true });
  /**
   * What only a ticket the teacher is not shown has, its id, and what only a customer it is not
   * shown has, the email. (A customer's id is also on the tickets it is shown.)
   */
  const unseen = [
    ...bike.tickets.slice(SHOWN).map((ticket) => ticket.id),
    ...bike.customers.slice(SHOWN).map((_customer, index) => `name${index + SHOWN}@example.com`),
  ];

  const attach = (customers = bike.customersCsv): string[] => [
    world.attach('customers.csv', customers),
    world.attach('tickets.csv', bike.ticketsCsv),
    world.attach('policy.md', POLICY),
  ];

  /** Starts the conversation with a teacher that sends the same draft every time. */
  async function sendBack(types: object[], customers?: string) {
    world.mentor.script = () => bikeDraft(types);
    const error = await world.drafting.start('A repair desk', attach(customers), TEACHER).then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(world.mentor.requests).toHaveLength(2);
    const sent = world.mentor.requests.map(textOf).join('\n');
    for (const id of unseen) expect(sent, id).not.toContain(id);
    expect(error).toBeInstanceOf(Error);
    return {
      fix: world.mentor.requests[1]?.messages.at(-1)?.content ?? '',
      sent,
      message: error instanceof Error ? error.message : '',
    };
  }

  it('tells the teacher the answers are all one and not which, and the person which', async () => {
    const constant = costType({
      steps: [
        step('rate', 'num', { value: '65' }),
        step('total', 'round', { value: '0.01', mode: 'half_up', args: ['rate'] }),
      ],
      lookupTable: '',
      lookupKey: '',
      matchColumn: '',
      categories: [],
    });
    const { fix, sent, message } = await sendBack([constant, CONTACT_TYPE]);
    expect(fix).toContain(
      'comes to the same total, so an agent could pass without working anything out.',
    );
    expect(sent).not.toContain('comes to the same total, 65');
    expect(message).toContain('comes to the same total, 65, so an agent could pass');
  });

  it('tells the teacher how long the longest answer is and not what it is, and the person what it is', async () => {
    const long = costType({
      steps: [
        step('hours', 'col', { column: 'labor_hours', from: 'row' }),
        step('big', 'num', { value: '100000.12345678' }),
        step('part', 'mul', { args: ['hours', 'big'] }),
        step('total', 'round', { value: '0.00000001', mode: 'half_up', args: ['part'] }),
      ],
      lookupTable: '',
      lookupKey: '',
      matchColumn: '',
      categories: [],
    });
    const { fix, sent, message } = await sendBack([long, CONTACT_TYPE]);
    expect(fix).toContain(
      'The longest answer has 14 digits, and an answer is graded as a number that holds 13 exactly',
    );
    expect(sent).not.toContain('An answer such as');
    // Besides the teacher's own factor, no number of that length was said to it.
    expect(sent.replaceAll('100000.12345678', '')).not.toMatch(/\d{5,6}\.\d{8}/);
    expect(message).toMatch(/An answer such as \d{6}\.\d{8} has 14 digits/);
  });

  it('tells the teacher how many rows of the table it looks up share a key and not which key', async () => {
    // Nineteen more customers have the first customer's id.
    const lines = bike.customersCsv.split('\n');
    const shared = lines.map((line, index) =>
      index >= 2 && index <= 20 ? line.replace(/^[^,]+/, 'C-101') : line,
    );
    const { fix, message } = await sendBack([costType(), CONTACT_TYPE], shared.join('\n'));
    expect(fix).toContain("customer_id isn't a key in customers.csv: 20 of 40 rows share");
    expect(fix).not.toContain('such as "c-101"');
    expect(message).toContain('rows share their value with another row, such as "c-101".');
  });
});
