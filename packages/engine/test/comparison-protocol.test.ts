import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, StudentTarget } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { MeterReading, RuntimeMeter } from '../src/loop/deps';
import { isHeld } from '../src/loop/protocol';
import type { RunProtocol } from '../src/store/records';
import { diagnosis } from './fakes/adapters';
import { templateHarness } from './fakes/harness';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { withStandInTraining } from './support/training-world';

let world: World;
let engine: Engine;

const TWO_SEEDS: Partial<Job> = {
  evaluation: {
    trainBatch: 6,
    minDevGain: 2,
    maxTypeRegression: 1,
    patience: 3,
    devRepeats: 1,
    lockedTestSeeds: [101, 102],
  },
};

async function setUp(job?: Partial<Job>) {
  world = await createWorld({ job });
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

async function startBare(jobId: string, protocol: RunProtocol, lockedTestOn?: StudentTarget) {
  return engine.controller.start(jobId, 'bare', 7, {
    protocol,
    ...(lockedTestOn === undefined ? {} : { lockedTestOn }),
  });
}

describe('a locked test held until every arm is frozen', () => {
  it('freezes each run, reads nothing from the vault, and tests only what is released', async () => {
    const job = await setUp();
    const first = await startBare(job.id, { arm: 'bare', holdTest: true });
    const second = await startBare(job.id, { arm: 'draft', holdTest: true });
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    for (const run of [first, second]) {
      const record = engine.store.runs.get(run.id);
      expect(record?.freeze).not.toBeNull();
      expect(record?.run).toMatchObject({ status: 'paused', phase: 'testing' });
      expect(record && isHeld(record)).toBe(true);
      expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
    }
    // Frozen, and still no locked-test task has left the vault for anyone.
    expect(world.vault.opened).toEqual([]);
    expect(world.runtime.sequence.filter((step) => step.startsWith('test:'))).toEqual([]);

    // Resuming a held run parks it again: only a release lets its test run.
    await engine.controller.resume(first.id);
    await engine.controller.idle();
    expect(engine.store.attempts.list({ runId: first.id, split: 'test' })).toEqual([]);

    engine.controller.release(first.id);
    await engine.controller.idle();
    expect(engine.store.runs.get(first.id)?.run.status).toBe('finished');
    expect(engine.store.attempts.list({ runId: first.id, split: 'test' })).toHaveLength(6);
    expect(engine.store.runs.get(second.id)?.run.status).toBe('paused');
    expect(engine.store.attempts.list({ runId: second.id, split: 'test' })).toEqual([]);

    engine.controller.release(second.id);
    await engine.controller.idle();
    expect(engine.store.runs.get(second.id)?.run.status).toBe('finished');
  });

  it('takes its test straight after freezing when released before it froze', async () => {
    const job = await setUp();
    const run = await startBare(job.id, { holdTest: true });
    engine.controller.release(run.id);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run.status).toBe('finished');
  });
});

