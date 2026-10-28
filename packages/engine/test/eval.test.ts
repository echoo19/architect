import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CheckResult, StudentChatRequest, Task } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker, type Checker } from '../src/checker/checker';
import { evaluateTasks, runTaskAttempt, type EvalContext } from '../src/eval/evaluate';
import { taskSeed } from '../src/eval/seed';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { makeHarness, makeJob, makeJobDir, type TempJob } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

const CHECKER = `
var validators = {
  invoice_created: function (params, ctx) {
    var before = ctx.readOriginalTable('invoices.csv').length;
    var rows = ctx.readTable('invoices.csv');
    if (rows.length !== before + 1) return { pass: false, reason: 'Expected one new invoice row.' };
    var row = rows[rows.length - 1];
    return row.total_cents === String(params.total_cents)
      ? { pass: true, reason: 'The new invoice has the right total.' }
      : { pass: false, reason: 'Expected total_cents ' + params.total_cents + ', got ' + row.total_cents + '.' };
  }
};
`;

const SUM_TOOL = {
  name: 'sum_cents',
  description: "Add up a customer's invoice totals.",
  parameters: { type: 'object' as const, required: ['customer_id'] },
  code: `function run(args, ctx) {
    var rows = ctx.readTable('invoices.csv', { where: [{ column: 'customer_id', op: '=', value: args.customer_id }] });
    var total = 0;
    for (var i = 0; i < rows.length; i++) total += Number(rows[i].total_cents);
    return { total_cents: total };
  }`,
};

const unpaid = (id: string, expected: string[]): Task => ({
  id,
  type: 'overdue',
  family: id,
  prompt: `[${id}] Which invoices are unpaid? End with ANSWER: [ids]`,
  expected: { kind: 'answer', value: expected, compare: { mode: 'set' } },
});
const invoice = (id: string, total: number): Task => ({
  id,
  type: 'invoice',
  family: id,
  prompt: `[${id}] Bill customer C-1 again for everything they were invoiced so far.`,
  expected: { kind: 'end_state', validator: 'invoice_created', params: { total_cents: total } },
});

const taskIdOf = (request: StudentChatRequest) =>
  /^\[([^\]]+)\]/.exec(
    request.messages.find((message) => message.role === 'user')?.content ?? '',
  )?.[1] ?? '';

let job: TempJob;
let sandbox: Sandbox;
let checker: Checker;
const theJob = makeJob({ checker: { kind: 'module', path: 'checker.js' } });

beforeAll(() => {
  job = makeJobDir();
  writeFileSync(join(job.dir, 'checker.js'), CHECKER);
  sandbox = createSandbox();
  checker = createChecker({ job: theJob, jobDir: job.dir, sandbox });
});
afterAll(async () => {
  await sandbox.dispose();
  job.remove();
});

function context(student: ScriptedStudent, overrides: Partial<EvalContext> = {}): EvalContext {
  return {
    job: theJob,
    jobDir: job.dir,
    harness: makeHarness({ tools: [SUM_TOOL] }),
    student,
    sandbox,
    checker,
    ...overrides,
  };
}

/** Answers unpaid tasks right (or wrong for ids ending in -wrong), after an optional delay. */
function answering(delays: Record<string, number> = {}): ScriptedStudent {
  return new ScriptedStudent((request): ScriptedTurn => {
    const id = taskIdOf(request);
    const answer = id.endsWith('-wrong') ? '["INV-1"]' : '["INV-2", "INV-3"]';
    return { text: `ANSWER: ${answer}`, delayMs: delays[id] ?? 0 };
  });
}

describe('runTaskAttempt', () => {
  it('runs a task end to end: a sandboxed tool, a scratch write and an end-state check', async () => {
    const student = new ScriptedStudent((request): ScriptedTurn => {
      const results = request.messages.filter((message) => message.role === 'tool');
      if (results.length === 0) {
        return { toolCalls: [{ name: 'sum_cents', arguments: { customer_id: 'C-1' } }] };
      }
      if (results.length === 1) {
        const { total_cents } = JSON.parse(results[0]?.content ?? '{}') as { total_cents: number };
        return {
          toolCalls: [
            {
              name: 'append',
              arguments: { path: 'data/invoices.csv', text: `INV-9,C-1,${total_cents},,` },
            },
          ],
        };
      }
      return { text: 'Done.\nANSWER: {"invoice_id": "INV-9"}' };
    });
    const before = readFileSync(join(job.dataDir, 'invoices.csv'), 'utf8');
    const result = await runTaskAttempt(invoice('bill-1', 12990), {
      ...context(student),
      seed: 11,
    });

    expect(result.check).toEqual({ pass: true, reason: 'The new invoice has the right total.' });
    expect(result.trace).toMatchObject({ taskId: 'bill-1', stopReason: 'answer' });
    expect(result.outcome).toMatchObject({ answer: { invoice_id: 'INV-9' }, stopReason: 'answer' });
    expect(result.outcome.toolCalls.map((call) => call.name)).toEqual(['sum_cents', 'append']);
    expect(result.changes).toEqual([
      expect.objectContaining({
        path: 'data/invoices.csv',
        rows: expect.objectContaining({ added: [['INV-9', 'C-1', '12990', null, null]] }),
      }),
    ]);
    expect(result.trace.changes).toEqual(result.changes);
    expect(result.trace.replay).toMatchObject({ seed: 11, today: '2026-11-03' });
    expect(student.requests.every((request) => request.seed === 11)).toBe(true);
    expect(readFileSync(join(job.dataDir, 'invoices.csv'), 'utf8')).toBe(before);
  });

  it('records a missing ANSWER line in the outcome and fails the check with it', async () => {
    const student = new ScriptedStudent([{ text: 'I think INV-2 is unpaid.' }]);
    const result = await runTaskAttempt(unpaid('u-1', ['INV-2']), { ...context(student), seed: 1 });
    expect(result.outcome).toMatchObject({
      answer: null,
      answerError: 'The reply has no ANSWER line.',
    });
    expect(result.check).toEqual({ pass: false, reason: 'The reply has no ANSWER line.' });
  });
});

