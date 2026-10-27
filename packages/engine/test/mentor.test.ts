import { mkdtempSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AdapterError,
  GuardError,
  type LineageEntry,
  type MentorCompletionRequest,
  type Trace,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { describeDataFiles } from '../src/mentor/data-files';
import { LeakRefusal, MentorGate, payloadText, type MentorCharge } from '../src/mentor/gate';
import { diagnoseRequest, oneShotRequest } from '../src/mentor/prompts';
import { HYPOTHESIS_JSON_SCHEMA, MentorReplyError, parseHypothesis } from '../src/mentor/reply';
import { studentAsMentor } from '../src/mentor/student-author';
import { renderCompactTrace } from '../src/mentor/trace';
import { buildMentorView, buildOneShotView } from '../src/mentor/view';
import { FakeMentor, FakeStudent, hypothesis } from './fakes/adapters';
import { defaultJob, task } from './fakes/job';

const testPrompt = task('test', 'invoice', 1).prompt;

function request(content: string): MentorCompletionRequest {
  return {
    system: 'You are the mentor.',
    messages: [{ role: 'user', content }],
    maxOutputTokens: 1_000,
  };
}

function gate(options: { maxUsd?: number; refusals?: string[] } = {}) {
  let spent = 0;
  const refusals = options.refusals ?? [];
  return new MentorGate({
    leakDetector: {
      scan: (text) => ({
        leaked: text.includes(testPrompt),
        matchedIds: text.includes(testPrompt) ? ['test-invoice-1'] : [],
      }),
    },
    authorize: (maxUsd) => {
      if (maxUsd === null || spent + maxUsd > (options.maxUsd ?? 1)) {
        throw new GuardError('budget', 'Over the cap.');
      }
      spent += maxUsd;
      return maxUsd;
    },
    onRefusal: (message) => refusals.push(message),
  });
}

/** A gate that lets every call through and records the most each could cost. */
function recordingGate(asked: (number | null)[]) {
  return new MentorGate({
    leakDetector: { scan: () => ({ leaked: false, matchedIds: [] }) },
    authorize: (maxUsd) => {
      asked.push(maxUsd);
      return maxUsd ?? 0;
    },
    onRefusal: () => undefined,
  });
}

function sampleTrace(overrides: Partial<Trace> = {}): Trace {
  return {
    taskId: 'train-invoice-1',
    harnessVersion: 0,
    studentModel: 'glimmer:test',
    messages: [{ role: 'user', content: 'Price job J-1.' }],
    steps: [
      { kind: 'skill', slug: 'price-a-job', via: 'rule' },
      {
        kind: 'model',
        text: 'I will read the job.',
        toolCalls: [{ id: 'c1', name: 'read_table', arguments: { name: 'jobs.csv' } }],
        usage: { inputTokens: 40, outputTokens: 12 },
        latencyMs: 900,
      },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'read_table',
        arguments: { name: 'jobs.csv' },
        result: Array.from({ length: 200 }, (_, i) => ({ id: `J-${i}`, minutes: i * 15 })),
        latencyMs: 4,
      },
      {
        kind: 'tool',
        callId: 'c2',
        name: 'calculate',
        arguments: { expression: '1/0' },
        result: null,
        error: 'Division by zero.',
        latencyMs: 1,
      },
      {
        kind: 'model',
        text: 'ANSWER: {"total_cents": 1250}',
        toolCalls: [],
        usage: { inputTokens: 80, outputTokens: 9 },
        latencyMs: 700,
      },
    ],
    finalText: 'ANSWER: {"total_cents": 1250}',
    stopReason: 'answer',
    usage: { inputTokens: 120, outputTokens: 21 },
    latencyMs: 1_610,
    ...overrides,
  };
}

