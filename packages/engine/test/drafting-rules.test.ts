import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DraftRecordSchema,
  RuleConfirmationSchema,
  RuleReportSchema,
  type DraftRecord,
  type MentorCompletionRequest,
  type Task,
} from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Of } from '../src/drafting/confirmation';
import { DRAFT_NOW } from '../src/drafting/envelope';
import { MAX_RULE_QUESTIONS } from '../src/drafting/drafter';
import { RunController } from '../src/loop/controller';
import {
  draft,
  draftingWorld,
  NO_TYPE,
  question,
  TEACHER,
  type DraftingWorld,
} from './support/drafting-world';
import { bikeShop, POLICY, type Bike } from './support/rule-data';
import { bikeDraft, bikeSteps, costType, CONTACT_TYPE, step, wireRule } from './support/rule-draft';

let world: DraftingWorld;
let bike: Bike;

beforeEach(() => {
  world = draftingWorld();
  bike = bikeShop({ offGrid: true });
});

afterEach(() => {
  world.cleanup();
});

function attachBike(): string[] {
  return [
    world.attach('customers.csv', bike.customersCsv),
    world.attach('tickets.csv', bike.ticketsCsv),
    world.attach('policy.md', POLICY),
  ];
}

const TEXT = (request: MentorCompletionRequest): string =>
  [request.system, ...request.messages.map((message) => message.content)].join('\n');

function recordOf(jobId: string): DraftRecord {
  return DraftRecordSchema.parse(JSON.parse(readFileSync(world.paths.draftingFile(jobId), 'utf8')));
}

async function draftedJob(reply: unknown = bikeDraft()) {
  world.mentor.script = () => reply;
  const turn = await world.drafting.start('A repair desk for our bike shop', attachBike(), TEACHER);
  if (turn.draft === undefined) throw new Error(turn.message);
  return turn.draft;
}

describe('asking the teacher for a rule', () => {
  it('tells it how to write a rule, and holds its reply to a format with no loop in it', async () => {
    world.mentor.script = () => question('Which ticket?', ['A', 'B']);
    await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const [request] = world.mentor.requests;
    for (const phrase of [
      'rule: a number that is not written in the records but follows from a policy',
      'at most 32 parts in all, 6 operations nested inside one another and 2 ifs',
      'copied word for word',
      'never from patterns in the rows',
      'There is no "not"',
      'the person is asked before any task is made',
    ]) {
      expect(request?.system).toContain(phrase);
    }
    const schema = JSON.stringify(request?.json?.schema);
    expect(schema).not.toContain('$ref');
    expect(schema).not.toContain('$defs');
    expect(schema).toContain('"ambiguities"');
    expect(schema).toContain('"changesAnswers"');
    // The rule is a list of steps that name each other by id, so the format is no deeper than
    // the rest of it: providers that limit how deep a schema nests accept it.
    const found = (schema: unknown): number => {
      if (schema === null || typeof schema !== 'object') return 0;
      const node = schema as Record<string, unknown>;
      const inner = Object.values((node['properties'] ?? {}) as object).map(found);
      const items = node['items'] === undefined ? 0 : found(node['items']);
      return (node['type'] === 'object' ? 1 : 0) + Math.max(0, items, ...inner);
    };
    expect(found(request?.json?.schema)).toBeLessThanOrEqual(6);
    expect(request?.system).toContain('rule.steps and rule.result');
    expect(request?.system).toContain('Every step must be used');
  });
});

