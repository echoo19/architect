import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CodedError,
  DRAFTING_LIMITS,
  GuardError,
  shippedModels,
  type MentorCompletionRequest,
  type Task,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DRAFT_NOW } from '../src/drafting/envelope';
import { releaseMentor } from '../src/vault/gate';
import { deferred } from './fakes/clock';
import {
  draft,
  draftingWorld,
  EMAIL_TYPE,
  NO_TYPE,
  PENDING_TYPE,
  question,
  TEACHER,
  TOTAL_TYPE,
  type DraftingWorld,
} from './support/drafting-world';
import { shopData } from './support/drafting-data';

const data = shopData('conversation', 400, 150);
let world: DraftingWorld;

beforeEach(() => {
  world = draftingWorld();
});

afterEach(() => {
  world.cleanup();
});

/** The shop's records and a short policy, attached the way a person would. */
function attachShop(): string[] {
  return [
    world.attach('customers.csv', data.customersCsv),
    world.attach('orders.csv', data.ordersCsv),
    world.attach('policy.md', '# Shop policy\n\nReturns are accepted for 30 days.\n'),
  ];
}

/** Everything a request carries to the teacher, as one text. */
function textOf(request: MentorCompletionRequest): string {
  return [
    request.system,
    ...request.messages.map((message) => message.content),
    JSON.stringify(request.json),
  ].join('\n');
}

/** The actions a request lets the teacher take: asking is left out when it must draft. */
function actionsOf(request: MentorCompletionRequest | undefined): unknown {
  const properties = request?.json?.schema['properties'] as
    { action: { enum: string[] } } | undefined;
  return properties?.action.enum;
}

/** What the conversation recorded beside a drafted job. */
function recordOf(jobId: string): Record<string, unknown> {
  return JSON.parse(readFileSync(world.paths.draftingFile(jobId), 'utf8')) as Record<
    string,
    unknown
  >;
}