describe('the mentor gate', () => {
  it('refuses a payload that carries a locked test prompt before the adapter is called', async () => {
    const mentor = new FakeMentor();
    const refusals: string[] = [];
    const call = gate({ refusals }).complete(
      mentor,
      request(`Here is a task to study:\n${testPrompt}`),
    );
    await expect(call).rejects.toMatchObject({ name: 'GuardError', guard: 'split' });
    expect(mentor.requests).toHaveLength(0);
    expect(refusals).toEqual(['Refused a mentor call: its payload matched 1 locked test task.']);
  });

  it('names the parts of a refused payload that matched, never their text', async () => {
    const mentor = new FakeMentor();
    const refusals: string[] = [];
    const parts = [
      { label: 'data file policy.md', text: 'Labor is billed per started 15 minutes.' },
      { label: 'train task train-invoice-1', text: `Same as: ${testPrompt}` },
      { label: 'harness file system.md', text: 'Finish with the ANSWER line.' },
    ];
    const call = gate({ refusals }).complete(
      mentor,
      request(parts.map((part) => part.text).join('\n')),
      { parts },
    );
    await expect(call).rejects.toBeInstanceOf(LeakRefusal);
    expect(refusals).toEqual([
      'Refused a mentor call: its payload matched 1 locked test task, in train task train-invoice-1.',
    ]);

    const many = ['a', 'b', 'c', 'd', 'e'].map((name) => ({
      label: `train task ${name}`,
      text: testPrompt,
    }));
    await expect(gate().complete(mentor, request(testPrompt), { parts: many })).rejects.toThrow(
      'in train task a, train task b, train task c and 2 more parts.',
    );
    expect(mentor.requests).toHaveLength(0);
  });

  it('scans the system prompt too, not only the messages', async () => {
    const mentor = new FakeMentor();
    const leaky = { ...request('Fine.'), system: `Rules.\n${testPrompt}` };
    await expect(gate().complete(mentor, leaky)).rejects.toBeInstanceOf(GuardError);
    expect(mentor.requests).toHaveLength(0);
  });

  it('never starts a call that could cross the dollar cap', async () => {
    const mentor = new FakeMentor();
    const big = { ...request('Fine.'), maxOutputTokens: 1_000_000 };
    await expect(gate({ maxUsd: 1 }).complete(mentor, big)).rejects.toMatchObject({
      guard: 'budget',
    });
    expect(mentor.requests).toHaveLength(0);
  });

  it('refuses every call once the mentor is released for the locked test', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const guarded = gate();
    await guarded.complete(mentor, request('Fine.'));
    guarded.release();
    await expect(guarded.complete(mentor, request('Fine.'))).rejects.toMatchObject({
      guard: 'split',
    });
    expect(mentor.requests).toHaveLength(1);
  });

  it('counts the adapter’s repair call in the worst case of a JSON request', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const big = { ...request('Fine.'), maxOutputTokens: 100_000 };
    const json = { ...big, json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA } };
    await expect(gate({ maxUsd: 0.6 }).complete(mentor, json)).rejects.toMatchObject({
      guard: 'budget',
    });
    expect(mentor.requests).toHaveLength(0);
    await expect(gate({ maxUsd: 0.6 }).complete(mentor, big)).resolves.toBeDefined();
  });

  it('estimates the input at 2.5 bytes per token before it knows better', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const asked: (number | null)[] = [];
    const sent = request('x'.repeat(1_000));
    await recordingGate(asked).complete(mentor, sent);
    const inputTokens = Math.ceil(Buffer.byteLength(payloadText(sent)) / 2.5);
    expect(asked[0]).toBe(mentor.estimateCostUsd({ inputTokens, outputTokens: 1_000 }));
  });

  it('never estimates below the tokens per byte the last call reported', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const asked: (number | null)[] = [];
    const guarded = recordingGate(asked);
    const sent = request('Fine.');
    await guarded.complete(mentor, sent);
    await guarded.complete(mentor, request('Fine, twice.'));
    const ratio = 2_000 / Buffer.byteLength(payloadText(sent));
    const inputTokens = Math.ceil(Buffer.byteLength(payloadText(request('Fine, twice.'))) * ratio);
    expect(asked[1]).toBe(mentor.estimateCostUsd({ inputTokens, outputTokens: 1_000 }));
  });

  it('charges a failed call the provider billed for', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => {
      throw Object.assign(new AdapterError('bad_response', 'The reply was not JSON.'), {
        usage: { inputTokens: 100, outputTokens: 50 },
        costUsd: null,
      });
    };
    const charges: MentorCharge[] = [];
    const call = gate().complete(mentor, request('Fine.'), {
      onSpent: (charge) => charges.push(charge),
    });
    await expect(call).rejects.toMatchObject({ code: 'bad_response' });
    expect(charges).toEqual([
      {
        model: 'fake-mentor-1',
        usage: { inputTokens: 100, outputTokens: 50 },
        costUsd: (100 * 1.25 + 50 * 4.25) / 1_000_000,
      },
    ]);
  });

  it('passes a clean call through and charges what it cost', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const { completion, costUsd } = await gate().complete(mentor, request('Fine.'));
    expect(completion.model).toBe('fake-mentor-1');
    expect(costUsd).toBeCloseTo(0.004625);
  });

  it('announces a call only once every check has passed', async () => {
    const mentor = new FakeMentor();
    mentor.script = () => hypothesis('A', 'fix:invoice');
    const sent: string[] = [];
    const guarded = gate();
    await guarded
      .complete(mentor, request(testPrompt), { onSend: () => sent.push('leaky') })
      .catch(() => undefined);
    await guarded.complete(mentor, request('Fine.'), { onSend: () => sent.push('clean') });
    expect(sent).toEqual(['clean']);
  });
});