describe('drafting a job with a rule', () => {
  it('makes the tasks, works every answer out itself, and keeps the rule with its examples', async () => {
    const job = await draftedJob();
    const record = recordOf(job.id);
    expect(record.source).toBe('generated');
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.spec?.template).toBe('rule');
    expect(cost?.details?.statement).toBe(
      'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, halves going up.',
    );
    expect(cost?.rule).toContain('Work out total for each ticket_id of tickets.csv:');
    expect(cost?.details?.passages).toHaveLength(2);
    expect(record.files?.map((file) => file.name).sort()).toEqual([
      'customers.csv',
      'policy.md',
      'tickets.csv',
    ]);
    // The tasks are the rule's own: each one asks about a ticket and expects the number the rule
    // works out, to be written as {"total": ...}.
    const train = (await world.jobs.tasks(job.id, 'train')).filter((task) => task.type === 'cost');
    expect(train.length).toBeGreaterThan(10);
    for (const task of train) {
      expect(task.prompt).toMatch(
        /^What does ticket T-\d+ cost the customer\?\nGive the amount in US dollars as a plain number, without a currency sign or commas\.\nEnd with: ANSWER: \{"total": <number>\}$/,
      );
      expect(task.expected).toMatchObject({ kind: 'answer', compare: { mode: 'number' } });
    }
  });

  it('shows examples that are practice or starting tasks, never a check task or the final test', async () => {
    const job = await draftedJob();
    const cost = recordOf(job.id).types.find((type) => type.id === 'cost');
    const visible = new Set<string>();
    for (const split of ['train', 'calibration'] as const) {
      for (const task of await world.jobs.tasks(job.id, split)) visible.add(task.id);
    }
    const hidden = new Set<string>();
    for (const task of await world.jobs.tasks(job.id, 'dev')) hidden.add(task.id);
    const sealed = readFileSync(join(world.dataDir, 'vault', job.id, 'test.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Task);
    for (const task of sealed) hidden.add(task.id);
    const examples = cost?.details?.examples ?? [];
    expect(examples.length).toBeGreaterThanOrEqual(3);
    for (const example of examples) {
      if (example.taskId === undefined) continue;
      expect(visible.has(example.taskId), example.taskId).toBe(true);
      expect(hidden.has(example.taskId), example.taskId).toBe(false);
    }
    // The tickets of the check tasks and the final test appear in no example's request.
    const requests = examples.map((example) => example.request).join('\n');
    for (const task of [...sealed, ...(await world.jobs.tasks(job.id, 'dev'))]) {
      if (task.type !== 'cost') continue;
      const key = String(task.meta?.['key']);
      if (examples.some((example) => example.taskId !== undefined)) {
        expect(requests).not.toContain(`ticket ${key} `);
        expect(requests).not.toContain(`ticket ${key}?`);
      }
    }
  });

  it('puts every ticket in one set, whatever the words and the families of the kinds that ask about it', async () => {
    // Two rules that work out the same total in another order, asked in other words, with another
    // family column: one question to an agent, a ticket's answer in the practice tasks and in the
    // final test. A ticket is the subject of one request, so there is no twin to put apart.
    const swapped = bikeSteps().map((item) =>
      item.id === 'sum' ? { ...item, args: ['parts', 'labor'] } : item,
    );
    const price = costType(
      { familyColumn: 'customer_id', steps: swapped },
      { id: 'price', label: 'Ticket prices', request: 'How much does ticket {key} cost?' },
    );
    const job = await draftedJob(bikeDraft([costType(), price, CONTACT_TYPE]));
    const sealed = readFileSync(join(world.dataDir, 'vault', job.id, 'test.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as Task);
    const sets = {
      calibration: await world.jobs.tasks(job.id, 'calibration'),
      train: await world.jobs.tasks(job.id, 'train'),
      dev: await world.jobs.tasks(job.id, 'dev'),
      test: sealed,
    };
    const tickets = new Map<string, string>();
    for (const [name, tasks] of Object.entries(sets)) {
      for (const task of tasks.filter((item) => item.type === 'cost' || item.type === 'price')) {
        const key = String(task.meta?.['key']);
        expect(
          tickets.has(key),
          `${key} is asked about in ${tickets.get(key)} and in ${name}`,
        ).toBe(false);
        tickets.set(key, name);
      }
    }
    // Both kinds of rule still have tasks in the final test and in the practice tasks.
    for (const id of ['cost', 'price']) {
      expect(
        sets.test.some((task) => task.type === id),
        id,
      ).toBe(true);
      expect(
        sets.train.some((task) => task.type === id),
        id,
      ).toBe(true);
    }
  });

  it('shows the plan with the rule, its examples and a rule that waits to be confirmed', async () => {
    const job = await draftedJob();
    const plan = await world.jobs.taskPlan(job.id);
    expect(plan.confirmation).toMatchObject({ state: 'needed' });
    expect(plan.confirmation?.token).toMatch(/^[0-9a-f]{16}$/);
    const cost = plan.types.find((type) => type.id === 'cost');
    expect(cost?.details?.version).toMatch(/^[0-9a-f]{12}$/);
    expect(cost?.details?.examples.length).toBeGreaterThanOrEqual(3);
    expect(plan.types.find((type) => type.id === 'email')?.details).toBeUndefined();
    // A job with no rule has nothing to confirm.
    const other = draftingWorld();
    try {
      other.mentor.script = () =>
        bikeDraft([
          CONTACT_TYPE,
          {
            ...CONTACT_TYPE,
            id: 'second',
            columns: ['name'],
            request: 'What is the name of customer {key}?',
          },
        ]);
      const turn = await other.drafting.start(
        'A repair desk',
        [
          other.attach('customers.csv', bike.customersCsv),
          other.attach('tickets.csv', bike.ticketsCsv),
          other.attach('policy.md', POLICY),
        ],
        TEACHER,
      );
      expect(turn.draft).toBeDefined();
      expect((await other.jobs.taskPlan(turn.draft?.id ?? '')).confirmation).toBeUndefined();
      await expect(other.jobs.requireConfirmedRules(turn.draft ?? job)).resolves.toBeUndefined();
    } finally {
      other.cleanup();
    }
  });
});

describe('the confirmation that binds', () => {
  it('refuses training until the person confirms the rule over these records', async () => {
    const job = await draftedJob();
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_unconfirmed',
    });
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    const confirmed = await world.jobs.confirmRules(job.id, token);
    expect(confirmed.state).toBe('confirmed');
    await expect(world.jobs.requireConfirmedRules(job)).resolves.toBeUndefined();
    const saved = RuleConfirmationSchema.parse(
      JSON.parse(readFileSync(world.paths.confirmationFile(job.id), 'utf8')),
    );
    expect(saved.rules).toEqual([
      { typeId: 'cost', version: expect.stringMatching(/^[0-9a-f]{12}$/) },
    ]);
    expect(saved.files.map((file) => file.name).sort()).toEqual([
      'customers.csv',
      'policy.md',
      'tickets.csv',
    ]);
    expect((await world.jobs.taskPlan(job.id)).confirmation).toMatchObject({
      state: 'confirmed',
      confirmedAt: confirmed.confirmedAt,
    });
  });

  it('gives the report the rule as confirmed: its words, its expression and when, never an example', async () => {
    const job = await draftedJob();
    // Nothing is confirmed, so there is no rule for a report to say.
    expect(await world.jobs.ruleReports(job.id)).toEqual([]);
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    const confirmed = await world.jobs.confirmRules(job.id, token);
    const [rule, ...others] = await world.jobs.ruleReports(job.id);
    expect(others).toEqual([]);
    expect(RuleReportSchema.safeParse(rule).success).toBe(true);
    expect(rule).toMatchObject({
      typeId: 'cost',
      label: 'Ticket totals',
      confirmedAt: confirmed.confirmedAt,
      expression: { op: 'round', increment: '0.01', mode: 'half_up' },
      cases: { total: 160 },
    });
    expect(rule?.statement).toContain('Add parts cost.');
    expect(rule).not.toHaveProperty('examples');
    expect(rule).not.toHaveProperty('uncovered');
  });

  it('stops every kind of run at the controller, not only a button on a screen', async () => {
    const job = await draftedJob();
    const controller = new RunController({
      store: world.store,
      paths: world.paths,
      jobs: world.jobs,
      deps: world.deps,
    });
    for (const method of ['architect', 'bare', 'one_shot', 'self_reflection'] as const) {
      await expect(controller.start(job.id, method)).rejects.toMatchObject({
        code: 'rule_unconfirmed',
      });
    }
    // Confirmed over records that have since changed: refused too, with the other reason.
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    writeFileSync(
      join(world.paths.dataDir(job.id), 'tickets.csv'),
      `${bike.ticketsCsv}T-9999,C-101,Open,1,2\n`,
    );
    await expect(controller.start(job.id, 'architect')).rejects.toMatchObject({
      code: 'rule_changed',
    });
    expect(world.store.runs.list(job.id)).toEqual([]);
  });

  it('will not confirm what the person did not see: a stale token is refused', async () => {
    const job = await draftedJob();
    await expect(world.jobs.confirmRules(job.id, 'not-the-token')).rejects.toMatchObject({
      code: 'rule_changed',
    });
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_unconfirmed',
    });
  });

  it('asks again when a record changes after it was confirmed, and wants new tasks', async () => {
    const job = await draftedJob();
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    const policy = join(world.paths.dataDir(job.id), 'policy.md');
    writeFileSync(policy, POLICY.replace('$65', '$70'));
    const state = await world.jobs.ruleState(job.id);
    expect(state?.state).toBe('changed');
    expect(state?.problem).toContain('policy.md is not the file the tasks were made from');
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_changed',
    });
    // Confirming over the new file does not bring it back: the tasks are from the old one.
    await expect(world.jobs.confirmRules(job.id, state?.token ?? '')).rejects.toMatchObject({
      code: 'rule_changed',
    });
    // Put the file back and the confirmation holds again.
    writeFileSync(policy, POLICY);
    expect((await world.jobs.ruleState(job.id))?.state).toBe('confirmed');
  });

  it('will not confirm records that are not the ones the tasks were made from, changed or gone', async () => {
    const job = await draftedJob();
    const customers = join(world.paths.dataDir(job.id), 'customers.csv');
    writeFileSync(customers, `${bike.customersCsv}C-999,Extra,extra@example.com,yes\n`);
    const changed = await world.jobs.ruleState(job.id);
    expect(changed?.state).toBe('changed');
    expect(changed?.problem).toContain('customers.csv is not the file the tasks were made from');
    await expect(world.jobs.confirmRules(job.id, changed?.token ?? '')).rejects.toMatchObject({
      code: 'rule_changed',
    });
    // A file that is gone is as changed as one that was edited.
    writeFileSync(customers, bike.customersCsv);
    expect((await world.jobs.ruleState(job.id))?.state).toBe('needed');
    rmSync(join(world.paths.dataDir(job.id), 'policy.md'));
    expect(await world.jobs.ruleState(job.id)).toMatchObject({
      state: 'changed',
      problem: expect.stringContaining('policy.md is not the file the tasks were made from'),
    });
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_changed',
    });
  });

  it('asks again when a file is added to the job, whenever, and when one is taken away', async () => {
    const job = await draftedJob();
    const jobFile = world.paths.jobFile(job.id);
    const stored = () =>
      JSON.parse(readFileSync(jobFile, 'utf8')) as { data: { files: { name: string }[] } };
    const addExtra = () => {
      const next = stored();
      next.data.files.push({ name: 'extra.csv', kind: 'table', access: 'read' } as never);
      writeFileSync(jobFile, JSON.stringify(next));
      writeFileSync(join(world.paths.dataDir(job.id), 'extra.csv'), 'id,note\n1,a\n');
    };

    // Added before anyone confirmed: the tasks were made without it, so confirming is refused.
    addExtra();
    const added = await world.jobs.ruleState(job.id);
    expect(added?.state).toBe('changed');
    expect(added?.problem).toContain('extra.csv was added after the tasks were made.');
    await expect(world.jobs.confirmRules(job.id, added?.token ?? '')).rejects.toMatchObject({
      code: 'rule_changed',
    });
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_changed',
    });

    // Taken away again, the job is the one the rule was made for, and can be confirmed.
    const next = stored();
    next.data.files = next.data.files.filter((file) => file.name !== 'extra.csv');
    writeFileSync(jobFile, JSON.stringify(next));
    const back = await world.jobs.ruleState(job.id);
    expect(back?.state).toBe('needed');
    await world.jobs.confirmRules(job.id, back?.token ?? '');
    expect((await world.jobs.ruleState(job.id))?.state).toBe('confirmed');

    // Added after it was confirmed: no longer what the person looked at.
    addExtra();
    const later = await world.jobs.ruleState(job.id);
    expect(later?.state).toBe('changed');
    expect(later?.token).not.toBe(back?.token);
    await expect(world.jobs.requireConfirmedRules(job)).rejects.toMatchObject({
      code: 'rule_changed',
    });

    // A file taken out of the job's list is as changed as one deleted.
    const without = stored();
    without.data.files = without.data.files.filter((file) => file.name !== 'policy.md');
    writeFileSync(jobFile, JSON.stringify(without));
    expect((await world.jobs.ruleState(job.id))?.problem).toContain(
      'is not the file the tasks were made from',
    );
  });

  it('compares what was confirmed with the files by name as well as by what is in them', async () => {
    const job = await draftedJob();
    // The extra file is one the tasks were made from, so the draft's own list allows it.
    const jobFile = world.paths.jobFile(job.id);
    const stored = JSON.parse(readFileSync(jobFile, 'utf8')) as { data: { files: object[] } };
    stored.data.files.push({ name: 'extra.csv', kind: 'table', access: 'read' });
    writeFileSync(jobFile, JSON.stringify(stored));
    const bytes = Buffer.from('id,note\n1,a\n');
    writeFileSync(join(world.paths.dataDir(job.id), 'extra.csv'), bytes);
    const record = recordOf(job.id);
    writeFileSync(
      world.paths.draftingFile(job.id),
      JSON.stringify({
        ...record,
        files: [...(record.files ?? []), { name: 'extra.csv', sha256: sha256Of(bytes) }],
      }),
    );
    const needed = await world.jobs.ruleState(job.id);
    expect(needed?.state).toBe('needed');
    await world.jobs.confirmRules(job.id, needed?.token ?? '');
    expect((await world.jobs.ruleState(job.id))?.state).toBe('confirmed');

    // A confirmation from before the file was part of the job doesn't cover it.
    const saved = RuleConfirmationSchema.parse(
      JSON.parse(readFileSync(world.paths.confirmationFile(job.id), 'utf8')),
    );
    writeFileSync(
      world.paths.confirmationFile(job.id),
      JSON.stringify({
        ...saved,
        files: saved.files.filter((file) => file.name !== 'extra.csv'),
      }),
    );
    const state = await world.jobs.ruleState(job.id);
    expect(state?.state).toBe('changed');
    expect(state?.problem).toContain('extra.csv was added after you confirmed the rule.');
  });

  it('asks again when the rule itself is not the one confirmed', async () => {
    const job = await draftedJob();
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    const file = world.paths.draftingFile(job.id);
    const record = recordOf(job.id);
    const edited = {
      ...record,
      types: record.types.map((type) =>
        type.spec?.template === 'rule'
          ? { ...type, spec: { ...type.spec, currency: 'CAD' } }
          : type,
      ),
    };
    writeFileSync(file, JSON.stringify(edited));
    const state = await world.jobs.ruleState(job.id);
    expect(state).toMatchObject({ state: 'changed' });
    expect(state?.problem).toContain('The rule is not the one you confirmed');
  });

  it('keeps one confirmation apart from another job drafted from changed records', async () => {
    const first = await draftedJob();
    const { token } = (await world.jobs.ruleState(first.id)) ?? { token: '' };
    await world.jobs.confirmRules(first.id, token);
    // The same records with one number changed make a job that nobody has confirmed.
    bike = bikeShop({ offGrid: true, seed: 'another' });
    const second = await draftedJob();
    expect(second.id).not.toBe(first.id);
    expect((await world.jobs.ruleState(second.id))?.state).toBe('needed');
    expect((await world.jobs.ruleState(first.id))?.state).toBe('confirmed');
  });
});

