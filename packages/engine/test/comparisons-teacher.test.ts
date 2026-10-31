import { join } from 'node:path';
import {
  ExperimentArmSchema,
  MENTOR_PRESETS,
  type ExperimentInput,
  type MentorConfig,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  DEFAULT_MODELS,
  runComparison,
  type ComparisonConfig,
  type ComparisonRequest,
} from '../src/comparisons';
import { ComparisonFiles } from '../src/comparisons/records';
import { configOf } from '../src/experiments/service';
import { systemClock } from '../src/loop/deps';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore } from '../src/store/engine-store';
import { comparisonWorld, RETURNS_DESK, type ComparisonWorld } from './support/comparison-world';

/*
 * The teacher alone as an arm (decision 095): the teacher, or a chosen model, does the job itself
 * as the agent under test in a run of its own. Nothing of its run reaches a mentor, a lesson or
 * lineage, and its final test waits for every arm to freeze, as theirs do.
 */

const worlds: ComparisonWorld[] = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) await world.close();
});

const sol = MENTOR_PRESETS.find((preset) => preset.key === 'openai-gpt-6-1-sol');
if (sol === undefined) throw new Error('The GPT-6.1 Sol preset is missing.');

/** A teacher other than the field's: GPT-6.1 Sol, whose id no other part of the run names. */
const CHOSEN: Extract<MentorConfig, { kind: 'model' }> = {
  kind: 'model',
  provider: sol.provider,
  label: sol.label,
  baseUrl: sol.baseUrl,
  model: sol.model,
  reasoningEffort: 'medium',
  secretRef: sol.secretRef,
};

