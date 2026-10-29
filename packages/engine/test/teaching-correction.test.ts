import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AdapterError,
  GuardError,
  TaskSchema,
  type ActorAdapter,
  type ExpectedSchema,
  type Harness,
  type Task,
  type Trace,
  type Usage,
} from '@architect/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { createChecker, type Checker } from '../src/checker/checker';
import { runTaskAttempt } from '../src/eval/evaluate';
import { LeakRefusal, MentorGate } from '../src/mentor/gate';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { gatedActor, refusalOf } from '../src/teaching/actor';
import { auditMutations } from '../src/teaching/audit';
import { rebuildCheckpoint } from '../src/teaching/checkpoint';
import { runCorrection, type CorrectionContext } from '../src/teaching/correction';
import { makeHarness, makeJob, makeJobDir, SAMPLE_CONTENT, type TempJob } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

const CHECKER = `
var validators = {
  invoice_created: function (params, ctx) {
    var before = ctx.readOriginalTable('invoices.csv');
    var added = ctx.readTable('invoices.csv').filter(function (row) {
      return !before.some(function (old) { return old.invoice_id === row.invoice_id; });
    });
    if (added.length !== 1) return { pass: false, reason: 'Expected one new invoice.' };
    if (added[0].total_cents !== String(params.total_cents)) {
      return { pass: false, reason: 'total_cents is ' + added[0].total_cents + '.' };
    }
    return { pass: true, reason: 'The invoice is right.' };
  }
};
`;

const TODAY = '2026-11-03';
const job = makeJob({ checker: { kind: 'module', path: 'checker.js' } });

function task(expected: z.input<typeof ExpectedSchema>, prompt: string, id = 'train-1'): Task {
  return TaskSchema.parse({ id, type: 'invoice', family: id, prompt, expected });
}

const BILL = task(
  { kind: 'end_state', validator: 'invoice_created', params: { total_cents: 2500 } },
  'Bill customer C-2 for the boiler service: create invoice INV-4 for 2500 cents.',
);
const QUESTION = task(
  { kind: 'answer', value: { unpaid: 2 } },
  'How many invoices are still unpaid?',
  'train-2',
);

const read = (path: string): ScriptedTurn => ({
  toolCalls: [{ name: 'read', arguments: { path } }],
});
const append = (text: string): ScriptedTurn => ({
  toolCalls: [{ name: 'append', arguments: { path: 'data/invoices.csv', text } }],
});
const answer = (json: string): ScriptedTurn => ({ text: `ANSWER: ${json}` });

/** A scripted model that prices its own calls, as the mentor's model acting as the agent does. */
class ScriptedActor extends ScriptedStudent implements ActorAdapter {
  constructor(script: ConstructorParameters<typeof ScriptedStudent>[0]) {
    super(script, null);
  }

  estimateCostUsd(usage: Usage): number {
    return (usage.inputTokens + usage.outputTokens) / 1_000_000;
  }
}

let folder: TempJob;
let sandbox: Sandbox;
let checker: Checker;
let harness: Harness;

beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

beforeEach(() => {
  folder = makeJobDir();
  writeFileSync(join(folder.dir, 'checker.js'), CHECKER);
  checker = createChecker({ job, jobDir: folder.dir, sandbox });
  harness = makeHarness();
});
afterEach(() => folder.remove());

/** The student's attempt, run for real through the tools and graded by the real checker. */
async function attempt(subject: Task, script: ScriptedTurn[]) {
  return runTaskAttempt(subject, {
    job,
    jobDir: folder.dir,
    harness,
    student: new ScriptedStudent(script),
    sandbox,
    checker,
    now: new Date(`${TODAY}T12:00:00Z`),
    seed: 7,
  });
}

function context(actor: ScriptedTurn[]): CorrectionContext {
  return {
    job,
    jobDir: folder.dir,
    harness,
    actor: new ScriptedActor(actor),
    sandbox,
    checker,
    today: TODAY,
  };
}

/** The student reads the customers, then appends an invoice for a tenth of the amount. */
async function failedBill(): Promise<Trace> {
  const failed = await attempt(BILL, [
    read('data/customers.csv'),
    append('INV-4,C-2,250,2026-12-03,'),
    answer('{"invoice_id":"INV-4"}'),
  ]);
  expect(failed.check).toEqual({ pass: false, reason: 'total_cents is 250.' });
  return failed.trace;
}