describe('starting the conversation', () => {
  it('tells the teacher what the tables hold in brief, and a text whole', async () => {
    const long = `# Handbook\n\n${'A rule that goes on. '.repeat(400)}\nEXCEPTION-AT-THE-END-9921`;
    world.mentor.script = () => question('Which region matters most?', ['North', 'South']);
    const turn = await world.drafting.start(
      'A desk for our small online shop',
      [...attachShop(), world.attach('handbook.md', long)],
      TEACHER,
    );

    expect(turn).toMatchObject({
      message: 'Which region matters most?',
      options: ['North', 'South', DRAFT_NOW],
    });
    expect(turn.sessionId).toMatch(/^drf_/);
    expect(turn.draft).toBeUndefined();
    expect(turn.ended).toBeUndefined();

    const [request] = world.mentor.requests;
    const opening = request?.messages[0]?.content ?? '';
    expect(request?.messages).toHaveLength(1);
    expect(opening).toContain('A desk for our small online shop');
    expect(opening).toContain('### customers.csv (a table)');
    expect(opening).toContain('150 rows, 5 columns.');
    expect(opening).toContain('- customer_id: text, every value different. Examples: C-1001');
    expect(opening).toContain('First rows (customer_id | name | email | region | member_since):');
    expect(opening).toContain(data.customers[0]?.email);
    expect(opening).toContain('### orders.csv (a table)');
    expect(opening).toContain('400 rows, 7 columns.');
    expect(opening).toContain('numbers, some written with currency signs or separators');
    expect(opening).toContain('### policy.md (text, ');
    expect(opening).toContain('Returns are accepted for 30 days.');
    // A table gives its first rows and a few examples, not all of it; a text file is given whole,
    // down to the exception at its end that a rule must not miss.
    expect(opening).not.toContain(data.customers[149]?.email);
    expect(opening).not.toContain(data.orders[399]?.id);
    expect(opening).toContain('### handbook.md (text, 8,');
    expect(opening).toContain('EXCEPTION-AT-THE-END-9921');
    expect(opening).not.toContain('The rest of the file is not shown');
    expect(opening.length).toBeLessThan(60_000);
  });

  it('tells the teacher no value of a row it is not shown, so no task is about a row it has read', async () => {
    // Thirty rows whose ids and amounts each name one row are the least a table can be. A hundred
    // and twenty give a job tasks enough to be trained, and sampled rows further down the file.
    const rows = Array.from(
      { length: 120 },
      (_, index) => `REC-${2000 + index},${(50 + index * 3.75).toFixed(2)}`,
    );
    const csv = `id,amount\n${rows.join('\n')}\n`;
    world.mentor.script = () =>
      draft({
        does: ['Looks up the amount of a record'],
        files: [{ name: 'records.csv', description: 'One row per record.', access: 'read' }],
        taskTypes: [
          {
            ...NO_TYPE,
            id: 'amount',
            label: 'Amounts',
            description: 'Look up the amount of a record.',
            template: 'lookup' as const,
            table: 'records.csv',
            keyColumn: 'id',
            columns: ['amount'],
            request: 'What is the amount of record {key}?',
          },
        ],
      });
    const turn = await world.drafting.start(
      'A ledger',
      [world.attach('records.csv', csv)],
      TEACHER,
    );
    const job = turn.draft;
    if (job === undefined) throw new Error(turn.message);

    // What reached the teacher: the first five rows, and of any other row nothing at all.
    const sent = world.mentor.requests.map(textOf).join('\n');
    for (let index = 0; index < 5; index += 1) expect(sent).toContain(`REC-${2000 + index}`);
    for (let index = 5; index < 120; index += 1) {
      expect(sent, `row ${index}`).not.toContain(`REC-${2000 + index}`);
    }
    // So no task of the job, the final test included, is about a row the teacher read.
    const sealed = readFileSync(join(world.dataDir, 'vault', job.id, 'test.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Task);
    expect(sealed.length).toBeGreaterThan(20);
    const visible = (
      await Promise.all(
        (['calibration', 'train', 'dev'] as const).map((split) => world.jobs.tasks(job.id, split)),
      )
    ).flat();
    for (const task of [...sealed, ...visible]) {
      expect(sent, String(task.meta?.['key'])).not.toContain(String(task.meta?.['key']));
    }
  });

  it('tells the teacher a value that is cut short as something no row it was not shown writes', async () => {
    // The first row's id is 37 A's and LONG; row 5 writes, as its own id, what that is cut to.
    const dots = `${'A'.repeat(37)}...`;
    const ids = [
      `${'A'.repeat(37)}LONG`,
      ...['B-2', 'B-3', 'B-4', 'B-5'],
      dots,
      ...Array.from({ length: 114 }, (_, index) => `C-${index}`),
    ];
    const csv = `id,amount\n${ids.map((id, index) => `${id},${(10 + index * 1.25).toFixed(2)}`).join('\n')}\n`;
    world.mentor.script = () => question('Which record matters most?', ['A', 'B']);
    await world.drafting.start('A ledger', [world.attach('ledger.csv', csv)], TEACHER);
    const sent = world.mentor.requests.map(textOf).join('\n');
    expect(sent).not.toContain(dots);
    // It is still cut, one character shorter, in the first rows and in the examples.
    const shorter = `${'A'.repeat(36)}...`;
    expect(sent).toContain(`First rows (id | amount):\n${shorter} | 10.00`);
    expect(sent).toContain(`Examples: ${shorter} | B-2`);
  });

  it('sends the description and a text as the person wrote them, spaces and all', async () => {
    // Four spaces open a code block in Markdown, so they are part of what a text says.
    const description = '    Charge $65 an hour for labor  ';
    const policy = '    Labor is billed at $65 an hour.\n\n  - Members get 10% off labor.\n';
    world.mentor.script = () => question('Which region matters most?', ['North', 'South']);
    await world.drafting.start(
      description,
      [...attachShop(), world.attach('rules.md', policy)],
      TEACHER,
    );
    const opening = world.mentor.requests[0]?.messages[0]?.content ?? '';
    expect(opening).toContain(
      `The person describes the job like this:\n\n${description}\n\nThe attached files:`,
    );
    expect(opening).toContain(`### rules.md (text, ${policy.length} characters)\n${policy}`);
  });

  it('will not read part of a long policy: it asks for the section that matters instead', async () => {
    const policy = `# Policy\n\n${'A rule that goes on. '.repeat(1_600)}\nEXCEPTION-AT-THE-END-4417`;
    expect(policy.length).toBeGreaterThan(DRAFTING_LIMITS.maxTextChars);
    const turn = await world.drafting.start(
      'A desk for our small online shop',
      [...attachShop(), world.attach('big-policy.md', policy)],
      TEACHER,
    );
    expect(turn).toMatchObject({ ended: true, options: [] });
    expect(turn.message).toContain(
      `big-policy.md is ${policy.length.toLocaleString('en-US')} characters`,
    );
    expect(turn.message).toContain('more than the 30,000 Architect reads from one text file');
    expect(turn.message).toContain("so Architect won't use part of it");
    expect(turn.message).toContain('Attach just the section the job needs');
    // The teacher was not asked, and nothing of the policy went anywhere.
    expect(world.mentor.requests).toEqual([]);
    await expect(world.drafting.reply(turn.sessionId, 'Hello', TEACHER)).rejects.toMatchObject({
      code: 'draft_not_found',
    });
  });

  it('reads a policy right up to the limit, and counts every text file toward a total', async () => {
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    const atLimit = `${'x'.repeat(DRAFTING_LIMITS.maxTextChars - 11)}\nAT-THE-END`;
    expect(atLimit.length).toBe(DRAFTING_LIMITS.maxTextChars);
    const fits = await world.drafting.start(
      'A desk',
      [...attachShop(), world.attach('limit.md', atLimit)],
      TEACHER,
    );
    expect(fits.ended).toBeUndefined();
    expect(world.mentor.requests[0]?.messages[0]?.content).toContain('AT-THE-END');

    const many = Array.from({ length: 3 }, (_, i) =>
      world.attach(`part-${i}.md`, 'y'.repeat(DRAFTING_LIMITS.maxTextChars - 100)),
    );
    const before = world.mentor.requests.length;
    const total = await world.drafting.start('A desk', [...attachShop(), ...many], TEACHER);
    expect(total).toMatchObject({ ended: true });
    expect(total.message).toContain('Your text files add up to 89,');
    expect(total.message).toContain('more than the 60,000 Architect reads in all');
    expect(world.mentor.requests.length).toBe(before);
  });

  it('asks for a reply in the format, with the three kinds of task and the rules against inventing', async () => {
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    await world.drafting.start('A desk', attachShop(), TEACHER);
    const [request] = world.mentor.requests;
    expect(request?.json?.name).toBe('job_draft');
    expect(actionsOf(request)).toEqual(['ask', 'draft']);
    expect(request?.json?.schema['required']).toEqual(['action', 'message', 'options', 'job']);
    for (const word of [
      'lookup',
      'filtered_list',
      'group_total',
      'Never invent',
      'at most 3 questions',
    ]) {
      expect(request?.system).toContain(word);
    }
    expect(request?.system).toContain('You never write an answer');
  });

  it('asks for the name of the agent in sentence case, with an example and what stays capitalized', async () => {
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    await world.drafting.start('A desk', attachShop(), TEACHER);
    const [request] = world.mentor.requests;
    expect(request?.system).toContain(
      'in sentence case: only the first word has a capital, as in "Repair ticket pricing helper", never "Repair Ticket Pricing Helper". A proper noun, such as the name of the person\'s shop, keeps its capitals.',
    );
    const job = request?.json?.schema['properties'] as {
      job: { properties: { name: { description: string } } };
    };
    expect(job.job.properties.name.description).toContain('in sentence case');
  });

  it('talks to the teacher it is given, each time', async () => {
    world.mentor.script = (_request, call) =>
      call === 1 ? question('Which region?', ['North', 'South']) : draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const other = { ...TEACHER, label: 'Another teacher', model: 'another' };
    await world.drafting.reply(first.sessionId, 'North', other);
    expect(
      world.teachers.map((teacher) => (teacher.kind === 'model' ? teacher.model : '')),
    ).toEqual(['scripted-spark', 'another']);
    await expect(
      world.drafting.start('A desk', attachShop(), {
        kind: 'coding_agent',
        agent: 'claude_code',
        label: 'Claude Code',
      }),
    ).rejects.toThrow('Coding-agent mentors are not supported yet');
  });

  it('does not call the teacher when the files cannot make a job, and says what to attach', async () => {
    const nothing = await world.drafting.start('A desk', [], TEACHER);
    expect(nothing).toMatchObject({ ended: true, options: [] });
    expect(nothing.message).toContain('There is nothing to make practice tasks from yet.');

    const tiny = world.attach('tiny.csv', 'id,name\n1,a\n2,b\n3,c\n');
    const few = await world.drafting.start(
      'A desk',
      [tiny, world.attach('policy.md', '# Rules')],
      TEACHER,
    );
    expect(few).toMatchObject({ ended: true });
    expect(few.message).toContain('Your files hold only 3 rows between them');
    expect(few.message).toContain('tasks.jsonl');

    expect(world.mentor.requests).toEqual([]);
    await expect(world.drafting.reply(nothing.sessionId, 'Hello', TEACHER)).rejects.toMatchObject({
      code: 'draft_not_found',
    });
  });

  it('says what to do about a file it cannot read', async () => {
    await expect(
      world.drafting.start('A desk', [world.attach('orders.xlsx', 'PK')], TEACHER),
    ).rejects.toThrow(
      'orders.xlsx is a spreadsheet. Architect reads CSV, text and Markdown files for now. Save or export it as one of those, then attach that.',
    );
    await expect(
      world.drafting.start('A desk', [world.attach('contract.pdf', '%PDF')], TEACHER),
    ).rejects.toThrow('contract.pdf is a PDF.');
    await expect(
      world.drafting.start('A desk', [world.attach('orders.csv', 'id;name\n1;a\n')], TEACHER),
    ).rejects.toThrow('separates its columns with semicolons');
    await expect(
      world.drafting.start(
        'A desk',
        [world.attach('data.csv', Buffer.from([0x61, 0, 0x62]))],
        TEACHER,
      ),
    ).rejects.toThrow('looks like a binary file');
    await expect(world.drafting.start('  ', attachShop(), TEACHER)).rejects.toThrow(
      'Describe the job first.',
    );
    expect(world.mentor.requests).toEqual([]);
  });
});

describe('asking and answering', () => {
  it('keeps the conversation: the question, then the answer, each in order', async () => {
    world.mentor.script = (_request, call) =>
      call === 1 ? question('Should cancelled orders count?', ['Yes', 'No']) : draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const second = await world.drafting.reply(first.sessionId, 'No', TEACHER);
    expect(second.draft?.name).toBe('Shop desk');
    expect(second.sessionId).toBe(first.sessionId);

    const history = world.mentor.requests[1]?.messages ?? [];
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(history[1]?.content).toContain('Should cancelled orders count?');
    expect(history[2]?.content).toBe('No');
  });

  it('drafts at once when asked to draft now, and the teacher can no longer ask', async () => {
    world.mentor.script = (_request, call) =>
      call === 1 ? question('Should cancelled orders count?', ['Yes', 'No']) : draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    await world.drafting.reply(first.sessionId, DRAFT_NOW, TEACHER);
    const request = world.mentor.requests[1];
    expect(actionsOf(request)).toEqual(['draft']);
    expect(request?.messages[2]?.content).toContain('Draft the job now from what you have');
  });

  it('sends an answer and keeps it as it was written, with the spaces round it', async () => {
    world.mentor.script = (_request, call) =>
      call === 1 ? question('Should cancelled orders count?', ['Yes', 'No']) : draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const answer = '  No,   not for members.  ';
    const turn = await world.drafting.reply(first.sessionId, answer, TEACHER);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toBe(answer);
    expect(recordOf(turn.draft?.id ?? '')['answers']).toEqual([
      { question: 'Should cancelled orders count?', answer },
    ]);
  });

  it('sends the answer to the last question as it was written, before the words that close it', async () => {
    world.mentor.script = (_request, call) =>
      call <= 3 ? question(`Question ${call}?`, ['A', 'B', 'C']) : draft();
    let turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    turn = await world.drafting.reply(turn.sessionId, 'A', TEACHER);
    turn = await world.drafting.reply(turn.sessionId, 'B', TEACHER);
    await world.drafting.reply(turn.sessionId, '   C   ', TEACHER);
    expect(world.mentor.requests[3]?.messages.at(-1)?.content).toMatch(
      /^ {3}C {3}\n\nThat was the last question\./,
    );
  });

  it('asks at most three questions, and drafts after the third answer', async () => {
    world.mentor.script = (_request, call) =>
      call <= 3 ? question(`Question ${call}?`, ['A', 'B', 'C']) : draft();
    let turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(turn.message).toBe('Question 1?');
    turn = await world.drafting.reply(turn.sessionId, 'A', TEACHER);
    expect(turn.message).toBe('Question 2?');
    turn = await world.drafting.reply(turn.sessionId, 'B', TEACHER);
    expect(turn.message).toBe('Question 3?');
    turn = await world.drafting.reply(turn.sessionId, 'C', TEACHER);
    expect(turn.draft).toBeDefined();
    expect(world.mentor.requests).toHaveLength(4);

    const last = world.mentor.requests[3];
    expect(actionsOf(last)).toEqual(['draft']);
    expect(last?.messages.at(-1)?.content).toContain('That was the last question.');
    for (const request of world.mentor.requests.slice(0, 3)) {
      expect(actionsOf(request)).toEqual(['ask', 'draft']);
    }
  });

  it('sends back a question asked after the last one, and uses the draft that follows', async () => {
    world.mentor.script = (_request, call) =>
      call <= 3
        ? question(`Question ${call}?`, ['A', 'B'])
        : call === 4
          ? question('One more?', ['A', 'B'])
          : draft();
    let turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    for (const answer of ['A', 'B', 'C'])
      turn = await world.drafting.reply(turn.sessionId, answer, TEACHER);
    expect(turn.draft).toBeDefined();
    const fix = world.mentor.requests[4]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain('That reply could not be used:');
    expect(fix).toContain('Draft the job now. Do not ask another question.');
  });

  it('fixes a reply it cannot use, once, and says what was wrong with it', async () => {
    world.mentor.script = (_request, call) =>
      call === 1
        ? question('Which region?', ['Only one'])
        : question('Which region?', ['North', 'South']);
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(turn.options).toEqual(['North', 'South', DRAFT_NOW]);
    expect(world.mentor.requests).toHaveLength(2);
    const sent = world.mentor.requests[1]?.messages ?? [];
    expect(sent.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(sent[2]?.content).toContain('That reply could not be used:');
    expect(sent[2]?.content).toContain('A question needs 2 to 4 different options');
    expect(sent[2]?.content).toContain('Reply again with the whole JSON object');

    // The bad reply is not part of the conversation the next turn builds on.
    world.mentor.script = () => draft();
    await world.drafting.reply(turn.sessionId, 'North', TEACHER);
    const next = world.mentor.requests[2]?.messages ?? [];
    expect(next.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(next[1]?.content).toContain('North');
  });

  it('gives up after one fix, and says why the draft could not be used', async () => {
    world.mentor.script = () => ({ action: 'maybe' });
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      /The draft couldn't be used: The reply doesn't have the shape asked for/,
    );
    expect(world.mentor.requests).toHaveLength(2);
  });

  it('does not repeat the message when the same reply is sent again after a failure', async () => {
    world.mentor.script = (_request, call) => {
      if (call === 2) throw new Error('The teacher did not answer in time.');
      return call === 1 ? question('Which region?', ['North', 'South']) : draft();
    };
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    await expect(world.drafting.reply(first.sessionId, 'North', TEACHER)).rejects.toThrow(
      'did not answer',
    );
    const retried = await world.drafting.reply(first.sessionId, 'North', TEACHER);
    expect(retried.draft).toBeDefined();
    expect(world.mentor.requests[2]?.messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
  });

  it('refuses a second message while the teacher is still answering the first', async () => {
    const release = deferred();
    world.mentor.script = async (_request, call) => {
      if (call === 2) await release.promise;
      return call === 1 ? question('Which region?', ['North', 'South']) : draft();
    };
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const waiting = world.drafting.reply(first.sessionId, 'North', TEACHER);
    await expect(world.drafting.reply(first.sessionId, 'South', TEACHER)).rejects.toThrow(
      'still working',
    );
    release.resolve();
    expect((await waiting).draft).toBeDefined();
  });

  it('forgets a conversation nobody came back to, and one that was never there', async () => {
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    world.clock.advance(61 * 60_000);
    await world.drafting.start('Another desk', attachShop(), TEACHER);
    await expect(world.drafting.reply(first.sessionId, 'North', TEACHER)).rejects.toBeInstanceOf(
      CodedError,
    );
    await expect(world.drafting.reply('drf_never', 'North', TEACHER)).rejects.toMatchObject({
      code: 'draft_not_found',
    });
  });
});

describe('what drafting costs', () => {
  it('keeps what every call to the teacher cost, with the job', async () => {
    world.mentor.script = (_request, call) =>
      call === 1 ? question('Which region?', ['North', 'South']) : draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const turn = await world.drafting.reply(first.sessionId, 'North', TEACHER);
    const record = recordOf(turn.draft?.id ?? '') as {
      cost: { calls: number; inputTokens: number; outputTokens: number; usd: number };
    };
    expect(record.cost.calls).toBe(2);
    expect(record.cost.inputTokens).toBe(4000);
    expect(record.cost.outputTokens).toBe(1000);
    expect(record.cost.usd).toBeCloseTo(2 * ((2000 * 1.25 + 500 * 4.25) / 1_000_000), 10);
  });

  it('stops before a call that could cost more than drafting may', async () => {
    const small = draftingWorld({ capUsd: 0.01 });
    try {
      small.mentor.script = () => question('Which region?', ['North', 'South']);
      await expect(
        small.drafting.start('A desk', [small.attach('customers.csv', data.customersCsv)], TEACHER),
      ).rejects.toBeInstanceOf(GuardError);
      await expect(
        small.drafting.start('A desk', [small.attach('customers.csv', data.customersCsv)], TEACHER),
      ).rejects.toThrow(/may cost the teacher at most \$0\.01\. The next step could cost up to/);
      expect(small.mentor.requests).toEqual([]);
    } finally {
      small.cleanup();
    }
  });

  it('will not start with a teacher whose price is not known', async () => {
    Object.assign(world.mentor, { estimateCostUsd: () => null });
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      "Architect doesn't know what the teacher costs",
    );
    expect(world.mentor.requests).toEqual([]);
  });
});

describe('drafting the job', () => {
  it('builds the job from the draft, snapshots the files and seals the final test', async () => {
    world.mentor.script = () => draft({ unresolved: ['Whether cancelled orders count in totals'] });
    const turn = await world.drafting.start('A desk for our shop', attachShop(), TEACHER);
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');
    expect(turn.options).toEqual([]);

    // What the teacher supplied, and what the application supplies.
    expect(job).toMatchObject({
      name: 'Shop desk',
      businessDate: '2026-11-24',
      requirements: { passRate: 0.9 },
      permissions: { writes: 'ask', unseenFiles: 'never' },
      checker: { kind: 'builtin' },
      startingHarness: { kind: 'blank' },
      budget: { maxRounds: 8, maxMentorUsd: 5, maxWallMinutes: 240 },
    });
    expect(job.id).toBe('shop-desk');
    expect({ mentor: job.mentor, student: job.student }).toEqual(shippedModels());
    expect(job.taskTypes.map((type) => type.id)).toEqual(['email', 'pending', 'totals']);
    expect(job.data.files).toEqual([
      {
        name: 'customers.csv',
        kind: 'table',
        access: 'read',
        description: 'One row per customer.',
      },
      { name: 'orders.csv', kind: 'table', access: 'read', description: 'One row per order.' },
      { name: 'policy.md', kind: 'text', access: 'read' },
    ]);
    const { splits } = job;
    expect(splits.calibration + splits.train + splits.dev + splits.test).toBeGreaterThanOrEqual(
      100,
    );
    expect(job.evaluation.trainBatch).toBeLessThanOrEqual(splits.train);
    expect(job.evaluation.minDevGain).toBeLessThanOrEqual(splits.dev);

    // Recorded as an import is: the job, its data as the person's files were, its tasks, its vault.
    expect(await world.jobs.get(job.id)).toEqual(job);
    expect(readFileSync(`${world.paths.dataDir(job.id)}/customers.csv`, 'utf8')).toBe(
      data.customersCsv,
    );
    expect(readFileSync(`${world.paths.dataDir(job.id)}/policy.md`, 'utf8')).toContain('30 days');
    const total = splits.calibration + splits.train + splits.dev + splits.test;
    expect(world.jobs.summaries()).toMatchObject([{ id: job.id, taskCount: total }]);
    expect(await world.jobs.tasks(job.id, 'train')).toHaveLength(splits.train);
    expect(await world.jobs.tasks(job.id, 'dev')).toHaveLength(splits.dev);
    expect(await world.jobs.tasks(job.id, 'calibration')).toHaveLength(splits.calibration);
    expect(world.vault.count(job.id)).toBe(splits.test);
    expect(world.store.contracts.latest(job.id)?.version).toBe(1);

    // Saving it from the Clarify screen works as for any job.
    expect(await world.jobs.save({ ...job, name: 'Shop desk' })).toMatchObject({ id: job.id });
    expect(world.jobs.summaries()).toHaveLength(1);

    // It says where it came from.
    expect(recordOf(job.id)).toMatchObject({
      format: 1,
      source: 'generated',
      teacher: { label: 'Muse Spark 1.3', model: 'scripted-spark' },
      unresolved: ['Whether cancelled orders count in totals'],
    });
    expect(turn.message).toBe(
      "I couldn't settle this from your files and answers, so I left it open:\nWhether cancelled orders count in totals.\n\nI've drafted the job for you to review.",
    );
  });

  it('makes the same job from the same files and answers', async () => {
    world.mentor.script = () => draft();
    const first = await world.drafting.start('A desk', attachShop(), TEACHER);
    const other = draftingWorld();
    try {
      other.mentor.script = () => draft();
      const second = await other.drafting.start(
        'A desk',
        [
          other.attach('customers.csv', data.customersCsv),
          other.attach('orders.csv', data.ordersCsv),
          other.attach('policy.md', '# Shop policy\n\nReturns are accepted for 30 days.\n'),
        ],
        TEACHER,
      );
      expect(second.draft?.splits).toEqual(first.draft?.splits);
      const a = await world.jobs.tasks(first.draft?.id ?? '', 'train');
      const b = await other.jobs.tasks(second.draft?.id ?? '', 'train');
      expect(b).toEqual(a);
    } finally {
      other.cleanup();
    }
  });

  it('asks nothing about the rows it showed the teacher, in any set, the final test included', async () => {
    world.mentor.script = () => draft();
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');
    const shown = data.customers.slice(0, 5).map((customer) => customer.id);
    // They really were in the first message: their keys are in the rows the teacher read.
    const told = world.mentor.requests[0]?.messages[0]?.content ?? '';
    for (const key of shown) expect(told).toContain(key);
    const proof = await releaseMentor({ dispose: () => undefined });
    const everything: Task[] = [
      ...world.vault.openForLockedTest(job.id, proof),
      ...(await world.jobs.tasks(job.id, 'train')),
      ...(await world.jobs.tasks(job.id, 'dev')),
      ...(await world.jobs.tasks(job.id, 'calibration')),
    ];
    const asked = everything
      .filter((task) => task.type === 'email')
      .map((task) => task.meta?.['key']);
    expect(asked.length).toBeGreaterThan(20);
    for (const key of shown) expect(asked).not.toContain(key);
    expect(recordOf(job.id)['notes']).toContainEqual(
      expect.stringContaining('the teacher read the rows they are about while drafting'),
    );
  });

  it('keeps one question out of both the practice tasks and the final test, however two kinds of task were written', async () => {
    const list = (id: string, first: string, second: string) => ({
      ...NO_TYPE,
      id,
      label: `Orders by ${first} and ${second}`,
      description: 'List the orders of a customer in a region.',
      template: 'filtered_list' as const,
      table: 'orders.csv',
      keyColumn: 'order_id',
      filters: [first, second].map((column) => ({
        column,
        op: 'equals' as const,
        value: '',
        varies: true,
      })),
      request: 'Which orders did customer {customer_id} place in the {region} region?',
    });
    world.mentor.script = (_request, call) =>
      call === 1
        ? draft({
            taskTypes: [
              EMAIL_TYPE,
              list('by_customer', 'customer_id', 'region'),
              list('by_region', 'region', 'customer_id'),
            ],
          })
        : draft({ taskTypes: [EMAIL_TYPE, list('by_customer', 'customer_id', 'region')] });
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain(
      'Task type "by_region" (Orders by region and customer_id): Every request of this kind asks what "Orders by customer_id and region" already asks, in other words',
    );
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');
    const proof = await releaseMentor({ dispose: () => undefined });
    const asked = (tasks: readonly Task[]) =>
      tasks
        .filter((task) => task.type === 'by_customer')
        .map((task) => JSON.stringify([task.meta?.['customer_id'], task.meta?.['region']]));
    const held = asked(world.vault.openForLockedTest(job.id, proof));
    const seen = new Set([
      ...asked(await world.jobs.tasks(job.id, 'train')),
      ...asked(await world.jobs.tasks(job.id, 'dev')),
      ...asked(await world.jobs.tasks(job.id, 'calibration')),
    ]);
    expect(held.length).toBeGreaterThan(5);
    expect(held.filter((question) => seen.has(question))).toEqual([]);
  });

  it('never shows the teacher a task, and keeps the review examples out of the final test', async () => {
    world.mentor.script = () => draft();
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');
    const proof = await releaseMentor({ dispose: () => undefined });
    const test: Task[] = world.vault.openForLockedTest(job.id, proof);
    expect(test).toHaveLength(job.splits.test);
    const visible: Task[] = [
      ...(await world.jobs.tasks(job.id, 'train')),
      ...(await world.jobs.tasks(job.id, 'dev')),
      ...(await world.jobs.tasks(job.id, 'calibration')),
    ];

    // No request of the conversation holds the text of any task.
    const sent = world.mentor.requests.map(textOf).join('\n');
    for (const task of [...test, ...visible])
      expect(sent).not.toContain(task.prompt.split('\n')[0]);

    // Families never cross the final test's edge, so no example is a relative of a test task.
    const testFamilies = new Set(test.map((task) => task.family));
    expect(visible.some((task) => testFamilies.has(task.family))).toBe(false);

    const plan = await world.jobs.taskPlan(job.id);
    const asked = new Set(test.map((task) => task.prompt.split('\n')[0]));
    const trainAndStart = new Set(
      [
        ...(await world.jobs.tasks(job.id, 'train')),
        ...(await world.jobs.tasks(job.id, 'calibration')),
      ].map((task) => task.prompt.split('\n')[0]),
    );
    expect(plan.types.flatMap((type) => type.examples)).not.toHaveLength(0);
    for (const example of plan.types.flatMap((type) => type.examples)) {
      expect(asked.has(example.request)).toBe(false);
      expect(trainAndStart.has(example.request)).toBe(true);
    }
  });

  it('shows the plan: where tasks came from, the rule of each type, three examples and the counts', async () => {
    world.mentor.script = () => draft({ unresolved: ['Whether cancelled orders count in totals'] });
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');
    const plan = await world.jobs.taskPlan(job.id);
    expect(plan.source).toBe('generated');
    expect(plan.unresolved).toEqual(['Whether cancelled orders count in totals']);
    expect(plan.counts).toEqual({
      calibration: job.splits.calibration,
      train: job.splits.train,
      dev: job.splits.dev,
      test: job.splits.test,
    });
    expect(plan.types.map((type) => [type.id, type.rule])).toEqual([
      ['email', 'Look up email by customer_id, from customers.csv'],
      ['pending', 'List the order_id in orders.csv where status is Pending, for each customer_id'],
      [
        'totals',
        'Total of amount for each region, within a range of dates in order_date, from orders.csv',
      ],
    ]);
    for (const type of plan.types) {
      expect(type.examples.length).toBeGreaterThan(0);
      expect(type.examples.length).toBeLessThanOrEqual(3);
      expect(
        type.counts.train + type.counts.dev + type.counts.test + type.counts.calibration,
      ).toBeGreaterThan(5);
      for (const example of type.examples) {
        expect(example.request).not.toContain('End with:');
        expect(example.answer).toBeDefined();
      }
    }
    const [email] = plan.types;
    expect(email?.examples[0]?.request).toMatch(/^What is the email of customer C-\d+\?$/);
    expect(email?.examples[0]?.answer).toMatch(/^email: .+@example\.com$/);
    const totals = plan.types[2];
    expect(totals?.examples[0]?.answer).toMatch(/^total: -?\d+(\.\d+)?$/);
    expect(totals?.examples[0]?.request).toContain('Both dates are included.');
  });

  it('sends back a column that is not there, with the columns the table has', async () => {
    const wrong = {
      ...PENDING_TYPE,
      filters: [
        { column: 'status', op: 'equals', value: 'Unshipped', varies: false },
        { column: 'customer_id', op: 'equals', value: '', varies: true },
      ],
    };
    world.mentor.script = (_request, call) =>
      call === 1
        ? draft({ taskTypes: [EMAIL_TYPE, wrong] })
        : draft({ taskTypes: [EMAIL_TYPE, PENDING_TYPE] });
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(turn.draft?.taskTypes.map((type) => type.id)).toEqual(['email', 'pending']);
    expect(world.mentor.requests).toHaveLength(2);
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    // The values it names are the ones the profile already told it, said as many and as examples.
    expect(fix).toMatch(
      /Task type "pending" \(Pending orders\): No row of orders\.csv meets "status is Unshipped"\. status has 3 different values, such as (Cancelled|Pending|Shipped), /,
    );
    expect(fix).toContain('Pending');
    expect(fix).toContain('Shipped');
    expect(recordOf(turn.draft?.id ?? '')).toMatchObject({ cost: { calls: 2 } });
  });

  it('says so when a draft names a file that was not attached, and what was attached', async () => {
    world.mentor.script = (_request, call) =>
      call === 1
        ? draft({ files: [{ name: 'invoices.csv', description: 'Invoices.', access: 'read' }] })
        : draft();
    const turn = await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(turn.draft).toBeDefined();
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain(
      'The file "invoices.csv" wasn\'t attached. The attached files are customers.csv, orders.csv, policy.md.',
    );
  });

  it('leaves out a kind of task the files support too few requests of, and says so', async () => {
    // Ten rows, of which the teacher is shown the first five: nothing is asked about those.
    const small = world.attach(
      'regions.csv',
      ['code,name', ...Array.from({ length: 10 }, (_, i) => `R-${i},Region ${i}`)].join('\n'),
    );
    const thin = {
      ...EMAIL_TYPE,
      id: 'regions',
      label: 'Region names',
      table: 'regions.csv',
      keyColumn: 'code',
      columns: ['name'],
      request: 'Name of region {key}?',
    };
    world.mentor.script = () => draft({ taskTypes: [EMAIL_TYPE, thin, PENDING_TYPE] });
    const turn = await world.drafting.start('A desk', [...attachShop(), small], TEACHER);
    expect(world.mentor.requests).toHaveLength(2);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'Task type "regions" (Region names) supports only 5 different requests, and at least 6 are needed.',
    );
    expect(turn.draft?.taskTypes.map((type) => type.id)).toEqual(['email', 'pending']);
    expect(turn.message).toBe(
      'I left out "Region names", because your files support only 5 different requests of that kind.\n\nI\'ve drafted the job for you to review.',
    );
    expect(recordOf(turn.draft?.id ?? '').notes).toContain(
      'Left out "Region names": the files support only 5 different requests of that kind.',
    );
  });

  it('refuses a draft whose kind of task cannot be made even after the fix', async () => {
    const wrong = { ...TOTAL_TYPE, groupColumn: 'area' };
    world.mentor.script = () => draft({ taskTypes: [EMAIL_TYPE, wrong] });
    await expect(world.drafting.start('A desk', attachShop(), TEACHER)).rejects.toThrow(
      /The draft couldn't be used: Task type "totals" \(Region totals\): The grouping column "area" isn't a column of orders\.csv/,
    );
    expect(world.mentor.requests).toHaveLength(2);
    expect(world.jobs.summaries()).toEqual([]);
  });

  it('records no job while it is still asking', async () => {
    world.mentor.script = () => question('Which region?', ['North', 'South']);
    await world.drafting.start('A desk', attachShop(), TEACHER);
    expect(world.jobs.summaries()).toEqual([]);
    expect(world.store.jobs.list()).toEqual([]);
  });

  it('ends the conversation when the files support too few tasks to train on, and says how many', async () => {
    // Forty rows, but only four different emails: no answer may be right for more than three.
    const repeated = world.attach(
      'people.csv',
      ['id,email', ...Array.from({ length: 40 }, (_, i) => `P-${i},p${i % 4}@example.com`)].join(
        '\n',
      ),
    );
    world.mentor.script = () =>
      draft({
        taskTypes: [{ ...EMAIL_TYPE, table: 'people.csv', keyColumn: 'id', columns: ['email'] }],
        files: [],
      });
    const turn = await world.drafting.start('A desk', [repeated], TEACHER);
    expect(turn.draft).toBeUndefined();
    expect(turn).toMatchObject({ ended: true, options: [] });
    expect(turn.message).toContain('support only 12 different tasks I can check');
    expect(turn.message).toContain('training needs at least 30');
    expect(turn.message).toContain('tasks.jsonl');
    expect(world.jobs.summaries()).toEqual([]);
    await expect(world.drafting.reply(turn.sessionId, 'More', TEACHER)).rejects.toMatchObject({
      code: 'draft_not_found',
    });
  });
});

describe('a tasks file', () => {
  function tasksFile(count: number, types: string[] = ['refund', 'order']): string {
    return Array.from({ length: count }, (_, i) => {
      const type = types[i % types.length];
      return JSON.stringify({
        id: `${type}-${i}`,
        type,
        family: `case-${i}`,
        prompt: `ZEBRA-CANARY-7731 request ${i}: how much was case ${i}?\nEnd with: ANSWER: {"amount": <number>}`,
        expected: { kind: 'answer', value: { amount: i }, compare: { mode: 'exact' } },
      });
    }).join('\n');
  }

  const typesOf = (labels: Record<string, string>) =>
    Object.entries(labels).map(([id, label]) => ({
      ...NO_TYPE,
      id,
      label,
      description: `${label}.`,
    }));

  it('is used as the tasks and never sent to the teacher, only its count and types', async () => {
    world.mentor.script = () =>
      draft({
        taskTypes: [
          ...typesOf({ refund: 'Refunds', order: 'Order questions' }),
          ...typesOf({ invented: 'Made up' }),
        ],
        files: [{ name: 'customers.csv', description: 'Customers.', access: 'read' }],
      });
    const turn = await world.drafting.start(
      'A desk',
      [
        world.attach('customers.csv', data.customersCsv),
        world.attach('tasks.jsonl', tasksFile(60)),
      ],
      TEACHER,
    );
    const job = turn.draft;
    if (!job) throw new Error('Expected a draft.');

    const sent = world.mentor.requests.map(textOf).join('\n');
    expect(sent).not.toContain('ZEBRA-CANARY-7731');
    expect(sent).not.toContain('how much was case');
    expect(sent).toContain('### tasks.jsonl (example tasks)');
    expect(sent).toContain('60 example tasks');
    expect(sent).toContain('30 of type "refund", 30 of type "order"');
    expect(sent).not.toContain('refund-0');

    expect(job.taskTypes).toEqual([
      { id: 'refund', label: 'Refunds', description: 'Refunds.' },
      { id: 'order', label: 'Order questions', description: 'Order questions.' },
    ]);
    const used = [
      ...(await world.jobs.tasks(job.id, 'train')),
      ...(await world.jobs.tasks(job.id, 'dev')),
      ...(await world.jobs.tasks(job.id, 'calibration')),
    ];
    expect(used.length + world.vault.count(job.id)).toBe(60);
    expect(used.every((task) => task.prompt.includes('ZEBRA-CANARY-7731'))).toBe(true);
    expect(job.splits).toMatchObject({ test: 20, dev: 15, calibration: 5, train: 20 });
    expect(recordOf(job.id)).toMatchObject({ source: 'attached' });

    const plan = await world.jobs.taskPlan(job.id);
    expect(plan.source).toBe('attached');
    expect(plan.types[0]?.rule).toBeUndefined();
    expect(plan.types[0]?.examples[0]?.request).toContain('how much was case');
  });

  it('is refused with its count when it holds too few tasks, before the teacher is asked', async () => {
    const turn = await world.drafting.start(
      'A desk',
      [world.attach('tasks.jsonl', tasksFile(12))],
      TEACHER,
    );
    expect(turn).toMatchObject({ ended: true });
    expect(turn.message).toContain('tasks.jsonl has 12 tasks, and training needs at least 30.');
    expect(world.mentor.requests).toEqual([]);
  });

  it('is refused when a line is not a task, with the line', async () => {
    const lines = tasksFile(40).split('\n');
    lines[6] = JSON.stringify({ id: 'x', type: 'refund' });
    await expect(
      world.drafting.start('A desk', [world.attach('tasks.jsonl', lines.join('\n'))], TEACHER),
    ).rejects.toThrow(/tasks\.jsonl, line 7 isn't a task Architect can read/);
    lines[6] = 'not json';
    await expect(
      world.drafting.start('A desk', [world.attach('tasks.jsonl', lines.join('\n'))], TEACHER),
    ).rejects.toThrow("tasks.jsonl, line 7 isn't JSON.");
    const endState = tasksFile(40).split('\n');
    endState[0] = JSON.stringify({
      id: 'e',
      type: 'refund',
      family: 'e',
      prompt: 'Record it.',
      expected: { kind: 'end_state', validator: 'v', params: {} },
    });
    await expect(
      world.drafting.start('A desk', [world.attach('tasks.jsonl', endState.join('\n'))], TEACHER),
    ).rejects.toThrow('expects an end state, which needs a checker file');
    expect(world.mentor.requests).toEqual([]);
  });
});