describe('the hypothesis reply', () => {
  it('fits constrained decoding: every object closed, every key required', () => {
    const objects: Record<string, unknown>[] = [];
    const walk = (node: unknown) => {
      if (typeof node !== 'object' || node === null) return;
      const record = node as Record<string, unknown>;
      if (record.type === 'object') objects.push(record);
      Object.values(record).forEach(walk);
    };
    walk(HYPOTHESIS_JSON_SCHEMA);
    expect(objects).toHaveLength(3);
    for (const object of objects) {
      expect(object.additionalProperties).toBe(false);
      expect([...(object.required as string[])].sort()).toEqual(
        Object.keys(object.properties as object).sort(),
      );
    }
  });

  it('maps the flat edits onto the shared hypothesis', () => {
    const parsed = parseHypothesis(
      {
        text: '',
        json: {
          ...hypothesis('x'.repeat(100), 'fix:invoice', {
            causeTaskIds: ['train-invoice-1', 'dev-invoice-1'],
            predicted: { devDeltaMin: 4, devDeltaMax: 1, rationale: 'Reversed on purpose.' },
          }),
          edits: [
            { op: 'write', path: 'system.md', content: 'fix:invoice' },
            { op: 'delete', path: 'skills/old.md', content: '' },
          ],
        },
      },
      new Set(['train-invoice-1']),
    );
    expect(parsed.title).toHaveLength(80);
    expect(parsed.edits).toEqual([
      { op: 'write', path: 'system.md', content: 'fix:invoice' },
      { op: 'delete', path: 'skills/old.md' },
    ]);
    expect(parsed.causeTaskIds).toEqual(['train-invoice-1']);
    expect(parsed.predicted).toMatchObject({ devDeltaMin: 1, devDeltaMax: 4 });
  });

  it('reads the JSON out of free text when the endpoint has no structured output', () => {
    const text = `Here it is:\n\`\`\`json\n${JSON.stringify(hypothesis('A', 'fix:overdue'))}\n\`\`\``;
    expect(parseHypothesis({ text }, new Set()).title).toBe('A');
    const braces = `The {total} was off, so:\n${JSON.stringify(hypothesis('B', 'fix:invoice'))}`;
    expect(parseHypothesis({ text: braces }, new Set()).title).toBe('B');
  });

  it('rejects a reply that is not a usable hypothesis', () => {
    expect(() => parseHypothesis({ text: 'I am not sure.' }, new Set())).toThrow(MentorReplyError);
    expect(() =>
      parseHypothesis({ text: '', json: { ...hypothesis('A', 'x'), edits: [] } }, new Set()),
    ).toThrow(MentorReplyError);
  });
});

describe('renderCompactTrace', () => {
  it('shows model text, tool calls with arguments, results, errors, the answer and the stop', () => {
    const text = renderCompactTrace(sampleTrace());
    expect(text).toContain('skill price-a-job loaded by a retrieval rule');
    expect(text).toContain('model: I will read the job.');
    expect(text).toContain('call read_table {"name":"jobs.csv"}');
    expect(text).toMatch(/read_table → 200 items \[.*… \[\d+ more chars\]/);
    expect(text).toContain('calculate failed: Division by zero.');
    expect(text).toContain('final answer: ANSWER: {"total_cents": 1250}');
    expect(text).toContain('stopped: answer after 2 model steps, 120 in / 21 out tokens, 1.6 s');
  });

  it('stays within its bound, dropping the middle and keeping the ending', () => {
    const steps = Array.from({ length: 80 }, (_, i) => ({
      kind: 'model' as const,
      text: `Step ${i}: ${'thinking '.repeat(60)}`,
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1 },
      latencyMs: 1,
    }));
    const text = renderCompactTrace(sampleTrace({ steps, stopReason: 'max_steps' }));
    expect(text.length).toBeLessThanOrEqual(6_000);
    expect(text).toContain('Step 0:');
    expect(text).toContain('Step 79:');
    expect(text).toMatch(/… \d+ lines omitted …/);
    expect(text).toContain('stopped: max_steps');
  });
});