describe('repeats a protocol defers', () => {
  it('tests under the first declared seed, then repeats under the rest without changing the run', async () => {
    const job = await setUp(TWO_SEEDS);
    world.runtime.passes = (subject, _harness, seed) =>
      subject.type === 'overdue' || (subject.type === 'invoice' && seed === 101);
    const run = await startBare(job.id, { deferRepeats: true });
    await engine.controller.idle();

    const record = engine.store.runs.get(run.id);
    expect(record?.freeze?.testSeeds).toEqual([101, 102]);
    const firstSeed = engine.store.attempts.list({ runId: run.id, split: 'test' });
    expect(firstSeed.map((attempt) => attempt.seed)).toEqual(Array<number>(6).fill(101));
    const card = engine.store.reports.get(run.id, 'local');
    expect(card?.test.score).toEqual({ pass: 4, total: 6 });
    expect(card?.test.repeats).toBeUndefined();
    const totals = record?.run.totals;

    await expect(engine.controller.repeat(run.id, 'hosted')).rejects.toThrow(
      "hasn't taken its locked test on the hosted student yet",
    );
    await engine.controller.repeat(run.id, 'local');
    await engine.controller.idle();
    const repeated = engine.store.attempts
      .list({ runId: run.id, split: 'test' })
      .filter((attempt) => attempt.seed === 102);
    expect(repeated).toHaveLength(6);
    expect(repeated.filter((attempt) => attempt.check.pass)).toHaveLength(2);
    expect(engine.store.repeats.get(run.id, 'local')?.status).toBe('finished');
    // The run, its totals and its card are as they were.
    expect(engine.store.runs.get(run.id)?.run.totals).toEqual(totals);
    expect(engine.store.reports.get(run.id, 'local')).toEqual(card);
    await expect(engine.controller.repeat(run.id, 'local')).rejects.toThrow('already repeated');
  });

  it('refuses a repeat for a run that ran every seed at once', async () => {
    const job = await setUp(TWO_SEEDS);
    const run = await startBare(job.id, {});
    await engine.controller.idle();
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(12);
    await expect(engine.controller.repeat(run.id, 'local')).rejects.toThrow(
      'ran every declared seed at once',
    );
  });

  it('resumes a repeat after a restart without making its attempts again', async () => {
    const job = await setUp(TWO_SEEDS);
    const run = await startBare(job.id, { deferRepeats: true });
    await engine.controller.idle();
    // The app closes during the repeat's third attempt.
    let seen = 0;
    world.runtime.beforeAttempt = async (_task, _ctx, options) => {
      seen += 1;
      if (seen !== 3) return;
      await new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('Closed.')), {
          once: true,
        });
      });
    };
    await engine.controller.repeat(run.id, 'local');
    await new Promise((resolve) => setTimeout(resolve, 50));
    await engine.close();
    const before = world.runtime.attempts.filter((attempt) => attempt.seed === 102).length;
    expect(before).toBe(2);

    world.runtime.beforeAttempt = undefined;
    engine = openEngine(world);
    engine.controller.recover();
    await engine.controller.idle();
    const after = world.runtime.attempts.filter((attempt) => attempt.seed === 102);
    expect(after).toHaveLength(6);
    expect(engine.store.repeats.get(run.id, 'local')?.status).toBe('finished');
  });
});

describe('a fixed intervention', () => {
  it('offers only the fixed type, and refuses another with the reason', async () => {
    const job = await setUp();
    world.mentor.script = () =>
      diagnosis('Write a pricing helper', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { type: 'helper' },
      });
    const run = await engine.controller.start(job.id, 'architect', 7, {
      protocol: { arm: 'fixed', interventions: ['procedure'] },
    });
    await engine.controller.idle();
    expect(engine.store.interventions.get(run.id, 1)?.invalidReason).toBe(
      "A helper intervention isn't possible in this run: This run's comparison fixes the intervention to procedure, so the mentor doesn't choose it.",
    );
    const [request] = world.mentor.requests;
    expect(JSON.stringify(request)).toContain(
      "This run's comparison fixes the intervention to procedure",
    );
  });
});