describe('a question the policy leaves open', () => {
  const OPEN = {
    question: 'Does the 10% off for members also apply to the parts?',
    options: ['No, labor only', 'Yes, parts too'],
    changesAnswers: true,
  };

  it('asks the person instead of drafting, and drafts once it is answered', async () => {
    world.mentor.script = (_request, call) =>
      call === 1
        ? bikeDraft([costType({ ambiguities: [OPEN] }), CONTACT_TYPE])
        : bikeDraft([
            costType({
              sources: [
                {
                  file: 'policy.md',
                  passage: 'Labor is billed at $65 an hour, in half-hour steps.',
                },
                { file: 'answers', passage: 'No, labor only' },
              ],
            }),
            CONTACT_TYPE,
          ]);
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(first.draft).toBeUndefined();
    expect(first.message).toBe(OPEN.question);
    // No way to draft anyway: the question changes the numbers.
    expect(first.options).toEqual(['No, labor only', 'Yes, parts too']);
    expect(first.options).not.toContain(DRAFT_NOW);
    // Nothing was made while a question about the rule is open.
    expect(world.store.jobs.list()).toEqual([]);

    const second = await world.drafting.reply(first.sessionId, 'No, labor only', TEACHER);
    expect(second.draft?.name).toBe('Repair desk');
    const told = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(told).toContain('Question: Does the 10% off for members also apply to the parts?');
    expect(told).toContain('Answer: No, labor only');
    expect(told).toContain('do not list this question in ambiguities again');
    expect(world.mentor.requests[1]?.json?.schema['properties']).toMatchObject({
      action: { enum: ['draft'] },
    });
    const record = recordOf(second.draft?.id ?? '');
    expect(record.answers).toEqual([{ question: OPEN.question, answer: 'No, labor only' }]);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.details?.passages.map((item) => item.file)).toEqual(['policy.md', 'answers']);
    // The record keeps the passage as it was quoted. The plan the person reads names the question
    // the answer was given to, found in the answers the draft kept.
    expect(cost?.details?.passages[1]).toEqual({ file: 'answers', passage: 'No, labor only' });
    const plan = await world.jobs.taskPlan(second.draft?.id ?? '');
    expect(plan.types.find((type) => type.id === 'cost')?.details?.passages).toEqual([
      { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
      { file: 'answers', passage: 'No, labor only', question: OPEN.question },
    ]);
  });

  it('is asked even when the person chose to draft now, and "Draft it now" does not answer it', async () => {
    world.mentor.script = (_request, call) => {
      if (call === 1) return question('Should I count cancelled tickets?', ['Yes', 'No']);
      return bikeDraft([costType({ ambiguities: [OPEN] }), CONTACT_TYPE]);
    };
    const asked = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(asked.options).toContain(DRAFT_NOW);
    const now = await world.drafting.reply(asked.sessionId, DRAFT_NOW, TEACHER);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      'Draft the job now from what you have',
    );
    expect(now.draft).toBeUndefined();
    expect(now.message).toBe(OPEN.question);
    expect(now.options).not.toContain(DRAFT_NOW);

    // Typing it as the answer asks the question again, and asks the teacher nothing.
    const before = world.mentor.requests.length;
    const again = await world.drafting.reply(now.sessionId, 'draft it now', TEACHER);
    expect(again.draft).toBeUndefined();
    expect(again.message).toContain(OPEN.question);
    expect(again.message).toContain('it needs an answer before I can draft the job');
    expect(again.options).toEqual(now.options);
    expect(world.mentor.requests.length).toBe(before);
  });

  it('ends after a few open questions, saying what is still open and drafting nothing', async () => {
    world.mentor.script = () => bikeDraft([costType({ ambiguities: [OPEN] }), CONTACT_TYPE]);
    let turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    for (let asked = 1; asked < MAX_RULE_QUESTIONS; asked += 1) {
      expect(turn.draft).toBeUndefined();
      expect(turn.ended).toBeUndefined();
      turn = await world.drafting.reply(turn.sessionId, 'Not sure', TEACHER);
    }
    turn = await world.drafting.reply(turn.sessionId, 'Not sure', TEACHER);
    expect(turn.ended).toBe(true);
    expect(turn.draft).toBeUndefined();
    expect(turn.message).toContain("I still can't settle this from your policy");
    expect(turn.message).toContain(OPEN.question);
    expect(world.store.jobs.list()).toEqual([]);
  });

  it('tells a question that changes no number apart, and lists it as left open', async () => {
    const mild = {
      question: 'Does the shop round hours on Sundays?',
      options: ['a', 'b'],
      changesAnswers: false,
    };
    const job = await draftedJob(bikeDraft([costType({ ambiguities: [mild] }), CONTACT_TYPE]));
    expect(recordOf(job.id).unresolved).toContain('Does the shop round hours on Sundays?');
  });
});

