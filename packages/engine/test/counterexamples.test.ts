import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HarnessSchema,
  JobSchema,
  TaskSchema,
  type Counterexample,
  type Harness,
  type HarnessTool,
  type Job,
  type Task,
} from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createChecker } from '../src/checker/checker';
import { findCounterexamples } from '../src/counterexamples/find';
import { failureHolds, regressionFailure } from '../src/counterexamples/predicate';
import { reduceCase, type CaseData } from '../src/counterexamples/reduce';
import { runSuite } from '../src/counterexamples/suite';
import { runTaskAttempt } from '../src/eval/evaluate';
import { createSandbox } from '../src/sandbox/sandbox';
import type { Sandbox } from '../src/sandbox/types';
import { ScriptedStudent } from './support/scripted-student';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
/** The academy job: Copperfield is a train academy whose tests use the "Full" layout. */
const ACADEMY = join(REPO, 'examples', 'academy', 'job');
const job: Job = JobSchema.parse(JSON.parse(readFileSync(join(ACADEMY, 'job.json'), 'utf8')));
const tasks = readFileSync(join(ACADEMY, 'tasks.jsonl'), 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => TaskSchema.parse(JSON.parse(line)));
const taskOf = (id: string): Task => {
  const found = tasks.find((task) => task.id === id);
  if (!found) throw new Error(`No task ${id}`);
  return found;
};

/** Phil's first lookup: one row per test, section, module and number, as one-section tests have. */
const LOOKUP = `function run(args, ctx) {
  var hit = ctx.readTable('tests.csv').filter(function (row) {
    return row.test_name === args.test_name && row.section === args.section &&
      row.module === String(args.module) && row.number === String(args.number);
  })[0];
  if (!hit) throw new Error('test position not found');
  var question = ctx.readTable('questions.csv').filter(function (row) {
    return row.question_id === hit.question_id;
  })[0];
  return { question_id: question.question_id, topic: question.topic, correct: question.correct };
}`;

/** The repair: every row at the position, then the one whose question is in the asked section. */
const REPAIRED_LOOKUP = `function run(args, ctx) {
  var questions = ctx.readTable('questions.csv');
  var hits = ctx.readTable('tests.csv').filter(function (row) {
    return row.test_name === args.test_name && row.module === String(args.module) &&
      row.number === String(args.number);
  });
  for (var i = 0; i < hits.length; i++) {
    var question = questions.filter(function (row) { return row.question_id === hits[i].question_id; })[0];
    if (question && question.section === args.section) {
      return { question_id: question.question_id, topic: question.topic, correct: question.correct };
    }
  }
  throw new Error('no ' + args.section + ' question at that position');
}`;

/** A history helper that counts a right answer only when its text equals the key. */
const HISTORY = `function run(args, ctx) {
  var key = function (label) { return String(label).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); };
  var rows = ctx.readTable('attempts.csv').filter(function (row) {
    return row.student_id === args.student_id && key(row.topic) === key(args.topic) && row.taken_on <= args.as_of;
  });
  rows.sort(function (a, b) {
    return (a.taken_on < b.taken_on ? -1 : a.taken_on > b.taken_on ? 1 : 0) ||
      Number(a.module) - Number(b.module) || Number(a.number) - Number(b.number);
  });
  var seen = {};
  var latest = rows.filter(function (row) {
    if (seen[row.question_id]) return false;
    seen[row.question_id] = true;
    return true;
  }).slice(-6);
  var correct = latest.filter(function (row) { return row.selected === row.correct; }).length;
  return { as_of: args.as_of, window: 6, attempts: latest.length, correct: correct };
}`;

const helper = (name: string, code: string): HarnessTool => ({
  name,
  description: `The ${name} helper.`,
  parameters: { type: 'object', properties: {} },
  code,
});

function harnessWith(tools: HarnessTool[]): Harness {
  return HarnessSchema.parse({
    meta: { format: 2, name: 'Phil', version: 4, hash: 'sha256-phil-4' },
    system: 'You are Phil, a tutor.',
    retrieval: {},
    decoding: {},
    guardrails: {},
    tools,
  });
}

const TODAY = '2026-11-16';
let sandbox: Sandbox;

beforeAll(() => {
  sandbox = createSandbox({ timeoutMs: 5_000 });
});
afterAll(() => sandbox.dispose());

/** The student calls one helper, then answers wrong; graded by the academy's own checker. */
async function failedAttempt(
  task: Task,
  harness: Harness,
  name: string,
  args: Record<string, string | number>,
) {
  const result = await runTaskAttempt(task, {
    job,
    jobDir: ACADEMY,
    harness,
    student: new ScriptedStudent([
      { toolCalls: [{ name, arguments: args }] },
      { text: 'ANSWER: {"topic": "unknown", "correct": "A", "error": "E-00"}' },
    ]),
    sandbox,
    checker: createChecker({ job, jobDir: ACADEMY, sandbox }),
    now: new Date(`${TODAY}T12:00:00Z`),
    seed: 7,
  });
  expect(result.check.pass).toBe(false);
  return { attemptId: `att_${task.id}`, task, trace: result.trace };
}