const CONFIG: ComparisonConfig = {
  ...DEFAULT_CONFIG,
  arms: ['bare', 'teacher'],
  caps: { studentUsd: 30, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
  concurrency: 4,
};

/**
 * A world whose secrets hold OpenAI's key too, counting every mentor made and every endpoint a
 * student was made for.
 */
function setUp(config: ComparisonConfig) {
  const world = comparisonWorld({ clock: systemClock });
  worlds.push(world);
  const { deps } = world.env;
  const mentors: MentorConfig[] = [];
  const students: string[] = [];
  const { createMentor, createStudent } = deps.adapters;
  deps.adapters.createMentor = (mentor, options) => {
    mentors.push(mentor);
    return createMentor(mentor, options);
  };
  deps.adapters.createStudent = (endpoint, options) => {
    students.push(endpoint.model);
    return createStudent(endpoint, options);
  };
  const secrets = deps.secrets;
  deps.secrets = {
    get: async (ref) => (ref === 'openai' ? 'dry-run-openai-key' : secrets.get(ref)),
  };
  const request: ComparisonRequest = {
    jobDir: RETURNS_DESK,
    out: world.out,
    config,
    models: DEFAULT_MODELS,
    confirm: true,
    planOnly: false,
  };
  return { world, request, mentors, students };
}

function readStore(world: ComparisonWorld) {
  return openEngineStore(new DataPaths(join(world.out, 'data')).database);
}

describe('the teacher alone as an arm', () => {
  it("runs the field's teacher as the agent in a run of its own, and makes no mentor", async () => {
    const { world, request, mentors, students } = setUp(CONFIG);
    const { outcome, report } = await runComparison(request, world.env);
    expect(outcome).toBe('finished');
    // No arm here teaches, and the teacher arm made no mentor: nothing it did could reach one.
    expect(mentors).toEqual([]);
    expect(world.mentor.requests).toEqual([]);
    expect(students).toContain('muse-spark-1.3');

    const store = readStore(world);
    try {
      const run = store.runs.list().find((item) => item.protocol?.arm === 'teacher');
      if (run === undefined) throw new Error('The teacher arm has no run.');
      expect(run.run.method).toBe('bare');
      // Its run writes no teaching record: no round, lesson, lineage entry or mentor cost.
      expect(store.rounds.list(run.run.id)).toEqual([]);
      expect(store.lessons.list({ runId: run.run.id })).toEqual([]);
      expect(store.experiments.list(run.run.id)).toEqual([]);
      expect(store.costs.list(run.run.id).filter((cost) => cost.role !== 'student')).toEqual([]);
      // Its final test waited for every arm to freeze.
      const released = new ComparisonFiles(world.out).readPlan()?.releasedAt;
      if (released === null || released === undefined) throw new Error('Nothing was released.');
      const tests = store.attempts
        .list({ runId: run.run.id })
        .filter((attempt) => attempt.split === 'test');
      expect(tests.length).toBeGreaterThan(0);
      expect(tests.every((attempt) => attempt.createdAt >= released)).toBe(true);
    } finally {
      store.close();
    }

    // Its rows sit with the teacher's references, named after it, at its price, hosted.
    const reference = report.backends.find((table) => table.backend === 'reference');
    const teacher = reference?.rows.find((row) => row.arm === 'teacher');
    expect(teacher).toMatchObject({
      label: 'Spark alone',
      model: 'Spark',
      runsOn: 'hosted',
      complete: true,
    });
    const bare = report.backends
      .find((table) => table.backend === 'hosted')
      ?.rows.find((row) => row.arm === 'bare');
    expect(bare).toMatchObject({ model: 'Glimmer', runsOn: 'hosted' });
    // Cost per 1,000 requests comes from the usage records: the teacher's price is the higher.
    expect(teacher?.perThousandUsd ?? 0).toBeGreaterThan(bare?.perThousandUsd ?? Infinity);
    expect(reference?.paired.map((pair) => pair.label)).toContain('Spark alone vs Glimmer alone');
    const arm = report.arms.find((item) => item.arm === 'teacher');
    expect(arm).toMatchObject({ status: 'complete', rounds: null, caps: { sparkUsd: 0 } });
    expect(arm?.spent.sparkUsd).toBe(0);
    expect(arm?.notes.join(' ')).toContain('never as a mentor');
    // Its projection prices its attempts at the teacher's rate, not the student's.
    const projected = report.projection?.arms.find((item) => item.arm === 'teacher');
    const projectedBare = report.projection?.arms.find((item) => item.arm === 'bare');
    expect(projected?.hostedAttempts).toBe(projectedBare?.hostedAttempts);
    expect(projected?.studentUsd ?? 0).toBeGreaterThan(projectedBare?.studentUsd ?? Infinity);
  }, 120_000);

  it("keeps a chosen teacher's run out of every mentor's context", async () => {
    const config: ComparisonConfig = {
      ...CONFIG,
      arms: ['bare', 'draft', 'targeted', 'teacher'],
      caps: { studentUsd: 40, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
      teacher: CHOSEN,
    };
    const { world, request, mentors, students } = setUp(config);
    const { outcome, report } = await runComparison(request, world.env);
    expect(outcome).toBe('finished');
    expect(students).toContain(CHOSEN.model);
    // The mentors made are the comparison's own, never the chosen teacher.
    expect(mentors.length).toBeGreaterThan(0);
    expect(
      mentors.every((mentor) => mentor.kind === 'model' && mentor.model !== CHOSEN.model),
    ).toBe(true);

    const store = readStore(world);
    try {
      const run = store.runs.list().find((item) => item.protocol?.arm === 'teacher');
      if (run === undefined) throw new Error('The teacher arm has no run.');
      const attempts = store.attempts.list({ runId: run.run.id });
      expect(attempts.length).toBeGreaterThan(0);
      const testTasks = new Set(
        store.runs
          .list()
          .flatMap((item) => store.attempts.list({ runId: item.run.id }))
          .filter((attempt) => attempt.split === 'test')
          .map((attempt) => attempt.taskId),
      );
      // Nothing the teacher did, and no final-test task, is in anything a mentor was sent.
      const sent = world.mentor.requests.map((item) => JSON.stringify(item));
      expect(sent.length).toBeGreaterThan(0);
      for (const text of sent) {
        expect(text).not.toContain(run.run.id);
        expect(text).not.toContain(CHOSEN.model);
        expect(text).not.toContain(CHOSEN.label);
        for (const attempt of attempts) expect(text).not.toContain(attempt.id);
        for (const task of testTasks) expect(text).not.toContain(`"${task}"`);
      }
      // Every other arm's mentoring ended before the teacher's final test began.
      const firstTest = attempts
        .filter((attempt) => attempt.split === 'test')
        .map((attempt) => attempt.createdAt)
        .sort()[0];
      const frozen = store.runs
        .list()
        .filter((item) => item.protocol?.arm !== 'teacher' && item.protocol?.arm !== undefined)
        .map((item) => item.freeze?.frozenAt ?? '');
      expect(firstTest).toBeDefined();
      expect(frozen.every((at) => at !== '' && at <= (firstTest ?? ''))).toBe(true);
    } finally {
      store.close();
    }
    const teacher = report.backends
      .find((table) => table.backend === 'reference')
      ?.rows.find((row) => row.arm === 'teacher');
    expect(teacher).toMatchObject({ label: 'GPT-6.1 Sol alone', model: 'GPT-6.1 Sol' });
  }, 180_000);

  it('is refused with the reason when the teacher speaks another protocol', async () => {
    const opus = MENTOR_PRESETS.find((preset) => preset.provider === 'anthropic');
    if (opus === undefined) throw new Error('There is no Anthropic preset.');
    const { world, request } = setUp({
      ...CONFIG,
      teacher: { kind: 'model', reasoningEffort: 'medium', ...opus },
    });
    const { report } = await runComparison({ ...request, planOnly: true }, world.env);
    const projected = report.projection?.arms.find((item) => item.arm === 'teacher');
    expect(projected).toMatchObject({ funded: false, blockedBy: 'prerequisite' });
    expect(projected?.reason).toContain("doesn't speak the OpenAI-compatible protocol");
  }, 60_000);
});

describe('the teacher arm in an experiment', () => {
  const { kind: _kind, reasoningEffort: _effort, ...model } = CHOSEN;

  it('takes a model of its own, which no other arm may', () => {
    expect(ExperimentArmSchema.safeParse({ arm: 'teacher', model }).success).toBe(true);
    expect(ExperimentArmSchema.safeParse({ arm: 'teacher' }).success).toBe(true);
    const other = ExperimentArmSchema.safeParse({ arm: 'bare', model });
    expect(other.error?.issues[0]?.message).toBe('Only the teacher arm takes a model of its own.');
  });

  it("hands the runner the chosen model, or the field's teacher when none is chosen", () => {
    const input: ExperimentInput = {
      name: 'Taught against the teacher',
      jobDir: RETURNS_DESK,
      arms: [{ arm: 'targeted' }, { arm: 'teacher', model }],
      seeds: { mentoring: 1, lockedTest: [101] },
      rounds: 2,
      caps: { studentUsd: 20, sparkUsd: 5, computeUsd: 0, wallMinutes: 600 },
    };
    expect(configOf(input).teacher).toEqual(CHOSEN);
    expect(configOf({ ...input, arms: [{ arm: 'teacher' }] }).teacher).toBeUndefined();
  });
});