describe('a question about an empty cell', () => {
  // What Spark asked when it was run on the bike shop's records, with its answers replaced by the
  // two Architect can do: a rule can count an empty cell as zero or leave its row out, nothing else.
  const EMPTY = {
    question: 'What parts amount should be used when a ticket lists no parts cost?',
    options: ['Zero', 'Leave those tickets out'],
    changesAnswers: true,
    blankColumn: 'parts_cost',
    blankFrom: 'row',
  };
  const ZERO = 'Count it as zero';
  const LEAVE = 'Leave those rows out';

  /**
   * The teacher asks, and when it is asked to draft again it writes the same rule, still listing
   * the question: what the person chose is not a change to the steps.
   */
  function asksThenDrafts() {
    world.mentor.script = () => bikeDraft([costType({ ambiguities: [EMPTY] }), CONTACT_TYPE]);
  }

  it("puts the two answers a rule can do, not the teacher's, and nothing is made until it is answered", async () => {
    asksThenDrafts();
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(first.draft).toBeUndefined();
    expect(first.message).toBe(EMPTY.question);
    expect(first.options).toEqual([ZERO, LEAVE]);
    expect(first.options).not.toContain(DRAFT_NOW);
    expect(world.store.jobs.list()).toEqual([]);

    // "Draft it now" doesn't answer it, and neither does a reply that is neither of the two.
    const before = world.mentor.requests.length;
    const now = await world.drafting.reply(first.sessionId, 'Draft it now', TEACHER);
    expect(now.options).toEqual([ZERO, LEAVE]);
    const other = await world.drafting.reply(first.sessionId, 'Use the average', TEACHER);
    expect(other.draft).toBeUndefined();
    expect(other.message).toContain(EMPTY.question);
    expect(other.message).toContain('Choose one of the answers');
    expect(other.options).toEqual([ZERO, LEAVE]);
    expect(world.mentor.requests.length).toBe(before);
  });

  it('counts an empty cell as zero when the person chose it, and says so in the rule and in the record', async () => {
    asksThenDrafts();
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    // The words of the option, in any case and spacing, are the answer.
    const second = await world.drafting.reply(first.sessionId, ' count it AS zero ', TEACHER);
    const job = second.draft;
    if (job === undefined) throw new Error(second.message);

    const told = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(told).toContain(`Question: ${EMPTY.question}`);
    expect(told).toContain(`Answer: ${ZERO}`);
    expect(told).toContain('Architect counts an empty parts_cost in tickets.csv as 0 itself');

    const record = recordOf(job.id);
    expect(record.answers).toEqual([
      {
        question: EMPTY.question,
        answer: ZERO,
        blank: { table: 'tickets.csv', column: 'parts_cost', from: 'row', means: 'zero' },
      },
    ]);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.spec).toMatchObject({
      template: 'rule',
      emptyMeansZero: [{ column: 'parts_cost', from: 'row' }],
    });
    expect(cost?.details?.statement).toMatch(/ An empty parts cost counts as 0, as you said\.$/);
    expect(cost?.details?.passages).toContainEqual({ file: 'answers', passage: ZERO });
    expect(cost?.details?.flags.join(' ')).toMatch(
      /\d+ rows have an empty parts cost, which counts as 0, as you said\./,
    );
    // The tickets with no parts have a task now: nothing was left out for being empty.
    expect(cost?.details?.excluded.map((item) => item.reason)).toEqual([
      'parts_cost says N/A or a dash, which is not the same as empty',
    ]);
    expect(await world.jobs.ruleReports(job.id)).toEqual([]);
    const plan = await world.jobs.taskPlan(job.id);
    const planned = plan.types.find((type) => type.id === 'cost')?.details;
    expect(planned?.statement).toBe(cost?.details?.statement);
    // The answer is read with the question the person was asked about the empty cell.
    expect(planned?.passages).toContainEqual({
      file: 'answers',
      passage: ZERO,
      question: EMPTY.question,
    });

    // So is the report of the rule once the person has confirmed it.
    const { token } = (await world.jobs.ruleState(job.id)) ?? { token: '' };
    await world.jobs.confirmRules(job.id, token);
    const [report] = await world.jobs.ruleReports(job.id);
    expect(report?.passages).toContainEqual({
      file: 'answers',
      passage: ZERO,
      question: EMPTY.question,
    });
  });

  it('leaves the rows with an empty cell out when the person chose that, as it did before', async () => {
    asksThenDrafts();
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const second = await world.drafting.reply(first.sessionId, LEAVE, TEACHER);
    const job = second.draft;
    if (job === undefined) throw new Error(second.message);
    const record = recordOf(job.id);
    expect(record.answers).toEqual([
      {
        question: EMPTY.question,
        answer: LEAVE,
        blank: { table: 'tickets.csv', column: 'parts_cost', from: 'row', means: 'leave_out' },
      },
    ]);
    const cost = record.types.find((type) => type.id === 'cost');
    expect(cost?.spec).not.toHaveProperty('emptyMeansZero');
    expect(cost?.details?.statement).not.toContain('counts as 0');
    expect(cost?.details?.excluded.map((item) => item.reason)).toEqual([
      'parts_cost is empty or N/A',
    ]);
  });

  it('does not ask again about a column the person answered, or one with nothing empty in it', async () => {
    // Asked about the hours, which every ticket has, there is nothing to decide.
    world.mentor.script = () =>
      bikeDraft([
        costType({ ambiguities: [{ ...EMPTY, blankColumn: 'labor_hours' }] }),
        CONTACT_TYPE,
      ]);
    const drafted = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(drafted.draft).toBeDefined();
    expect(world.mentor.requests).toHaveLength(1);
  });

  it('is not asked a second time when the teacher lists it again after the answer', async () => {
    asksThenDrafts();
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const second = await world.drafting.reply(first.sessionId, ZERO, TEACHER);
    expect(second.draft).toBeDefined();
    expect(second.message).not.toContain(EMPTY.question);
  });

  it('still reads a draft made before an answer named its table, and its rule is what it was', async () => {
    asksThenDrafts();
    const first = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const job = (await world.drafting.reply(first.sessionId, ZERO, TEACHER)).draft;
    if (job === undefined) throw new Error('Expected a job.');
    const before = await world.jobs.ruleState(job.id);
    const file = world.paths.draftingFile(job.id);
    const old = JSON.parse(readFileSync(file, 'utf8')) as DraftRecord;
    const blank = old.answers?.[0]?.blank;
    if (blank === undefined) throw new Error('Expected an answer about an empty cell.');
    delete blank.table;
    writeFileSync(file, JSON.stringify(old));

    expect(recordOf(job.id).answers?.[0]?.blank).toEqual({
      column: 'parts_cost',
      from: 'row',
      means: 'zero',
    });
    // The rule is read from its own specification, which the answer's table never touched.
    expect(await world.jobs.ruleState(job.id)).toEqual(before);
    const plan = await world.jobs.taskPlan(job.id);
    expect(plan.types.find((type) => type.id === 'cost')?.details?.statement).toMatch(
      /An empty parts cost counts as 0/,
    );
  });

  it('sends back a question about a column the rule does not add up, and one the table lacks', async () => {
    world.mentor.script = (_request, call) =>
      call === 1
        ? bikeDraft([
            costType({ ambiguities: [{ ...EMPTY, blankColumn: 'status' }] }),
            CONTACT_TYPE,
          ])
        : bikeDraft();
    await world.drafting.start('A repair desk', attachBike(), TEACHER);
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain(
      'status is not a number the rule adds up, so what an empty one counts as is not a question for it.',
    );
    world.mentor.requests.length = 0;
    world.mentor.script = (_request, call) =>
      call === 1
        ? bikeDraft([
            costType({ ambiguities: [{ ...EMPTY, blankColumn: 'discount' }] }),
            CONTACT_TYPE,
          ])
        : bikeDraft();
    await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(world.mentor.requests[1]?.messages.at(-1)?.content).toContain(
      "the question about an empty discount names a column that isn't in the table.",
    );
  });

  it('keeps the teacher from declaring a zero itself: only an answer does', async () => {
    // A rule that already says what an empty cell is has no field for it in the reply format.
    const request = (await (async () => {
      world.mentor.script = () => question('Which ticket?', ['A', 'B']);
      await world.drafting.start('A repair desk', attachBike(), TEACHER);
      return world.mentor.requests[0];
    })()) as MentorCompletionRequest;
    const schema = JSON.stringify(request.json?.schema);
    expect(schema).toContain('"blankColumn"');
    expect(schema).not.toContain('emptyMeansZero');
    expect(request.system).toContain('Offer only answers the steps above can do');
    expect(request.system).toContain('blankColumn');
    expect(request.system).toContain('a column of the same name in another table is asked about');
  });
});