describe('rebuilding a checkpoint', () => {
  it('replays the calls before the turn on a fresh copy and hands back the prefix', async () => {
    const trace = await failedBill();
    const rebuilt = await rebuildCheckpoint({
      trace,
      job,
      jobDir: folder.dir,
      harness,
      sandbox,
      today: TODAY,
      turn: 2,
    });
    if (!rebuilt.ok) throw new Error(rebuilt.reason);
    const { checkpoint } = rebuilt;
    expect(checkpoint.replayedCalls).toBe(1);
    expect(checkpoint.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
    ]);
    // Nothing the student wrote at the failure turn is in the rebuilt state.
    expect(checkpoint.files.read('data/invoices.csv')).toBe(SAMPLE_CONTENT['invoices.csv']);
  });

  it('refuses when the data changed since the attempt, instead of repairing it', async () => {
    const trace = await failedBill();
    writeFileSync(join(folder.dataDir, 'customers.csv'), 'customer_id,name\nC-9,Someone Else\n');
    const rebuilt = await rebuildCheckpoint({
      trace,
      job,
      jobDir: folder.dir,
      harness,
      sandbox,
      today: TODAY,
      turn: 2,
    });
    expect(rebuilt).toEqual({
      ok: false,
      reason:
        'The data changed since the attempt: data/customers.csv differs from the bytes the attempt began with.',
    });
  });

  it('refuses when a replayed call returns other text than the attempt saw', async () => {
    const trace = await failedBill();
    const tampered: Trace = {
      ...trace,
      messages: trace.messages.map((message) =>
        message.role === 'tool' ? { ...message, content: `${message.content}\nextra` } : message,
      ),
    };
    const rebuilt = await rebuildCheckpoint({
      trace: tampered,
      job,
      jobDir: folder.dir,
      harness,
      sandbox,
      today: TODAY,
      turn: 2,
    });
    expect(rebuilt).toEqual({
      ok: false,
      reason: 'Turn 1: read returned different text than it did in the attempt.',
    });
  });

  it('refuses another harness, another date and a turn that is not inside the attempt', async () => {
    const trace = await failedBill();
    const base = { trace, job, jobDir: folder.dir, sandbox, today: TODAY, turn: 2 };
    const other = makeHarness({ meta: { format: 2, name: 'x', version: 4, hash: 'sha256-other' } });
    expect(await rebuildCheckpoint({ ...base, harness: other })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('harness changed'),
    });
    expect(await rebuildCheckpoint({ ...base, harness, today: '2026-11-04' })).toMatchObject({
      ok: false,
      reason: 'The attempt worked as of 2026-11-03, not 2026-11-04.',
    });
    expect(await rebuildCheckpoint({ ...base, harness, turn: 1 })).toMatchObject({ ok: false });
    expect(await rebuildCheckpoint({ ...base, harness, turn: 9 })).toMatchObject({ ok: false });
    const { replay: _, ...unrecorded } = trace;
    expect(await rebuildCheckpoint({ ...base, harness, trace: unrecorded })).toMatchObject({
      ok: false,
      reason: "The attempt's trace has no record of what it started from.",
    });
  });
});

