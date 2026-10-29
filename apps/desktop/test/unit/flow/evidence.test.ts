import type {
  ComparisonReport,
  Experiment,
  ListedLesson,
  MentoringProgress,
  Measurement,
  ReferenceRecord,
  ReportCard,
  RuntimeMeasurement,
  Trace,
  TraceStep,
} from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { formatCost, passedOf } from '../../../src/renderer/src/flow/format';
import {
  ARM_ORDER,
  comparisonArms,
  notRunReason,
  wasRun,
} from '../../../src/renderer/src/flow/report/arms';
import { reportArms } from '../../../src/renderer/src/flow/report/comparison-report';
import { runtimeFigures } from '../../../src/renderer/src/flow/report/evidence';
import {
  lessonOrigin,
  measurementLabel,
  orderedMeasurements,
  sentence,
  trainingEnd,
} from '../../../src/renderer/src/flow/train/evidence-words';
import {
  answerOf,
  correctionSteps,
  findingNotes,
} from '../../../src/renderer/src/flow/train/lesson-steps';
import {
  callLine,
  playbackSteps,
  type PlaybackCall,
  type PlaybackStep,
  type ToolTraceStep,
} from '../../../src/renderer/src/flow/train/trace-steps';
import { AT, makeJob, makeRun } from './factories';

const USAGE = { inputTokens: 100, outputTokens: 20 };

function model(text: string, calls: string[] = []): TraceStep {
  return {
    kind: 'model',
    text,
    toolCalls: calls.map((id) => ({ id, name: 'read', arguments: {} })),
    usage: USAGE,
    latencyMs: 1000,
  };
}

function tool(
  callId: string,
  name: string,
  args: Record<string, string>,
  result: string,
): ToolTraceStep {
  return { kind: 'tool', callId, name, arguments: args, result, latencyMs: 20 };
}

/** A step's call, which the test expects to be there. */
function callOf(step: PlaybackStep | undefined, at = 0): PlaybackCall {
  const call = step?.calls[at];
  if (!call) throw new Error(`Step ${step?.number ?? '?'} has no call ${at}.`);
  return call;
}

function trace(steps: TraceStep[], finalText = 'ANSWER: {"refund_cents":4998}'): Trace {
  return {
    harnessVersion: 1,
    studentModel: 'muse-glimmer:30b',
    messages: [],
    steps,
    finalText,
    stopReason: 'answer',
    usage: USAGE,
    latencyMs: 4000,
  };
}

/** A failed refund: read the policy, read the order, append a row, answer. */
const ORIGINAL = trace([
  { kind: 'skill', slug: 'refunds', via: 'rule' },
  model('', ['c1']),
  tool('c1', 'read', { path: 'data/policy.md' }, '1\tRefunds are the list price.'),
  model('', ['c2']),
  tool(
    'c2',
    'grep',
    { pattern: 'ORD-1042', path: 'data/orders.csv' },
    'data/orders.csv:4: ORD-1042',
  ),
  model('', ['c3']),
  tool('c3', 'append', { path: 'data/returns.csv', text: 'RET-9,5498\n' }, 'Added 1 row.'),
  model('ANSWER: {"refund_cents":5498}'),
]);

function lesson(overrides: Partial<ListedLesson>): ListedLesson {
  return {
    id: 'lsn_abc',
    jobId: 'job_desk',
    runId: 'run_1',
    round: 1,
    interventionId: 'itv_1',
    status: 'verified',
    reason: 'The refund matches.',
    kind: 'replay_correction',
    categoryId: 'cat_1',
    taskType: 'refund',
    source: { kind: 'attempt', attemptId: 'att_1', taskId: 'train-1' },
    checkpoint: { turn: 3, replayedCalls: 2, fallback: 'none' },
    check: { pass: true, reason: 'The refund matches.' },
    audit: { ok: true, problems: [], changed: ['data/returns.csv'] },
    turns: [],
    episode: null,
    actorModel: 'muse-spark-1.3',
    cost: { usd: 0.0021, inputTokens: 900, outputTokens: 120, calls: 2 },
    createdAt: AT,
    prompt: 'Refund order ORD-1042.',
    ...overrides,
  };
}