describe('an empty cell in two tables that each have an amount column', () => {
  const TICKETS = 'What should an empty amount on a ticket count as?';
  const INVOICES = 'What should an empty amount on an invoice count as?';
  const ZERO = 'Count it as zero';
  const LEAVE = 'Leave those rows out';
  const SAID = 'Tickets and invoices. Both carry a ten percent surcharge.';

  /** Seventy rows, the amount of every fifth left empty. */
  function amounts(key: string, prefix: string): string {
    const rows = Array.from({ length: 70 }, (_, i) =>
      [
        `${prefix}-${1000 + i}`,
        `C-${100 + (i % 20)}`,
        i % 5 === 0 ? '' : (10 + i * 1.5).toFixed(2),
      ].join(','),
    );
    return `${[`${key},customer_id,amount`, ...rows].join('\n')}\n`;
  }

  /** What a row of a table comes to with the surcharge, a rule that asks what an empty amount is. */
  function surcharge(table: string, key: string, request: string, asking: string) {
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
        ambiguities: [
          {
            question: asking,
            options: [],
            changesAnswers: true,
            blankColumn: 'amount',
            blankFrom: 'row',
          },
        ],
        steps: [
          step('amount', 'col', { column: 'amount', from: 'row' }),
          step('rate', 'num', { value: '1.1' }),
          step('priced', 'mul', { args: ['amount', 'rate'] }),
          step('total', 'round', { value: '0.01', mode: 'half_up', args: ['priced'] }),
        ],
        result: 'total',
      }),
    };
  }

  function teacherDrafts(): string[] {
    world.mentor.script = () =>
      draft({
        files: [
          { name: 'tickets.csv', description: 'Repair tickets.', access: 'read' },
          { name: 'invoices.csv', description: 'Invoices.', access: 'read' },
        ],
        taskTypes: [
          surcharge('tickets.csv', 'ticket_id', 'What does ticket {key} come to?', TICKETS),
          surcharge('invoices.csv', 'invoice_id', 'What does invoice {key} come to?', INVOICES),
        ],
      });
    return [
      world.attach('tickets.csv', amounts('ticket_id', 'T')),
      world.attach('invoices.csv', amounts('invoice_id', 'INV')),
    ];
  }

  it("asks about each table's amount on its own, and keeps each answer for the table it was about", async () => {
    const files = teacherDrafts();
    const first = await world.drafting.start(SAID, files, TEACHER);
    expect(first.message).toBe(TICKETS);
    expect(first.options).toEqual([ZERO, LEAVE]);

    // The answer was about the tickets' amount, so the invoices' amount is still a question.
    const second = await world.drafting.reply(first.sessionId, ZERO, TEACHER);
    expect(second.draft).toBeUndefined();
    expect(second.message).toBe(INVOICES);
    expect(world.store.jobs.list()).toEqual([]);

    const third = await world.drafting.reply(second.sessionId, LEAVE, TEACHER);
    const job = third.draft;
    if (job === undefined) throw new Error(third.message);
    const record = recordOf(job.id);
    expect(record.answers).toEqual([
      {
        question: TICKETS,
        answer: ZERO,
        blank: { table: 'tickets.csv', column: 'amount', from: 'row', means: 'zero' },
      },
      {
        question: INVOICES,
        answer: LEAVE,
        blank: { table: 'invoices.csv', column: 'amount', from: 'row', means: 'leave_out' },
      },
    ]);
    const tickets = record.types.find((type) => type.id === 'tickets_total');
    const invoices = record.types.find((type) => type.id === 'invoices_total');
    expect(tickets?.spec).toMatchObject({ emptyMeansZero: [{ column: 'amount', from: 'row' }] });
    expect(invoices?.spec).not.toHaveProperty('emptyMeansZero');
    expect(tickets?.details?.statement).toContain('counts as 0');
    expect(invoices?.details?.statement).not.toContain('counts as 0');
    // Each table's empty amounts were dealt with as its own answer said.
    expect(tickets?.details?.excluded.map((item) => item.reason)).not.toContain(
      'amount is empty or N/A',
    );
    expect(invoices?.details?.excluded.map((item) => item.reason)).toContain(
      'amount is empty or N/A',
    );
  });

  it('puts the table into the question that is put again when the answer was not one of the two', async () => {
    const first = await world.drafting.start(SAID, teacherDrafts(), TEACHER);
    const again = await world.drafting.reply(first.sessionId, 'Use the average', TEACHER);
    expect(again.message).toContain(
      'it decides what an empty amount in tickets.csv counts as in every row',
    );
  });
});