function stored(found: Awaited<ReturnType<typeof findCounterexamples>>[number]): Counterexample {
  return {
    ...found,
    id: 'cex_1',
    jobId: job.id,
    runId: 'run_1',
    round: 1,
    createdAt: '2026-11-16T12:00:00.000Z',
  };
}

describe('counterexamples from a failing helper', () => {
  it('reduces the "Full"-layout lookup crash to the rows at the asked position', async () => {
    const harness = harnessWith([helper('question_lookup', LOOKUP)]);
    const task = taskOf('copperfield-diagnose-03');
    const attempt = await failedAttempt(task, harness, 'question_lookup', {
      test_name: 'Practice Test 4',
      section: 'Math',
      module: 2,
      number: 6,
    });
    const found = await findCounterexamples({
      job,
      jobDir: ACADEMY,
      harness,
      sandbox,
      today: TODAY,
      attempts: [attempt],
      known: new Set(),
    });
    expect(found).toHaveLength(1);
    const [cx] = found;
    if (!cx) throw new Error('No counterexample');
    expect(cx.predicate).toEqual({
      kind: 'threw',
      message: 'Error: test position not found',
    });
    expect(cx.minimality).toBe('1-minimal');
    expect(cx.size.originalRows).toBeGreaterThan(2_000);
    expect(cx.size.reducedRows).toBeLessThanOrEqual(4);
    // The two questions at the place: one row of tests.csv each, both with section "Full".
    const tests = cx.tables['tests.csv'];
    expect(tests?.rows).toHaveLength(2);
    expect(tests?.rows.every((row) => row.section === 'Full' && row.number === '6')).toBe(true);
    expect(Object.keys(cx.tables).sort()).toEqual(['questions.csv', 'tests.csv']);
    expect(cx.hashes.original).not.toBe(cx.hashes.reduced);

    // The same call on the reduced case still fails the same way, and the repair passes both cases.
    const counterexample = stored(cx);
    const broken = await runSuite(
      { job, jobDir: ACADEMY, sandbox, today: TODAY },
      helper('question_lookup', LOOKUP),
      [{ counterexample, original: { task, trace: attempt.trace, harness } }],
    );
    expect(broken.map((result) => result.passed)).toEqual([false, false]);
    const repaired = await runSuite(
      { job, jobDir: ACADEMY, sandbox, today: TODAY },
      helper('question_lookup', REPAIRED_LOOKUP),
      [{ counterexample, original: { task, trace: attempt.trace, harness } }],
    );
    expect(repaired).toEqual([
      expect.objectContaining({ case: 'reduced', passed: true }),
      expect.objectContaining({ case: 'original', passed: true }),
    ]);

    // As an earlier case, with no original to replay: a crash turned into another crash fails.
    const otherCrash = LOOKUP.replace("'test position not found'", "'no such position'");
    const regression = await runSuite(
      { job, jobDir: ACADEMY, sandbox, today: TODAY },
      helper('question_lookup', otherCrash),
      [{ counterexample }],
    );
    expect(regression).toEqual([
      expect.objectContaining({
        case: 'reduced',
        passed: false,
        detail: expect.stringContaining('no such position'),
      }),
    ]);
  });

  it('keeps every row a wrong count may rest on when the answer is written another way', async () => {
    const harness = harnessWith([helper('history_calc', HISTORY)]);
    // Elin Ellery (S-1009) entered .125 for 1/8 on Sep 20, which the academy marked right.
    const task = taskOf('copperfield-history-01');
    const attempt = await failedAttempt(task, harness, 'history_calc', {
      student_id: 'S-1009',
      topic: 'Rule 4A - Solving Linear Equations',
      as_of: '2026-10-03',
    });
    const [cx] = await findCounterexamples({
      job,
      jobDir: ACADEMY,
      harness,
      sandbox,
      today: TODAY,
      attempts: [attempt],
      known: new Set(),
    });
    if (!cx) throw new Error('No counterexample');
    expect(cx.predicate).toEqual({ kind: 'contradicts', field: 'correct', expected: 4, got: 3 });
    expect(cx.size.reducedRows).toBeLessThan(cx.size.originalRows);
    const attempts = cx.tables['attempts.csv'];
    // The answer written another way stays, with every column: the reference reads `result`.
    expect(attempts?.rows).toContainEqual(
      expect.objectContaining({ student_id: 'S-1009', selected: '.125', result: 'right' }),
    );
    expect(attempts?.columns).toContain('result');
  });

  it('finds nothing when the helper did what the checker expects', async () => {
    const harness = harnessWith([helper('question_lookup', REPAIRED_LOOKUP)]);
    const attempt = await failedAttempt(
      taskOf('copperfield-diagnose-03'),
      harness,
      'question_lookup',
      {
        test_name: 'Practice Test 4',
        section: 'Math',
        module: 2,
        number: 6,
      },
    );
    const found = await findCounterexamples({
      job,
      jobDir: ACADEMY,
      harness,
      sandbox,
      today: TODAY,
      attempts: [attempt],
      known: new Set(),
    });
    expect(found).toEqual([]);
  });
});

