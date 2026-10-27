import { AdapterError, type TraceStep } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { runAgent, type RunAgentOptions } from '../src/agent/loop';
import { openTableStore } from '../src/data/table-store';
import type { Sandbox } from '../src/sandbox/types';
import { makeHarness, makeJob, makeJobDir, SAMPLE_FILES, type TempJob } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

let job: TempJob | undefined;
afterEach(() => job?.remove());

const noSandbox: Sandbox = {
  runTool: () => Promise.reject(new Error('not expected')),
  runValidator: () => Promise.reject(new Error('not expected')),
  dispose: async () => undefined,
};

async function run(
  script: ConstructorParameters<typeof ScriptedStudent>[0],
  overrides: Partial<RunAgentOptions> = {},
) {
  job = makeJobDir();
  const store = await openTableStore({
    dataDir: job.dataDir,
    files: SAMPLE_FILES,
    mode: 'scratch',
  });
  const student = new ScriptedStudent(script);
  const steps: TraceStep[] = [];
  const trace = await runAgent({
    harness: makeHarness(),
    job: makeJob(),
    student,
    store,
    sandbox: noSandbox,
    request: 'Which invoices are unpaid?',
    mode: 'task',
    seed: 42,
    onStep: (step) => steps.push(step),
    ...overrides,
  });
  return { trace, student, store, steps };
}

const answer = (json: string): ScriptedTurn => ({ text: `ANSWER: ${json}` });