describe('the mentor view', () => {
  const job = defaultJob();
  const lineage: LineageEntry = {
    id: 'chg_1',
    runId: 'run_1',
    round: 1,
    title: 'Add the invoice procedure',
    diagnosis: 'Invoices had no pricing rule.',
    files: ['system.md'],
    causeTaskIds: ['train-invoice-1'],
    predicted: { devDeltaMin: 1, devDeltaMax: 3, rationale: 'Three tasks.' },
    measured: {
      devBefore: { pass: 0, total: 9 },
      devAfter: { pass: 3, total: 9 },
      delta: 3,
      perType: [{ type: 'invoice', before: 0, after: 3 }],
    },
    decision: 'kept',
    decisionReason: 'Dev 0/9 → 3/9, no type lost more than one',
    versionFrom: 0,
    versionTo: 1,
    mentor: { model: 'fake-mentor-1', costUsd: 0.004, inputTokens: 2000, outputTokens: 500 },
    at: '2026-10-27T14:00:00.000Z',
  };

  it('holds train attempts and only the overall dev score, never dev tasks', () => {
    const view = buildMentorView({
      job,
      dataFiles: [],
      harnessFiles: { 'system.md': 'fix:invoice' },
      round: 2,
      budgetLeft: { rounds: 1, usd: 4.9, minutes: 50 },
      train: [
        { task: task('train', 'invoice', 1), pass: true, reason: 'Matches.', trace: sampleTrace() },
        { task: task('train', 'overdue', 1), pass: false, reason: 'Wrong.', trace: sampleTrace() },
      ],
      dev: { pass: 3, total: 9 },
      lineage: [lineage],
      rejected: [],
    });
    expect(view.dev).toEqual({ pass: 3, total: 9 });
    expect(view.train.perType).toEqual([
      { type: 'invoice', pass: 1, total: 1 },
      { type: 'overdue', pass: 0, total: 1 },
    ]);
    expect(view.lineage).toEqual([
      {
        round: 1,
        title: 'Add the invoice procedure',
        diagnosis: 'Invoices had no pricing rule.',
        files: ['system.md'],
        decision: 'kept',
        devDelta: 3,
      },
    ]);
    const text = JSON.stringify(diagnoseRequest(view, { evaluation: job.evaluation }));
    expect(text).not.toMatch(/dev-(invoice|overdue|scheduling)/);
    expect(text).not.toContain('[dev]');
    expect(text).not.toContain('perType":[{"type":"invoice","before"');
    expect(text).toContain('[train] overdue request number 1');
  });

  it('shows rejected rounds in order, with the reason on one line', () => {
    const view = buildMentorView({
      job,
      dataFiles: [],
      harnessFiles: { 'system.md': 'fix:invoice' },
      round: 4,
      budgetLeft: { rounds: 1, usd: 4.9, minutes: 50 },
      train: [],
      dev: { pass: 3, total: 9 },
      lineage: [lineage],
      rejected: [
        {
          round: 3,
          title: 'Add a table reader',
          files: ['tools/read_table.js', 'tools/read_table.json'],
          reason:
            'tools/read_table.json: "read_table" is a built-in tool name. Pick a different name.\ntools/read_table.js: has no manifest.',
        },
        { round: 2, files: [], reason: 'The reply contained no JSON object.' },
      ],
    });
    expect(view.lineage.map((item) => [item.round, item.decision])).toEqual([
      [1, 'kept'],
      [2, 'rejected'],
      [3, 'rejected'],
    ]);
    const content = diagnoseRequest(view, { evaluation: job.evaluation }).messages[0]?.content;
    expect(content).toContain(
      '- Round 2, rejected before dev saw it: the reply held no usable hypothesis. Why: The reply contained no JSON object.',
    );
    expect(content).toContain(
      '- Round 3, rejected before dev saw it: Add a table reader. Files: tools/read_table.js, tools/read_table.json. Why: tools/read_table.json: "read_table" is a built-in tool name. Pick a different name. tools/read_table.js: has no manifest.',
    );
    expect(content).not.toContain('None yet.');
  });

  it('gives the one-shot mentor train examples with answers and no attempts', () => {
    const view = buildOneShotView({
      job,
      dataFiles: [],
      harnessFiles: { 'system.md': 'Blank.' },
      budgetLeft: { rounds: 1, usd: 5, minutes: 60 },
      train: [task('train', 'invoice', 1)],
      devTotal: 9,
    });
    const sent = oneShotRequest(view, { evaluation: job.evaluation });
    expect(sent.system).toContain('Write its whole harness in one go');
    expect(sent.system).toContain('out of 9 dev tasks');
    expect(sent.messages[0]?.content).toContain('[train] invoice request number 1');
    expect(sent.messages[0]?.content).toContain('"ok": true');
    expect(sent.messages[0]?.content).not.toContain('Trace:');
  });

  it('tells the mentor the keep margin, the harness surface and the sandbox rules', () => {
    const view = buildOneShotView({
      job,
      dataFiles: [],
      harnessFiles: {},
      budgetLeft: { rounds: 1, usd: 5, minutes: 60 },
      train: [],
      devTotal: 9,
    });
    const { system, json } = diagnoseRequest(
      {
        ...view,
        round: 1,
        train: { results: [], perType: [] },
        dev: { pass: 0, total: 9 },
        lineage: [],
      },
      { evaluation: { minDevGain: 3, maxTypeRegression: 1 } },
    );
    expect(system).toContain('rise by at least 3 and no task type loses more than 1 pass');
    expect(system).toContain('function run(args, ctx)');
    expect(system).toContain('no clock and no randomness');
    expect(system).toContain('retrieval.yaml');
    expect(system).toContain('guardrails.yaml');
    expect(json?.schema).toBe(HYPOTHESIS_JSON_SCHEMA);
  });
});