describe('reducing a case', () => {
  const data: CaseData = {
    tables: {
      'orders.csv': {
        columns: ['order_id', 'customer_id', 'status', 'note'],
        rows: Array.from({ length: 40 }, (_, i) => ({
          order_id: `O-${i}`,
          customer_id: `C-${i % 5}`,
          status: i === 17 ? 'held' : 'open',
          note: `n${i}`,
        })),
      },
      'customers.csv': {
        columns: ['customer_id', 'name'],
        rows: Array.from({ length: 5 }, (_, i) => ({ customer_id: `C-${i}`, name: `Name ${i}` })),
      },
    },
    texts: { 'policy.md': 'Held orders wait.' },
  };
  /** Fails when any held order is in the table; the order's customer row comes along by its id. */
  const holds = async (candidate: CaseData) =>
    (candidate.tables['orders.csv']?.rows ?? []).some((row) => row.status === 'held');

  it('is deterministic, keeps referenced rows, and is 1-minimal within its cap', async () => {
    const input = {
      data,
      args: {},
      predicate: { kind: 'threw' as const, message: 'held' },
      code: "readTable('orders.csv')",
      expected: {},
      holds,
    };
    const first = await reduceCase(input);
    const second = await reduceCase(input);
    expect(second).toEqual(first);
    expect(first.minimal).toBe(true);
    expect(first.data.tables['orders.csv']?.rows).toEqual([
      expect.objectContaining({ order_id: 'O-17', status: 'held' }),
    ]);
    // Order O-17 references customer C-2, so that row stays with it.
    expect(first.data.tables['customers.csv']?.rows).toEqual([
      expect.objectContaining({ customer_id: 'C-2' }),
    ]);
    expect(first.data.texts).toEqual({});
    // The status column carries the failure; the note is gone.
    expect(first.data.tables['orders.csv']?.columns).toEqual(['order_id', 'customer_id', 'status']);
  });

  it('says reduced, not 1-minimal, when the step cap ends it early', async () => {
    const capped = await reduceCase({
      data,
      args: {},
      predicate: { kind: 'threw', message: 'held' },
      code: "readTable('orders.csv')",
      expected: {},
      holds,
      maxSteps: 3,
    });
    expect(capped.minimal).toBe(false);
    expect(capped.steps).toBe(3);
  });

  it('judges a wrong value by the same field and value', () => {
    const predicate = { kind: 'contradicts' as const, field: 'correct', expected: 5, got: 4 };
    expect(failureHolds(predicate, { ok: true, value: { correct: 4 } })).toBe(true);
    expect(failureHolds(predicate, { ok: true, value: { correct: '5' } })).toBe(false);
    expect(failureHolds(predicate, { ok: true, value: { correct: 3 } })).toBe(false);
    expect(failureHolds(predicate, { ok: false, failure: { kind: 'error', message: 'x' } })).toBe(
      false,
    );
  });

  it('passes a regression case only on a clean run that gives the expected value', () => {
    const wrong = { kind: 'contradicts' as const, field: 'correct', expected: 5, got: 4 };
    const crashed = {
      ok: false as const,
      failure: { kind: 'error' as const, message: 'Error: y' },
    };
    expect(regressionFailure(wrong, { ok: true, value: { correct: '5' } })).toBeNull();
    expect(regressionFailure(wrong, { ok: true, value: { topic: 'x' } })).toBeNull();
    expect(regressionFailure(wrong, { ok: true, value: { correct: 3 } })).toEqual({
      ...wrong,
      got: 3,
    });
    expect(regressionFailure(wrong, crashed)).toEqual({ kind: 'threw', message: 'Error: y' });
    const threw = { kind: 'threw' as const, message: 'Error: not found' };
    expect(regressionFailure(threw, crashed)).toEqual({ kind: 'threw', message: 'Error: y' });
    expect(regressionFailure(threw, { ok: true, value: null })).toBeNull();
  });

  it('judges a crash by its message wherever in the code it was thrown', () => {
    const predicate = { kind: 'threw' as const, message: 'Error: not found' };
    const thrown = (message: string) => ({
      ok: false as const,
      failure: { kind: 'error' as const, message },
    });
    expect(failureHolds(predicate, thrown('Error: not found (tools/lookup.js:9:3)'))).toBe(true);
    expect(failureHolds(predicate, thrown('Error: not found at all'))).toBe(false);
  });
});