describe('step playback', () => {
  it('groups calls by the turn that made them, as findings count steps', () => {
    const steps = playbackSteps(ORIGINAL);
    expect(steps.map((step) => [step.number, step.calls.length, step.answer])).toEqual([
      [1, 1, false],
      [2, 1, false],
      [3, 1, false],
      [4, 0, true],
    ]);
    // A skill a rule loaded before the first turn shows with step 1.
    expect(steps[0]?.skills).toEqual(['refunds']);
  });

  it('labels a call the way the workspace does, with what it gave back', () => {
    const [, search, append] = playbackSteps(ORIGINAL);
    expect(callLine(callOf(search))).toEqual({
      action: 'Searched',
      target: 'data/orders.csv for /ORD-1042/',
      meta: '1 match',
      failed: false,
    });
    expect(callLine(callOf(append)).action).toBe('Added to');
  });

  it('shows a read of a skill as loading it, and a failed call with its error', () => {
    const failing: ToolTraceStep = {
      ...tool('c2', 'run', { code: 'boom(' }, ''),
      error: 'SyntaxError: boom\nat 1',
    };
    const [step] = playbackSteps(
      trace([
        model('', ['c1', 'c2']),
        tool('c1', 'read', { path: 'skills/refunds/SKILL.md' }, '# Refunds'),
        { kind: 'skill', slug: 'refunds', via: 'tool' },
        failing,
      ]),
    );
    expect(callOf(step).skill).toBe('refunds');
    expect(callLine(callOf(step)).action).toBe('Loaded the skill');
    expect(callLine(callOf(step, 1))).toMatchObject({ failed: true, meta: 'SyntaxError: boom' });
  });

  it('plays a refused request as one step', () => {
    const steps = playbackSteps({
      ...trace([{ kind: 'refusal', taskType: 'refund', reason: 'Refunds are off limits.' }]),
      stopReason: 'refused',
      finalText: "I can't help with refund requests.",
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.refusal).toEqual({ taskType: 'refund', reason: 'Refunds are off limits.' });
  });

  it('replays the steps before the checkpoint, then numbers the correction on from there', () => {
    const correction = trace([
      model('', ['d1']),
      tool('d1', 'append', { path: 'data/returns.csv', text: 'RET-9,4998\n' }, 'Added 1 row.'),
      model('ANSWER: {"refund_cents":4998}'),
    ]);
    const shown = correctionSteps(lesson({}), correction, ORIGINAL);
    expect(shown.map((item) => [item.step.number, item.actor, item.replayed])).toEqual([
      [1, 'student', true],
      [2, 'student', true],
      [3, 'mentor', false],
      [4, 'mentor', false],
    ]);
    // A full-task demonstration is all the mentor's, from step 1.
    const whole = correctionSteps(
      lesson({
        kind: 'full_task_demonstration',
        checkpoint: { turn: 1, replayedCalls: 0, fallback: 'full_task' },
      }),
      correction,
      ORIGINAL,
    );
    expect(whole.map((item) => [item.step.number, item.actor])).toEqual([
      [1, 'mentor'],
      [2, 'mentor'],
    ]);
  });

  it("keeps Spark's suspicion apart from its evidence", () => {
    expect(
      findingNotes({
        failureTurn: 3,
        cause: 'It wrote the list price.',
        evidence: [{ turn: 1, note: 'It read the policy.' }],
      }),
    ).toEqual([
      { number: 3, text: 'It wrote the list price.', suspected: true },
      { number: 1, text: 'It read the policy.', suspected: false },
    ]);
    expect(answerOf('Working it out.\nANSWER: {"refund_cents":4998}')).toBe(
      '{"refund_cents":4998}',
    );
  });
});

describe('evidence words', () => {
  it('say how an example was obtained', () => {
    expect(lessonOrigin(lesson({}))).toBe('Replayed from step 3');
    expect(lessonOrigin(lesson({ kind: 'full_task_demonstration' }))).toBe(
      'Full-task demonstration',
    );
    expect(lessonOrigin(lesson({ kind: 'practice' }))).toBe('Practice on a similar task');
  });

  it('say why training ended, as it happened', () => {
    const job = makeJob();
    expect(trainingEnd('wall_clock', job)).toBe('The time limit ran out');
    expect(trainingEnd('usd', job)).toBe("Spark's budget ran out");
    expect(trainingEnd('rounds', job)).toBe('Used all 12 rounds');
    expect(trainingEnd('nothing_to_try', job)).toBe('Spark had nothing it may change');
  });

  it('order measurements before, after, then the four configurations', () => {
    const measurement = (label: string) => ({ label }) as Measurement;
    const experiment = {
      measurements: ['H1/A1', 'candidate', 'H0/A0', 'incumbent'].map(measurement),
    } as Experiment;
    expect(orderedMeasurements(experiment).map(measurementLabel)).toEqual([
      'Before',
      'After',
      'Untouched',
      'Both',
    ]);
  });

  it('end an engine reason as a sentence', () => {
    expect(sentence('its adapter came from the stand-in')).toBe(
      'Its adapter came from the stand-in.',
    );
    expect(sentence('Stopped before this change was evaluated.')).toBe(
      'Stopped before this change was evaluated.',
    );
  });

  it('give a cost as precise as it needs to be, and a score in words', () => {
    expect(formatCost(0)).toBe('$0');
    expect(formatCost(0.0042)).toBe('$0.0042');
    expect(formatCost(0.00001)).toBe('<$0.0001');
    expect(formatCost(1.375)).toBe('$1.38');
    expect(passedOf({ pass: 57, total: 60 })).toBe('57 of 60 passed');
  });
});

describe('comparisons', () => {
  const report = {
    test: { score: { pass: 5, total: 6 } },
    cost: { mentorUsd: 0.12 },
  } as ReportCard;
  const progress = {
    dev: { baseline: { pass: 4, total: 9 }, current: { pass: 14, total: 18 } },
    spent: { computeUsd: 0, computeMinutes: 0 },
  } as MentoringProgress;
  const reference = (split: 'dev' | 'test'): ReferenceRecord => ({
    runId: 'run_1',
    split,
    harnessVersion: 2,
    model: 'muse-spark-1.3',
    configKey: 'reference/meta/none',
    status: 'finished',
    maxUsd: 0.5,
    spentUsd: 0.03,
    inputTokens: 100,
    outputTokens: 10,
    seed: 1,
    score: { pass: 9, total: 9 },
    perType: [],
    latencyMs: { p50: 1, p95: 2 },
    startedAt: AT,
  });

  it('show a setup-only agent beside the untouched student and Spark, the rest not run', () => {
    const arms = comparisonArms({
      run: makeRun({ devBaseline: { pass: 4, total: 9 } }),
      report,
      progress,
      experiments: [],
      references: [reference('dev')],
      bare: null,
      figures: null,
    });
    expect(arms.map((arm) => [arm.key, wasRun(arm), arm.current])).toEqual([
      ['untouched', true, false],
      ['setup', true, true],
      ['weights', false, false],
      ['both', false, false],
      ['mentor', true, false],
    ]);
    const [untouched, setup, , , mentor] = arms;
    expect(untouched?.check).toEqual({ pass: 4, total: 9 });
    expect(untouched?.final).toBeNull();
    expect(setup).toMatchObject({ check: { pass: 14, total: 18 }, final: { pass: 5, total: 6 } });
    // Spark took the check tasks only: nothing is shown for a final test it never took.
    expect(mentor).toMatchObject({ check: { pass: 9, total: 9 }, final: null });
  });

  it('say why a comparison with no record was not run', () => {
    expect(ARM_ORDER.map((key) => [key, notRunReason(key, 'Spark')])).toEqual([
      ['untouched', 'nothing was measured before training'],
      ['setup', null],
      ['weights', 'no round measured trained weights'],
      ['both', 'no round measured trained weights'],
      ['mentor', "Spark wasn't measured on these tasks"],
    ]);
  });

  it('take all four configurations from a round that measured trained weights', () => {
    const scored = (label: string, pass: number): Measurement => ({
      label,
      configuration: { harnessVersion: 1, actor: 'student', backend: 'llama.cpp', adapter: null },
      seeds: [1],
      score: { pass, total: 9 },
      perType: [],
      latencyMs: { p50: 1, p95: 1 },
      provenance: 'measured for this experiment',
    });
    const weights = {
      kind: 'weights',
      measurements: [
        scored('H0/A0', 3),
        scored('H1/A0', 6),
        scored('H0/A1', 5),
        scored('H1/A1', 8),
      ],
      budget: { mentorUsd: 0.4, computeUsd: 1.8, computeMinutes: 60 },
    } as Experiment;
    const adapter = {
      id: 'job_1',
      path: 'a.gguf',
      sha256: 'a'.repeat(64),
      standIn: false,
      label: 'Hub',
    };
    const arms = comparisonArms({
      run: makeRun({ currentAdapter: adapter }),
      report,
      progress,
      experiments: [weights],
      references: [],
      bare: null,
      figures: null,
    });
    expect(arms.map((arm) => [arm.key, arm.check?.pass ?? null, arm.current])).toEqual([
      ['untouched', 3, false],
      ['setup', 6, false],
      ['weights', 5, false],
      ['both', 14, true],
      ['mentor', null, false],
    ]);
    expect(arms[2]?.budget).toEqual({
      mentorUsd: 0.4,
      onlineUsd: 0,
      computeUsd: 1.8,
      computeMinutes: 60,
    });
  });

  it("put a meter's figures beside the agent's own final test only", () => {
    const figures = { peakProcessBytes: 19e9, peakGpuBytes: 7e9, coldStartMs: 8_400 };
    const arms = comparisonArms({
      run: makeRun({}),
      report,
      progress,
      experiments: [],
      references: [],
      bare: null,
      figures,
    });
    expect(arms.map((arm) => [arm.key, arm.memory])).toEqual([
      ['untouched', null],
      ['setup', figures],
      ['weights', null],
      ['both', null],
      ['mentor', null],
    ]);
  });
});

describe("a runtime meter's figures", () => {
  const card = { testedOn: 'local' } as ReportCard;
  const reading = (overrides: Partial<RuntimeMeasurement>): RuntimeMeasurement => ({
    id: 'msr_1',
    runId: 'run_1',
    split: 'test',
    target: 'local',
    config: 'student',
    harnessVersion: 2,
    seeds: [101],
    backend: 'ollama',
    peakProcessBytes: null,
    peakGpuBytes: null,
    coldStartMs: null,
    samples: 4,
    sampler: 'a test',
    startedAt: AT,
    endedAt: AT,
    ...overrides,
  });

  it("take the most any stretch of the card's own test saw, and its first cold start", () => {
    expect(
      runtimeFigures(
        [
          reading({ peakProcessBytes: 18e9, coldStartMs: 9_000 }),
          reading({ id: 'msr_2', peakProcessBytes: 19e9, peakGpuBytes: 7e9, coldStartMs: 4_000 }),
          // Another endpoint's test, or a check-task run, is not this card's.
          reading({ id: 'msr_3', target: 'hosted', peakProcessBytes: 30e9 }),
        ],
        card,
      ),
    ).toEqual({ peakProcessBytes: 19e9, peakGpuBytes: 7e9, coldStartMs: 9_000 });
  });

  it('are nothing where no meter read the test', () => {
    expect(runtimeFigures([], card)).toBeNull();
    expect(runtimeFigures([reading({})], card)).toBeNull();
  });
});

describe('a comparisons report', () => {
  const spent = (sparkUsd: number) => ({
    sparkUsd,
    sparkInputTokens: 0,
    sparkOutputTokens: 0,
    studentUsd: 1.2,
    studentInputTokens: 0,
    studentOutputTokens: 0,
    computeUsd: 0,
    computeMinutes: 0,
    computeSettled: true,
    examples: 0,
    trainedTokens: 0,
    studentAttempts: 0,
    sparkAttempts: 0,
    wallMinutes: 0,
  });
  const row = (
    arm: string,
    seed: number,
    pass: number,
    peakMemory: unknown = null,
    configuration: string | null = null,
  ) => ({
    arm,
    label: configuration === null ? arm : `${arm}, ${configuration}`,
    configuration,
    seed,
    scenarios: { pass, total: 60 },
    complete: true,
    peakMemory,
  });
  const report = {
    plan: { testSeeds: [101, 102] },
    arms: [
      { arm: 'bare', status: 'complete', reason: null, runId: 'run_bare', spent: spent(0) },
      { arm: 'targeted', status: 'complete', reason: null, runId: 'run_t', spent: spent(3) },
      { arm: 'reference', status: 'complete', reason: null, runId: 'run_r', spent: spent(2) },
      {
        arm: 'fixed',
        status: 'not_run',
        reason:
          "It needs $5.87 of the hosted student's budget, and $3.91 is left after the comparisons before it.",
        runId: null,
        spent: spent(0),
      },
    ],
    backends: [
      {
        backend: 'hosted',
        rows: [row('bare', 101, 24), row('targeted', 101, 51)],
        repeats: [
          {
            arm: 'targeted',
            label: 'targeted',
            complete: true,
            seeds: [
              { seed: 101, score: { pass: 51, total: 60 } },
              { seed: 102, score: { pass: 50, total: 60 } },
            ],
          },
        ],
      },
      {
        backend: 'reference',
        rows: [row('reference', 101, 57), row('reference-targeted', 101, 58)],
        repeats: [],
      },
      {
        backend: 'local-ollama',
        rows: [row('targeted', 101, 47, { processBytes: 19e9, gpuBytes: 7e9 })],
        repeats: [],
      },
    ],
  } as unknown as ComparisonReport;
  const names = { mentor: 'Spark', student: 'Glimmer' };

  it('reads each arm from its own rows, the other seed beside it, memory only where metered', () => {
    const [bare, targeted, reference] = reportArms(report, 'run_t', names);
    expect(bare).toMatchObject({
      label: 'Glimmer, untouched',
      current: false,
      hosted: { pass: 24, total: 60, repeat: null },
      local: null,
      memory: null,
    });
    expect(targeted).toMatchObject({
      label: 'Glimmer taught by Spark',
      current: true,
      hosted: { pass: 51, repeat: { seed: 102, pass: 50, total: 60, complete: true } },
      local: { pass: 47 },
      memory: { processBytes: 19e9, gpuBytes: 7e9 },
    });
    // Spark doing the tasks itself is read from its own table, and so is its second reference.
    expect(reference).toMatchObject({
      label: 'Spark doing the tasks itself, no setup',
      hosted: { pass: 57 },
    });
    const second = reportArms(
      {
        ...report,
        arms: [{ ...report.arms[2], arm: 'reference-targeted', runId: 'run_r2' }],
      } as unknown as ComparisonReport,
      'run_t',
      names,
    )[0];
    expect(second).toMatchObject({
      label: "Spark doing the tasks itself, with Glimmer's final setup",
      hosted: { pass: 58 },
      local: null,
    });
  });

  it('reads an adapter tested with and without it as one result, and marks a partial repeat', () => {
    const adapter = {
      ...report,
      arms: [{ ...report.arms[0], arm: 'weights-one-shot', runId: 'run_w' }],
      backends: [
        {
          backend: 'local-llama.cpp',
          rows: [
            row('weights-one-shot', 101, 52, null, 'H1/A0'),
            row('weights-one-shot', 101, 55, null, 'H1/A1'),
          ],
          repeats: [
            {
              arm: 'weights-one-shot',
              label: 'weights-one-shot, H1/A1',
              complete: false,
              seeds: [
                { seed: 101, score: { pass: 55, total: 60 } },
                { seed: 102, score: { pass: 30, total: 31 } },
              ],
            },
          ],
        },
      ],
    } as unknown as ComparisonReport;
    const [arm] = reportArms(adapter, 'run_w', names);
    expect(arm?.local).toMatchObject({
      pass: 55,
      without: { pass: 52, total: 60 },
      repeat: { seed: 102, pass: 30, total: 31, complete: false },
    });
  });

  it("says an arm that wasn't run wasn't, with the reason, and infers nothing for it", () => {
    const fixed = reportArms(report, 'run_t', names).find((arm) => arm.arm === 'fixed');
    expect(fixed).toMatchObject({
      status: 'not_run',
      reason:
        "It needs $5.87 of the hosted student's budget, and $3.91 is left after the comparisons before it.",
      hosted: null,
      local: null,
      memory: null,
    });
  });
});