describe('a correction', () => {
  it('continues from the checkpoint, passes the checker, and trains only on its own turns', async () => {
    const trace = await failedBill();
    const result = await runCorrection(
      BILL,
      context([append('INV-4,C-2,2500,2026-12-03,'), answer('{"invoice_id":"INV-4"}')]),
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    );
    expect(result.verified).toBe(true);
    expect(result.reason).toBe('The invoice is right.');
    expect(result.checkpoint).toEqual({ turn: 2, replayedCalls: 1 });
    expect(result.audit).toEqual({ ok: true, problems: [], changed: ['invoices.csv'] });
    // The student's read and its result are context; the actor's two turns are the targets.
    expect(result.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(result.actorTurns).toEqual([4, 6]);
    expect(result.tools.map((tool) => tool.name)).toContain('append');
  });

  it('is rejected with the checker reason when the continuation is wrong too', async () => {
    const trace = await failedBill();
    const result = await runCorrection(
      BILL,
      context([append('INV-4,C-2,2400,2026-12-03,'), answer('{"invoice_id":"INV-4"}')]),
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toBe("The checker didn't pass it: total_cents is 2400.");
  });

  it('is rejected when it takes away an original row along the way, though it ends right', async () => {
    const trace = await failedBill();
    const original = SAMPLE_CONTENT['invoices.csv'] ?? '';
    const header = original.split('\n')[0] ?? '';
    const result = await runCorrection(
      BILL,
      context([
        // Rewrites the table with only the new row, then puts every row back.
        {
          toolCalls: [
            {
              name: 'write',
              arguments: {
                path: 'data/invoices.csv',
                content: `${header}\nINV-4,C-2,2500,2026-12-03,\n`,
              },
            },
          ],
        },
        {
          toolCalls: [
            {
              name: 'write',
              arguments: {
                path: 'data/invoices.csv',
                content: `${original}INV-4,C-2,2500,2026-12-03,\n`,
              },
            },
          ],
        },
        answer('{"invoice_id":"INV-4"}'),
      ]),
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    );
    expect(result.check?.pass).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.reason).toBe(
      "The mutation audit refused it: Turn 2 took away a row of invoices.csv that the task's end state keeps.",
    );
  });

  it('demonstrates a whole task from the start, every turn its own', async () => {
    const result = await runCorrection(
      QUESTION,
      context([
        {
          toolCalls: [
            { name: 'grep', arguments: { pattern: ',(false)?$', path: 'data/invoices.csv' } },
          ],
        },
        answer('{"unpaid":2}'),
      ]),
      { kind: 'full_task' },
      { seed: 3 },
    );
    expect(result.verified).toBe(true);
    expect(result.checkpoint).toBeNull();
    expect(result.messages[0]?.role).toBe('system');
    expect(result.actorTurns).toEqual([2, 4]);
  });

  it('refuses a question task that changed data on the way, even when it put it back', async () => {
    const original = SAMPLE_CONTENT['invoices.csv'] ?? '';
    const result = await runCorrection(
      QUESTION,
      context([
        append('INV-9,C-1,1,2026-12-03,'),
        {
          toolCalls: [
            { name: 'write', arguments: { path: 'data/invoices.csv', content: original } },
          ],
        },
        answer('{"unpaid":2}'),
      ]),
      { kind: 'full_task' },
      { seed: 3 },
    );
    expect(result.check?.pass).toBe(true);
    expect(result.verified).toBe(false);
    expect(result.audit?.problems).toEqual([
      "Turn 1 changed invoices.csv, which the task's end state leaves as it was.",
    ]);
  });

  it('reports the replay that failed rather than repairing the environment', async () => {
    const trace = await failedBill();
    writeFileSync(join(folder.dataDir, 'customers.csv'), 'customer_id,name\nC-9,Someone Else\n');
    const actor = new ScriptedActor([answer('{}')]);
    const result = await runCorrection(
      BILL,
      { ...context([]), actor },
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    );
    expect(result.verified).toBe(false);
    expect(result.reason).toMatch(/^The replay didn't hold: The data changed since the attempt/);
    expect(actor.requests).toHaveLength(0);
  });
});

describe('the mutation audit', () => {
  it('counts a declined write against the episode', () => {
    const audit = auditMutations({
      task: BILL,
      original: {},
      final: {},
      snapshots: [],
      writes: [{ op: 'append', path: 'data/invoices.csv', patch: '', applied: false }],
    });
    expect(audit).toEqual({
      ok: false,
      problems: ["A write to data/invoices.csv wasn't applied."],
      changed: [],
    });
  });
});

describe('the mentor acting as the agent', () => {
  function gate(leaks: string[] = [], maxUsd = 1) {
    let spent = 0;
    const refusals: string[] = [];
    const mentorGate = new MentorGate({
      leakDetector: {
        scan: (text) => {
          const matchedIds = leaks.filter((leak) => text.includes(leak));
          return { leaked: matchedIds.length > 0, matchedIds };
        },
      },
      authorize: (most) => {
        if (most === null || spent + most > maxUsd) throw new GuardError('budget', 'Over the cap.');
        return most;
      },
      onRefusal: (message) => refusals.push(message),
    });
    return { mentorGate, refusals, charge: (usd: number) => (spent += usd) };
  }

  it('charges every turn it takes against the mentor budget', async () => {
    const trace = await failedBill();
    const { mentorGate } = gate();
    const charges: number[] = [];
    const actor = gatedActor(
      new ScriptedActor([append('INV-4,C-2,2500,2026-12-03,'), answer('{"invoice_id":"INV-4"}')]),
      mentorGate,
      { onCharge: (charge) => charges.push(charge.costUsd) },
    );
    const result = await runCorrection(
      BILL,
      { ...context([]), actor },
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    );
    expect(result.verified).toBe(true);
    expect(charges).toEqual([0.00012, 0.00012]);
  });

  it('stops before a turn whose request carries locked-test content', async () => {
    const trace = await failedBill();
    const { mentorGate, refusals } = gate(['Bill customer C-2']);
    const actor = gatedActor(new ScriptedActor([answer('{}')]), mentorGate, {
      onCharge: () => undefined,
    });
    const failure = await runCorrection(
      BILL,
      { ...context([]), actor },
      { kind: 'checkpoint', trace, turn: 2 },
      { seed: 3 },
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AdapterError);
    expect(refusalOf(failure)).toBeInstanceOf(LeakRefusal);
    expect(refusals).toEqual(['Refused a mentor call: its payload matched 1 locked test task.']);
  });

  it('stops before a turn the budget cannot cover', async () => {
    const { mentorGate } = gate([], 0);
    const actor = gatedActor(new ScriptedActor([answer('{}')]), mentorGate, {
      onCharge: () => undefined,
    });
    const failure = await runCorrection(
      QUESTION,
      { ...context([]), actor },
      { kind: 'full_task' },
      {
        seed: 3,
      },
    ).catch((error: unknown) => error);
    expect(refusalOf(failure)?.guard).toBe('budget');
  });
});
