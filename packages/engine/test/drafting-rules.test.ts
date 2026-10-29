import { readFileSync, writeFileSync } from 'node:fs';
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
import { DRAFT_NOW } from '../src/drafting/envelope';
import { MAX_RULE_QUESTIONS } from '../src/drafting/drafter';
import { RunController } from '../src/loop/controller';
import { draftingWorld, question, TEACHER, type DraftingWorld } from './support/drafting-world';
import { bikeShop, POLICY, type Bike } from './support/rule-data';
import { bikeDraft, bikeSteps, costType, CONTACT_TYPE, step } from './support/rule-draft';

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
        bikeDraft([CONTACT_TYPE, { ...CONTACT_TYPE, id: 'second', columns: ['name'] }]);
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
