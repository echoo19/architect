import { AdapterError, type Harness, type TraceStep } from '@architect/shared';
import { skillFiles } from '@architect/harness';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runAgent, type RunAgentOptions } from '../src/agent/loop';
import { openAgentFiles, type AgentFiles } from '../src/files/agent-files';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { TOOL_RUNTIME } from '../src/tools/specs';
import { makeHarness, makeJob, makeJobDir, SAMPLE_FILES, type TempJob } from './support/fixtures';
import { ScriptedStudent, type ScriptedTurn } from './support/scripted-student';

let job: TempJob | undefined;
afterEach(() => job?.remove());

let sandbox: Sandbox;
beforeAll(() => {
  sandbox = createSandbox();
});
afterAll(() => sandbox.dispose());

async function run(
  script: ConstructorParameters<typeof ScriptedStudent>[0],
  overrides: Partial<RunAgentOptions> = {},
) {
  job = makeJobDir();
  const harness: Harness = overrides.harness ?? makeHarness();
  const files: AgentFiles =
    overrides.files ??
    (await openAgentFiles({
      dataDir: job.dataDir,
      files: SAMPLE_FILES,
      skills: skillFiles(harness),
      mode: 'scratch',
    }));
  const student = new ScriptedStudent(script);
  const steps: TraceStep[] = [];
  const trace = await runAgent({
    job: makeJob(),
    student,
    sandbox,
    request: 'Which invoices are unpaid?',
    mode: 'task',
    seed: 42,
    onStep: (step) => steps.push(step),
    ...overrides,
    harness,
    files,
  });
  return { trace, student, files, steps };
}

const answer = (json: string): ScriptedTurn => ({ text: `ANSWER: ${json}` });

/** What a caller that shows the model's text, and takes it back when asked to, has on screen. */
function screen() {
  const seen = { text: '', retracted: [] as number[] };
  return {
    seen,
    hooks: {
      onText: (delta: string) => {
        seen.text += delta;
      },
      onRetract: (chars: number) => {
        seen.retracted.push(chars);
        seen.text = seen.text.slice(0, seen.text.length - chars);
      },
    },
  };
}