describe('an adopted harness and a one-shot adapter', () => {
  it('measures one adapter on both harnesses and keeps nothing a stand-in trained', async () => {
    const job = await setUp({
      budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 60 },
    });
    withStandInTraining(world);
    // The adopted harness fixes every type, so dev meets the target before any training.
    const adopted = {
      ...templateHarness('Service desk', 'Selected.', 'selected'),
      system: 'Selected.\nfix:invoice\nfix:overdue\nfix:scheduling',
    };
    mkdirSync(join(world.dataDir, 'adopted'), { recursive: true });
    writeFileSync(join(world.dataDir, 'adopted', 'harness.json'), JSON.stringify(adopted));
    world.runtime.passes = (subject, harness, _seed, student) =>
      student.includes('@1') ? false : harness.system.includes(`fix:${subject.type}`);
    const run = await engine.controller.start(job.id, 'architect', 7, {
      protocol: { arm: 'weights-one-shot', adopt: 'adopted', oneShotAdapter: { perType: 1 } },
    });
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);
    // No mentor reply decided anything: the harness was adopted and the adapter was one-shot.
    expect(world.mentor.requests).toEqual([]);

    const [adoption, oneShot] = engine.store.experiments.list(run.id);
    expect(adoption).toMatchObject({ kind: 'draft', disposition: 'kept' });
    expect(adoption?.reason).toMatch(/the comparison's harness is adopted whatever it scores/);
    expect(oneShot?.kind).toBe('weights');
    // A stand-in adapter is never kept, one-shot or not.
    expect(oneShot?.disposition).toBe('rejected');
    expect(oneShot?.reason).toMatch(/a one-shot adapter is kept as measured/);
    const byLabel = Object.fromEntries(
      (oneShot?.measurements ?? []).map((item) => [item.label, item]),
    );
    expect(byLabel['H0/A0']?.configuration.harnessVersion).toBe(1);
    expect(byLabel['H1/A0']?.configuration.harnessVersion).toBe(2);
    expect(byLabel['H1/A0']?.score).toEqual({ pass: 9, total: 9 });
    expect(byLabel['H1/A1']?.score).toEqual({ pass: 0, total: 9 });

    const intervention = engine.store.interventions.get(run.id, 2);
    expect(intervention?.findings).toEqual([]);
    expect(intervention?.teaching?.items.map((item) => item.kind)).toEqual([
      'demonstration',
      'demonstration',
      'demonstration',
    ]);
    const types = new Set(
      (intervention?.teaching?.items ?? []).map((item) =>
        item.kind === 'demonstration' ? item.taskId.split('-')[1] : '',
      ),
    );
    expect(types).toEqual(new Set(['invoice', 'overdue', 'scheduling']));
    const lessons = engine.store.lessons.list({ runId: run.id, status: 'verified' });
    expect(lessons).toHaveLength(3);
    expect(
      lessons.every((lesson) => lesson.kind === 'practice' && lesson.categoryId === null),
    ).toBe(true);
    expect(oneShot?.budget.examples).toBe(3);
    const record = engine.store.runs.get(run.id);
    expect(record?.run.status).toBe('finished');
    expect(record?.run.stopReason).toBe('rounds');
  });
});

describe('the runtime meter', () => {
  it('records what it saw during a locked test on this computer, and nothing during dev', async () => {
    const job = await setUp();
    const started: { backend: string; target: StudentTarget }[] = [];
    const reading: MeterReading = {
      peakProcessBytes: 9_500_000_000,
      peakGpuBytes: 11_200_000_000,
      coldStartMs: 27_600,
      samples: 12,
      sampler: 'a test meter',
    };
    const meter: RuntimeMeter = {
      start: async ({ backend, target }) => {
        started.push({ backend, target });
        return target === 'local' ? { stop: async () => reading } : null;
      },
    };
    world.deps.meter = meter;
    const run = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    expect(started).toEqual([{ backend: 'ollama', target: 'local' }]);
    const [measured] = engine.store.runtimeMeasurements.list(run.id);
    expect(measured).toMatchObject({
      runId: run.id,
      split: 'test',
      target: 'local',
      config: 'student',
      backend: 'ollama',
      peakProcessBytes: 9_500_000_000,
      peakGpuBytes: 11_200_000_000,
      coldStartMs: 27_600,
      samples: 12,
      sampler: 'a test meter',
    });
    expect(measured?.seeds).toEqual(engine.store.runs.get(run.id)?.freeze?.testSeeds);
  });

  it('never stops a locked test when it fails to start: that stretch goes unmeasured', async () => {
    const job = await setUp();
    world.deps.meter = {
      start: async () => {
        throw new Error('nvidia-smi is not installed');
      },
    };
    const run = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run.status).toBe('finished');
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
    expect(engine.store.runtimeMeasurements.list(run.id)).toEqual([]);
    expect(
      engine.events.some(
        (event) =>
          event.type === 'log' &&
          event.message ===
            "The runtime meter couldn't start, so this stretch goes unmeasured: nvidia-smi is not installed",
      ),
    ).toBe(true);
  });
});