describe('runAgent', () => {
  it('runs tool calls and feeds their results back until the model answers', async () => {
    const { trace, student, steps } = await run([
      {
        text: 'Let me look.',
        toolCalls: [
          {
            name: 'read_table',
            arguments: {
              file: 'invoices.csv',
              where: [{ column: 'paid', op: '!=', value: 'true' }],
              columns: ['invoice_id'],
            },
          },
        ],
      },
      answer('["INV-2", "INV-3"]'),
    ]);
    expect(trace).toMatchObject({
      harnessVersion: 3,
      studentModel: 'scripted-student',
      finalText: 'ANSWER: ["INV-2", "INV-3"]',
      stopReason: 'answer',
      usage: { inputTokens: 200, outputTokens: 40 },
    });
    expect(trace.steps.map((step) => step.kind)).toEqual(['model', 'tool', 'model']);
    expect(trace.steps[1]).toMatchObject({
      kind: 'tool',
      callId: 'call_0_0',
      name: 'read_table',
      result: { rows: [['INV-2'], ['INV-3']], total: 2 },
    });
    expect(steps).toEqual(trace.steps);
    expect(trace.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    const followUp = student.requests[1]?.messages.at(-1);
    expect(followUp).toMatchObject({ role: 'tool', toolCallId: 'call_0_0', name: 'read_table' });
    expect(JSON.parse(followUp?.role === 'tool' ? followUp.content : '{}')).toMatchObject({
      total: 2,
    });
  });

  it("works as of the job's business date, or the day it runs when the job has none", async () => {
    const dated = await run([answer('1')], { now: new Date(2030, 0, 15, 12) });
    expect(dated.student.requests[0]?.messages[0]?.content).toContain(
      'Today is Tuesday, 2026-11-03.',
    );
    const live = await run([answer('1')], {
      job: makeJob({ businessDate: undefined }),
      now: new Date(2030, 0, 15, 12),
    });
    expect(live.student.requests[0]?.messages[0]?.content).toContain(
      'Today is Tuesday, 2030-01-15.',
    );
  });

  it('passes the runner seed and the decoding settings on every call', async () => {
    const decoding = makeHarness().decoding;
    const { student } = await run([{ toolCalls: [{ name: 'list_files' }] }, answer('1')]);
    expect(student.requests.map((request) => request.seed)).toEqual([42, 42]);
    expect(student.requests.map((request) => request.decoding)).toEqual([decoding, decoding]);
    const fixed = { ...decoding, temperature: 0.2 };
    const overridden = await run([answer('1')], { decoding: fixed, seed: 9 });
    expect(overridden.student.requests[0]).toMatchObject({ seed: 9, decoding: fixed });
  });

  it('returns unknown tools and bad arguments to the model as errors, then carries on', async () => {
    const { trace, student } = await run([
      {
        toolCalls: [
          { name: 'read_tables', arguments: { file: 'invoices.csv' } },
          { name: 'read_table', arguments: { file: 'invoices.csv', limit: 'all' } },
        ],
      },
      answer('[]'),
    ]);
    expect(trace.stopReason).toBe('answer');
    const toolSteps = trace.steps.filter((step) => step.kind === 'tool');
    expect(toolSteps).toHaveLength(2);
    for (const step of toolSteps) {
      expect(step).toMatchObject({ result: null, error: expect.any(String) });
    }
    const replies =
      student.requests[1]?.messages.filter((message) => message.role === 'tool') ?? [];
    expect(replies.map((message) => JSON.parse(message.content).error)).toEqual([
      expect.stringMatching(/^There is no tool called "read_tables"/),
      expect.stringMatching(/^Invalid arguments for read_table\. limit: /),
    ]);
  });

  it('stops at the step limit', async () => {
    const harness = makeHarness({ decoding: { maxSteps: 3 } });
    const { trace, student } = await run(() => ({ toolCalls: [{ name: 'list_files' }] }), {
      harness,
    });
    expect(trace.stopReason).toBe('max_steps');
    expect(student.requests).toHaveLength(3);
    expect(trace.steps.filter((step) => step.kind === 'model')).toHaveLength(3);
    expect(trace.steps.filter((step) => step.kind === 'tool')).toHaveLength(3);
  });

  it('refuses a guarded request without calling the model', async () => {
    const harness = makeHarness({
      guardrails: {
        refuse: [
          {
            taskType: 'schedule',
            whenAny: ['book'],
            reason: 'Bookings were right 60% of the time.',
          },
        ],
      },
    });
    const { trace, student } = await run([answer('1')], {
      harness,
      request: 'Book the earliest slot for R-12.',
    });
    expect(student.requests).toHaveLength(0);
    expect(trace).toMatchObject({
      stopReason: 'refused',
      finalText: "I can't help with schedule requests. Bookings were right 60% of the time.",
      steps: [
        { kind: 'refusal', taskType: 'schedule', reason: 'Bookings were right 60% of the time.' },
      ],
    });
  });

  it("ends the trace with an error when the model's reply can't be read", async () => {
    const { trace } = await run([
      {
        error: new AdapterError('bad_response', 'The model sent tool arguments that are not JSON.'),
      },
    ]);
    expect(trace).toMatchObject({
      stopReason: 'error',
      error: 'The model sent tool arguments that are not JSON.',
      finalText: '',
    });
  });

  it('throws when the runtime fails, so an outage is never scored as a wrong answer', async () => {
    for (const code of ['network', 'server', 'not_found', 'auth', 'timeout'] as const) {
      await expect(
        run([{ error: new AdapterError(code, 'Ollama is not running.') }]),
      ).rejects.toMatchObject({ code });
      job?.remove();
      job = undefined;
    }
  });

  it('stops when aborted before, during, or between model turns', async () => {
    const before = new AbortController();
    before.abort();
    const early = await run([answer('1')], { signal: before.signal });
    expect(early.trace.stopReason).toBe('aborted');
    expect(early.student.requests).toHaveLength(0);

    const during = new AbortController();
    setTimeout(() => during.abort(), 30);
    const streaming = await run([{ text: 'A long answer that streams slowly.', delayMs: 15 }], {
      signal: during.signal,
    });
    expect(streaming.trace).toMatchObject({ stopReason: 'aborted' });
    expect(streaming.trace.error).toBeUndefined();
  });

  it('stops when aborted while a write waits for approval', async () => {
    const controller = new AbortController();
    const { trace, store } = await run(
      [
        {
          toolCalls: [
            {
              name: 'append_rows',
              arguments: { file: 'invoices.csv', rows: [{ invoice_id: 'INV-4' }] },
            },
          ],
        },
      ],
      {
        mode: 'chat',
        signal: controller.signal,
        approveWrite: () => {
          controller.abort();
          return new Promise(() => undefined);
        },
      },
    );
    expect(trace.stopReason).toBe('aborted');
    expect(store.pendingChanges()).toEqual([]);
  });

  it('records skills loaded by retrieval rules and by load_skill', async () => {
    const harness = makeHarness({
      skills: [
        {
          slug: 'find-unpaid',
          name: 'Find unpaid invoices',
          summary: 'Check the paid column.',
          body: 'Unpaid means paid is not true.',
        },
        { slug: 'price-a-job', name: 'Price a job', summary: 'Price it.', body: 'Labor first.' },
      ],
      retrieval: { rules: [{ whenAny: ['unpaid'], loadSkills: ['find-unpaid'] }] },
    });
    const { trace, student } = await run(
      [{ toolCalls: [{ name: 'load_skill', arguments: { name: 'price-a-job' } }] }, answer('[]')],
      { harness },
    );
    expect(trace.steps.filter((step) => step.kind === 'skill')).toEqual([
      { kind: 'skill', slug: 'find-unpaid', via: 'rule' },
      { kind: 'skill', slug: 'price-a-job', via: 'tool' },
    ]);
    expect(trace.steps[0]).toEqual({ kind: 'skill', slug: 'find-unpaid', via: 'rule' });
    expect(student.requests[0]?.messages[0]?.content).toContain('Unpaid means paid is not true.');
    expect(student.requests[0]?.tools.map((tool) => tool.name)).toContain('load_skill');
  });

  it('continues a chat with its history and streams text to the caller', async () => {
    const deltas: string[] = [];
    const history = [
      { role: 'user' as const, content: 'Hi' },
      { role: 'assistant' as const, content: 'Hello, how can I help?' },
    ];
    const { trace, student } = await run([{ text: 'Two invoices are unpaid: INV-2 and INV-3.' }], {
      mode: 'chat',
      history,
      onText: (delta) => deltas.push(delta),
    });
    expect(deltas.join('')).toBe('Two invoices are unpaid: INV-2 and INV-3.');
    const sent = student.requests[0]?.messages ?? [];
    expect(sent.slice(1)).toEqual([
      ...history,
      { role: 'user', content: 'Which invoices are unpaid?' },
    ]);
    expect(sent[0]?.content).toMatch(/You are talking with the user directly/);
    expect(trace.stopReason).toBe('answer');
  });
});