describe('holding a rule to the policy and to the guards', () => {
  it('sends back a passage that is not in the policy word for word, once, with the reason', async () => {
    const wrong = costType({
      sources: [{ file: 'policy.md', passage: 'Labor costs sixty-five dollars an hour.' }],
    });
    world.mentor.script = (_request, call) =>
      call === 1 ? bikeDraft([wrong, CONTACT_TYPE]) : bikeDraft();
    const turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(turn.draft).toBeDefined();
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain('is not in the policy or in what the person said, word for word');
    expect(fix).toContain('Labor costs sixty-five dollars an hour.');
  });

  it('finds a passage under another file name, and in the description', async () => {
    const found = costType({
      sources: [
        { file: 'description.txt', passage: 'Members get 10% off labor, never off parts.' },
        { file: 'description', passage: 'A repair desk' },
      ],
    });
    const job = await draftedJob(bikeDraft([found, CONTACT_TYPE]));
    const passages = recordOf(job.id).types.find((type) => type.id === 'cost')?.details?.passages;
    expect(passages).toEqual([
      { file: 'policy.md', passage: 'Members get 10% off labor, never off parts.' },
      { file: 'description', passage: 'A repair desk' },
    ]);
  });

  it('sends back a rule a guard refuses, with the reason, instead of making tasks', async () => {
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
    world.mentor.script = (_request, call) =>
      call === 1 ? bikeDraft([constant, CONTACT_TYPE]) : bikeDraft();
    const turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(turn.draft).toBeDefined();
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toContain('comes to the same total, 65');
    expect(TEXT(world.mentor.requests[0] as MentorCompletionRequest)).not.toContain(
      'comes to the same total',
    );
  });

  it("holds a rule to the job's own pass rate: a copy of a column that would pass it is refused", async () => {
    // Members pay five more than the parts cost as written, so the others' tickets are a copy.
    const mostlyCopy = costType({
      steps: [
        step('parts', 'col', { column: 'parts_cost', from: 'row' }),
        step('five', 'num', { value: '5' }),
        step('more', 'add', { args: ['parts', 'five'] }),
        step('is_member', 'equals', { column: 'member', from: 'lookup', value: 'yes' }),
        step('pick', 'if', { args: ['is_member', 'more', 'parts'] }),
        step('total', 'round', { value: '0.01', mode: 'half_up', args: ['pick'] }),
      ],
    });
    const lax = bikeDraft([mostlyCopy, CONTACT_TYPE]);
    // Nine in ten right is asked: a copy right in about three in five rows doesn't pass.
    const strict = await draftedJob(lax);
    expect(world.mentor.requests).toHaveLength(1);
    expect(
      recordOf(strict.id).types.find((type) => type.id === 'cost')?.details?.flags,
    ).toContainEqual(
      expect.stringMatching(/^In \d+% of the rows the answer is already written in parts_cost/),
    );

    // Half right is asked: the copy would pass, so the rule is sent back with the reason.
    world.mentor.requests.length = 0;
    world.mentor.script = (_request, call) =>
      call === 1
        ? { ...lax, job: { ...lax.job, passRate: 0.5 } }
        : { ...bikeDraft(), job: { ...bikeDraft().job, passRate: 0.5 } };
    const turn = await world.drafting.start('A repair desk', attachBike(), TEACHER);
    expect(turn.draft).toBeDefined();
    const fix = world.mentor.requests[1]?.messages.at(-1)?.content ?? '';
    expect(fix).toMatch(
      /The answer is the value of parts_cost in \d+% of the rows, and the job asks for 50% right, so an agent that copies it would pass/,
    );
  });

  it('says what is wrong with a step it cannot read', async () => {
    const bad = costType({
      steps: bikeSteps().map((item) => (item.id === 'sum' ? { ...item, op: 'blend' } : item)),
    });
    world.mentor.script = () => bikeDraft([bad, CONTACT_TYPE]);
    await expect(world.drafting.start('A repair desk', attachBike(), TEACHER)).rejects.toThrow(
      'Step "sum" is "blend", which is not an operation',
    );
  });
});