describe('describeDataFiles', () => {
  it('reads each table’s columns, row count and first three rows, and text files whole', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'architect-data-'));
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(
        join(dir, 'jobs.csv'),
        'id,minutes,member\nJ-1,90,true\nJ-2,45,false\nJ-3,30,true\nJ-4,15,false\n',
      );
      await writeFile(join(dir, 'policy.md'), '# Policy\nRound up to 15 minutes.\n');
      const files = await describeDataFiles(
        [
          { name: 'jobs.csv', kind: 'table', access: 'read' },
          { name: 'policy.md', kind: 'text', access: 'read' },
        ],
        dir,
      );
      expect(files[0]).toEqual({
        name: 'jobs.csv',
        kind: 'table',
        access: 'read',
        columns: ['id', 'minutes', 'member'],
        rowCount: 4,
        sampleRows: [
          { id: 'J-1', minutes: 90, member: true },
          { id: 'J-2', minutes: 45, member: false },
          { id: 'J-3', minutes: 30, member: true },
        ],
      });
      expect(files[1]).toEqual({
        name: 'policy.md',
        kind: 'text',
        access: 'read',
        text: '# Policy\nRound up to 15 minutes.\n',
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('studentAsMentor', () => {
  it('sends the same request to the student with the runner’s seed, at no dollar cost', async () => {
    const student = new FakeStudent(
      defaultJob().student.local,
      () => `Sure.\n${JSON.stringify(hypothesis('Self fix', 'fix:invoice'))}`,
    );
    const author = studentAsMentor(student, 4242);
    const completion = await author.complete({
      ...request('Diagnose this round.'),
      json: { name: 'hypothesis', schema: HYPOTHESIS_JSON_SCHEMA },
    });
    expect(student.chats[0]?.seed).toBe(4242);
    expect(student.chats[0]?.tools).toEqual([]);
    expect(student.chats[0]?.messages[0]?.content).toContain('Reply with one JSON object');
    expect(completion.costUsd).toBe(0);
    expect(author.estimateCostUsd({ inputTokens: 1e9, outputTokens: 1e9 })).toBe(0);
    expect(parseHypothesis(completion, new Set()).title).toBe('Self fix');
  });
});