describe('evaluateTasks', () => {
  const tasks = [
    unpaid('u-1', ['INV-2', 'INV-3']),
    unpaid('u-2-wrong', ['INV-2', 'INV-3']),
    unpaid('u-3', ['INV-2', 'INV-3']),
    unpaid('u-4-wrong', ['INV-2', 'INV-3']),
    unpaid('u-5', ['INV-2', 'INV-3']),
  ];

  it('returns results in task order whatever the concurrency, and reports progress', async () => {
    const finished: string[] = [];
    const progress: [number, number, number][] = [];
    const result = await evaluateTasks(tasks, context(answering({ 'u-1': 40, 'u-2-wrong': 25 })), {
      seed: 7,
      concurrency: 3,
      onAttempt: (item) => finished.push(item.task.id),
      onProgress: (done, total, pass) => progress.push([done, total, pass]),
    });
    expect(result.items.map((item) => item.task.id)).toEqual(tasks.map((task) => task.id));
    expect(finished).not.toEqual(tasks.map((task) => task.id));
    expect([...finished].sort()).toEqual(tasks.map((task) => task.id).sort());
    expect(progress.map(([done]) => done)).toEqual([1, 2, 3, 4, 5]);
    expect(progress.at(-1)).toEqual([5, 5, 3]);
    expect(result.score).toEqual({ pass: 3, total: 5 });
    const serial = await evaluateTasks(tasks, context(answering()), { seed: 7 });
    expect(serial.items.map((item) => item.result.check)).toEqual(
      result.items.map((item) => item.result.check),
    );
  });

  it('scores each task type in the order the job declares them', async () => {
    const student = new ScriptedStudent((request) => {
      const id = taskIdOf(request);
      if (id.startsWith('bill')) return { text: 'ANSWER: {}' };
      return { text: 'ANSWER: ["INV-2", "INV-3"]' };
    });
    const result = await evaluateTasks(
      [unpaid('u-1', ['INV-2', 'INV-3']), invoice('bill-1', 100)],
      context(student),
      {
        seed: 1,
      },
    );
    expect(result.perType).toEqual([
      { type: 'invoice', pass: 0, total: 1 },
      { type: 'overdue', pass: 1, total: 1 },
    ]);
    expect(result.items[1]?.result.check.reason).toBe('Expected one new invoice row.');
  });

  it('gives each task the same seed for the same evaluation seed, and new ones for another seed', async () => {
    const seedsFor = async (seed: number, concurrency: number) => {
      const student = answering();
      await evaluateTasks(tasks, context(student), { seed, concurrency });
      return Object.fromEntries(
        student.requests.map((request) => [taskIdOf(request), request.seed]),
      );
    };
    const first = await seedsFor(7, 1);
    expect(await seedsFor(7, 3)).toEqual(first);
    expect(first).toEqual(Object.fromEntries(tasks.map((task) => [task.id, taskSeed(7, task.id)])));
    expect(new Set(Object.values(first)).size).toBe(tasks.length);
    const other = await seedsFor(8, 1);
    for (const task of tasks) expect(other[task.id]).not.toBe(first[task.id]);
  });

  it('uses one date for the whole evaluation', async () => {
    const student = answering();
    await evaluateTasks(
      tasks.slice(0, 2),
      context(student, {
        job: makeJob({ ...theJob, businessDate: undefined }),
        now: new Date(2031, 4, 6, 9),
      }),
      {
        seed: 1,
      },
    );
    for (const request of student.requests) {
      expect(request.messages[0]?.content).toContain('Today is Tuesday, 2031-05-06.');
    }
  });

  it('stops when aborted, reporting only attempts that finished', async () => {
    const controller = new AbortController();
    const finished: string[] = [];
    const pending = evaluateTasks(tasks, context(answering({ 'u-2-wrong': 200, 'u-3': 200 })), {
      seed: 1,
      concurrency: 2,
      signal: controller.signal,
      onAttempt: (item) => {
        finished.push(item.task.id);
        controller.abort();
      },
    });
    await expect(pending).rejects.toThrow(/abort/i);
    expect(finished).toEqual(['u-1']);
  });

  it('rejects with the error of an attempt that throws, after the others settle', async () => {
    const failing: Checker = {
      check: async (task, outcome, store): Promise<CheckResult> => {
        if (task.id === 'u-3') throw new Error('The checker module is broken.');
        return checker.check(task, outcome, store);
      },
    };
    await expect(
      evaluateTasks(tasks, context(answering(), { checker: failing }), { seed: 1, concurrency: 2 }),
    ).rejects.toThrow('The checker module is broken.');
  });
});