describe('runAgent', () => {
  it('runs tool calls and feeds their results back until the model answers', async () => {
    const { trace, student, steps } = await run([
      {
        text: 'Let me look.',
        toolCalls: [
          { name: 'grep', arguments: { pattern: ',(false)?$', path: 'data/invoices.csv' } },
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
    const found =
      'data/invoices.csv:3: INV-2,C-2,4550,2026-11-15,\ndata/invoices.csv:4: INV-3,C-1,990,2026-11-02,false';
    expect(trace.steps[1]).toMatchObject({
      kind: 'tool',
      callId: 'call_0_0',
      name: 'grep',
      result: found,
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
    expect(followUp).toEqual({
      role: 'tool',
      toolCallId: 'call_0_0',
      name: 'grep',
      content: found,
    });
  });

  it('keeps what the provider billed for each model call in the trace, when it said', async () => {
    const { trace } = await run([
      { text: 'Let me look.', toolCalls: [{ name: 'ls', arguments: {} }], costUsd: 0.0021 },
      answer('[]'),
    ]);
    const models = trace.steps.filter((step) => step.kind === 'model');
    expect(models.map((step) => step.costUsd)).toEqual([0.0021, undefined]);
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
    const { student } = await run([{ toolCalls: [{ name: 'ls' }] }, answer('1')]);
    expect(student.requests.map((request) => request.seed)).toEqual([42, 42]);
    expect(student.requests.map((request) => request.decoding)).toEqual([decoding, decoding]);
    const fixed = { ...decoding, temperature: 0.2 };
    const overridden = await run([answer('1')], { decoding: fixed, seed: 9 });
    expect(overridden.student.requests[0]).toMatchObject({ seed: 9, decoding: fixed });
  });

  it('records what the attempt started from, so it can be replayed', async () => {
    const decoding = { ...makeHarness().decoding, temperature: 0.3 };
    const { trace, files } = await run([answer('1')], { decoding, seed: 7 });
    expect(trace.replay).toEqual({
      data: files.dataHashes(),
      harnessHash: 'sha256-test',
      toolRuntime: TOOL_RUNTIME,
      seed: 7,
      decoding,
      today: '2026-11-03',
    });
    expect(Object.keys(trace.replay?.data ?? {})).toEqual([
      'data/customers.csv',
      'data/invoices.csv',
      'data/policy.md',
    ]);
    expect(trace.changes).toEqual([]);
  });

  it('keeps the diff of every write with the trace', async () => {
    const { trace } = await run([
      {
        toolCalls: [
          {
            name: 'append',
            arguments: { path: 'data/invoices.csv', text: 'INV-4,C-3,700,2026-12-01,' },
          },
        ],
      },
      {
        toolCalls: [
          {
            name: 'edit',
            arguments: {
              path: 'data/invoices.csv',
              old_string: 'INV-1,C-1,12000,2026-10-01,true',
              new_string: 'INV-1,C-1,12500,2026-10-01,true',
            },
          },
        ],
      },
      answer('"done"'),
    ]);
    const writes = trace.steps.flatMap((step) =>
      step.kind === 'tool' && step.change ? [step.change] : [],
    );
    expect(writes.map((change) => [change.op, change.applied])).toEqual([
      ['append', true],
      ['edit', true],
    ]);
    expect(writes[0]?.rows?.added).toEqual([['INV-4', 'C-3', '700', '2026-12-01', null]]);
    expect(writes[1]?.patch).toContain(
      '-INV-1,C-1,12000,2026-10-01,true\n+INV-1,C-1,12500,2026-10-01,true',
    );
    expect(trace.changes).toHaveLength(1);
    expect(trace.changes?.[0]).toMatchObject({
      path: 'data/invoices.csv',
      rows: {
        added: [['INV-4', 'C-3', '700', '2026-12-01', null]],
        changed: [
          {
            before: ['INV-1', 'C-1', '12000', '2026-10-01', 'true'],
            after: ['INV-1', 'C-1', '12500', '2026-10-01', 'true'],
          },
        ],
      },
    });
  });

  it('returns unknown tools and bad arguments to the model as errors, then carries on', async () => {
    const { trace, student } = await run([
      {
        toolCalls: [
          { name: 'read_files', arguments: { path: 'data/invoices.csv' } },
          { name: 'read', arguments: { path: 'data/invoices.csv', limit: 'all' } },
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
    expect(replies.map((message) => message.content)).toEqual([
      expect.stringMatching(/^Error: There is no tool called "read_files"/),
      expect.stringMatching(/^Error: Invalid arguments for read\. limit: /),
    ]);
  });

  it('stops at the step limit', async () => {
    const harness = makeHarness({ decoding: { maxSteps: 3 } });
    const { trace, student } = await run(() => ({ toolCalls: [{ name: 'ls' }] }), {
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

  it("asks again with another seed when a reply can't be read, and carries on", async () => {
    const unreadable = new AdapterError(
      'bad_response',
      "The model wrote a tool call Ollama couldn't read (parse Glimmer call to run).",
    );
    const { trace, student } = await run([{ error: unreadable }, answer('1')]);
    expect(trace).toMatchObject({ stopReason: 'answer', finalText: 'ANSWER: 1' });
    // The retry's seed follows from the turn's own, so a repeated run asks the same again.
    expect(student.requests.map((request) => request.seed)).toEqual([42, 42 + 1_000_003]);
    expect(trace.steps.map((step) => step.kind)).toEqual(['model']);
  });

  it("ends the trace with an error when the model's reply can't be read three times", async () => {
    const unreadable = (n: number) => ({
      error: new AdapterError(
        'bad_response',
        `The model sent tool arguments that are not JSON (${n}).`,
      ),
    });
    const { trace, student } = await run([unreadable(1), unreadable(2), unreadable(3)]);
    expect(trace).toMatchObject({
      stopReason: 'error',
      error: 'The model sent tool arguments that are not JSON (3).',
      finalText: '',
    });
    expect(student.requests).toHaveLength(3);
  });

  it('asks again after part of the reply was shown, and takes the shown text back', async () => {
    const onScreen = screen();
    const { trace, student } = await run(
      [
        {
          text: 'Let me add it up.',
          failAfterText: new AdapterError(
            'bad_response',
            'The model sent a call that is not JSON.',
          ),
        },
        { text: 'ANSWER: 3' },
      ],
      onScreen.hooks,
    );
    expect(onScreen.seen.retracted).toEqual(['Let me add it up.'.length]);
    // What the person is left with is the turn that was kept.
    expect(onScreen.seen.text).toBe('ANSWER: 3');
    expect(trace).toMatchObject({ stopReason: 'answer', finalText: 'ANSWER: 3' });
    expect(student.requests.map((request) => request.seed)).toEqual([42, 42 + 1_000_003]);
    expect(trace.steps.map((step) => step.kind)).toEqual(['model']);
  });

  it('takes back the text of every turn it asks again, and keeps the turns before', async () => {
    const unreadable = new AdapterError('bad_response', 'The model sent a call that is not JSON.');
    const onScreen = screen();
    const { trace, student } = await run(
      [
        { text: 'Let me look.', toolCalls: [{ name: 'ls', arguments: {} }] },
        { text: 'Trying one way. ', failAfterText: unreadable },
        { text: 'Trying another. ', failAfterText: unreadable },
        { text: 'ANSWER: 3' },
      ],
      onScreen.hooks,
    );
    expect(onScreen.seen.retracted).toEqual(['Trying one way. '.length, 'Trying another. '.length]);
    expect(onScreen.seen.text).toBe('Let me look.ANSWER: 3');
    expect(trace.stopReason).toBe('answer');
    expect(student.requests).toHaveLength(4);
  });

  it('ends on a third unreadable reply and leaves its text, since no turn follows to replace it', async () => {
    const unreadable = (n: number) => ({
      text: `Attempt ${n}. `,
      failAfterText: new AdapterError('bad_response', `The call was not JSON (${n}).`),
    });
    const onScreen = screen();
    const { trace } = await run([unreadable(1), unreadable(2), unreadable(3)], onScreen.hooks);
    expect(onScreen.seen.retracted).toHaveLength(2);
    expect(onScreen.seen.text).toBe('Attempt 3. ');
    expect(trace).toMatchObject({ stopReason: 'error', error: 'The call was not JSON (3).' });
  });

  it('takes nothing back when nothing was shown', async () => {
    const onScreen = screen();
    const unreadable = new AdapterError('bad_response', 'The model sent a call that is not JSON.');
    await run([{ error: unreadable }, answer('1')], onScreen.hooks);
    expect(onScreen.seen.retracted).toEqual([]);
  });

  it('asks again after a reply cut off at its length limit, and pays for the one it threw away', async () => {
    const onScreen = screen();
    const { trace, student } = await run(
      [
        {
          text: 'The total is 12',
          cutOff: true,
          usage: { inputTokens: 900, outputTokens: 4_096 },
          costUsd: 0.01,
        },
        { text: 'ANSWER: 12', usage: { inputTokens: 910, outputTokens: 20 }, costUsd: 0.002 },
      ],
      onScreen.hooks,
    );
    expect(trace).toMatchObject({ stopReason: 'answer', finalText: 'ANSWER: 12' });
    expect(student.requests.map((request) => request.seed)).toEqual([42, 42 + 1_000_003]);
    expect(onScreen.seen.retracted).toEqual(['The total is 12'.length]);
    expect(onScreen.seen.text).toBe('ANSWER: 12');
    // One turn in the trace, whose usage and charge include the reply that was asked for again.
    const turns = trace.steps.filter((step) => step.kind === 'model');
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ usage: { inputTokens: 1_810, outputTokens: 4_116 } });
    expect(turns[0]?.costUsd).toBeCloseTo(0.012, 10);
    expect(trace.usage).toMatchObject({ inputTokens: 1_810, outputTokens: 4_116 });
  });

  it('leaves the charge off a turn when the provider billed only some of its replies', async () => {
    const { trace } = await run([
      { text: 'Partway', cutOff: true, costUsd: 0.01 },
      { text: 'ANSWER: 1' },
    ]);
    const turn = trace.steps.find((step) => step.kind === 'model');
    // The turn is priced by its usage instead, which covers both replies.
    expect(turn).toMatchObject({ usage: { inputTokens: 200, outputTokens: 40 } });
    expect(turn && 'costUsd' in turn).toBe(false);
  });

  it('names a reply that was cut off every time it was asked for as a cut-off, not an unreadable call', async () => {
    const thinking = await run(Array.from({ length: 3 }, () => ({ text: '', cutOff: true })));
    expect(thinking.student.requests).toHaveLength(3);
    expect(thinking.trace.stopReason).toBe('error');
    expect(thinking.trace.error).toContain('was cut off at the 4096-token output limit');
    expect(thinking.trace.error).toContain('while the model was still thinking');
    expect(thinking.trace.error).toContain('3 times in a row');
    expect(thinking.trace.error).toContain('max_output_tokens');
    expect(thinking.trace.error).not.toContain('unreadable');
    // All three were paid for, though only the last is a turn in the trace.
    expect(thinking.trace.usage).toMatchObject({ inputTokens: 300, outputTokens: 60 });
    job?.remove();
    job = undefined;

    const midAnswer = await run(
      Array.from({ length: 3 }, () => ({ text: 'The total is 12', cutOff: true })),
    );
    expect(midAnswer.trace).toMatchObject({ stopReason: 'error', finalText: 'The total is 12' });
    expect(midAnswer.trace.error).toContain('in the middle of its answer');
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

  it('stops when aborted while a change waits for approval', async () => {
    const controller = new AbortController();
    const { trace, files } = await run(
      [
        {
          toolCalls: [
            {
              name: 'append',
              arguments: { path: 'data/invoices.csv', text: 'INV-4,C-1,1,2026-12-01,' },
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
    expect(files.tables()['invoices.csv']?.rows).toHaveLength(3);
    expect(trace.changes).toEqual([]);
  });

  it('records skills loaded by retrieval rules and read by the agent, and lists them', async () => {
    const harness = makeHarness({
      skills: [
        {
          name: 'find-unpaid',
          description: 'Check the paid column.',
          body: 'Unpaid means paid is not true.',
        },
        { name: 'price-a-job', description: 'Price it.', body: 'Labor first.' },
      ],
      retrieval: { rules: [{ whenAny: ['unpaid'], loadSkills: ['find-unpaid'] }] },
    });
    const { trace, student } = await run(
      [
        { toolCalls: [{ name: 'read', arguments: { path: 'skills/price-a-job/SKILL.md' } }] },
        answer('[]'),
      ],
      { harness },
    );
    expect(trace.steps.filter((step) => step.kind === 'skill')).toEqual([
      { kind: 'skill', slug: 'find-unpaid', via: 'rule' },
      { kind: 'skill', slug: 'price-a-job', via: 'tool' },
    ]);
    const system = student.requests[0]?.messages[0]?.content ?? '';
    expect(system).toContain('Unpaid means paid is not true.');
    expect(system).toContain('- price-a-job: Price it.');
    expect(student.requests[1]?.messages.at(-1)?.content).toContain('Labor first.');
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
