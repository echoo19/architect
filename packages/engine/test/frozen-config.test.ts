import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Decoding, Job, TrainedAdapter } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

async function setUp(job?: Partial<Job>) {
  world = await createWorld({ job });
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

/** Every locked-test attempt as the runtime saw it: its seed, student and decoding. */
function testsSeen(): { seed: number; student: string; decoding: Decoding | undefined }[] {
  const seen: { seed: number; student: string; decoding: Decoding | undefined }[] = [];
  world.runtime.beforeAttempt = (subject, ctx, options) => {
    if (!subject.id.startsWith('test-')) return;
    seen.push({ seed: options.seed, student: ctx.student.model, decoding: ctx.decoding });
  };
  return seen;
}

describe('the locked test', () => {
  it('runs each predeclared decoding seed, records each repeat, and counts scenarios once', async () => {
    const job = await setUp({
      evaluation: {
        trainBatch: 6,
        minDevGain: 2,
        maxTypeRegression: 1,
        patience: 3,
        devRepeats: 1,
        lockedTestSeeds: [101, 102],
      },
    });
    // Invoices pass under seed 101 only: a scenario that passes one repeat of two.
    world.runtime.passes = (subject, _harness, seed) =>
      subject.type === 'overdue' || (subject.type === 'invoice' && seed === 101);
    const seen = testsSeen();
    const run = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();

    const record = engine.store.runs.get(run.id);
    expect(record?.freeze?.testSeeds).toEqual([101, 102]);
    expect(seen.map((attempt) => attempt.seed).sort()).toEqual([
      ...Array<number>(6).fill(101),
      ...Array<number>(6).fill(102),
    ]);
    const attempts = engine.store.attempts.list({ runId: run.id, split: 'test' });
    expect(attempts).toHaveLength(12);
    const card = engine.store.reports.get(run.id, 'local');
    // Overdue passes both repeats; invoices pass one, so they don't count as passed scenarios.
    expect(card?.test.score).toEqual({ pass: 2, total: 6 });
    expect(card?.test.repeats).toEqual([
      { seed: 101, score: { pass: 4, total: 6 } },
      { seed: 102, score: { pass: 2, total: 6 } },
    ]);
    expect(card?.test.perType.find((type) => type.type === 'invoice')).toMatchObject({
      pass: 0,
      total: 2,
    });
  });

  it('keeps one repeat under the run seed for a job that declares none', async () => {
    const job = await setUp();
    const run = await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    const record = engine.store.runs.get(run.id);
    expect(record?.freeze?.testSeeds).toEqual([record?.seeds.test]);
    expect(engine.store.reports.get(run.id, 'local')?.test.repeats).toBeUndefined();
  });
});

describe('freezing a graduate that carries an adapter', () => {
  /** A kept adapter, as a weights round leaves it in the run: a GGUF file and its hash. */
  function keptAdapter(contents = 'GGUF fake adapter'): TrainedAdapter {
    const dir = join(world.dataDir, 'training', 'jobs', 'trn_kept', 'artifacts');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'adapter.gguf'), contents);
    return {
      id: 'trn_kept',
      path: 'training/jobs/trn_kept/artifacts/adapter.gguf',
      sha256: createHash('sha256').update(contents).digest('hex'),
      standIn: false,
      label: 'Hugging Face Jobs',
    };
  }

  async function startWithAdapter(): Promise<{ runId: string; adapter: TrainedAdapter }> {
    const job = await setUp();
    world.localDigest = `sha256:${'a'.repeat(64)}`;
    const adapter = keptAdapter();
    const run = await engine.controller.start(job.id, 'bare', 7);
    const record = engine.store.runs.get(run.id);
    if (!record) throw new Error('The run is missing.');
    engine.store.runs.update({ ...record, run: { ...record.run, currentAdapter: adapter } });
    return { runId: run.id, adapter };
  }

  it('records the adapter, its sha256, scale, backend and decoding, and tests exactly that', async () => {
    const { runId, adapter } = await startWithAdapter();
    const seen = testsSeen();
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);

    const frozen = engine.store.runs.get(runId)?.freeze;
    expect(frozen?.configuration).toMatchObject({
      backend: 'llama.cpp',
      adapter: {
        id: 'trn_kept',
        sha256: adapter.sha256,
        scale: 1,
        baseDigest: `sha256:${'a'.repeat(64)}`,
      },
    });
    expect(seen).toHaveLength(6);
    expect(seen.every((attempt) => attempt.student.endsWith('+trn_kept@1'))).toBe(true);
    expect(seen.every((attempt) => attempt.decoding?.maxSteps === 16)).toBe(true);
    const keys = new Set(
      engine.store.attempts.list({ runId, split: 'test' }).map((attempt) => attempt.config),
    );
    expect(keys).toEqual(new Set(['student/llama.cpp/trn_kept@1']));
    // The mentor was released before the vault opened, as for every locked test.
    expect(world.runtime.sequence[0]).toBe(`release:${runId}`);
  });

  it('refuses to test an adapter whose file changed after freezing', async () => {
    const { runId, adapter } = await startWithAdapter();
    // Change the file once the graduate is frozen, before its test opens.
    const stop = engine.controller.onEvent((event) => {
      if (event.type === 'log' && event.message.startsWith('Graduate frozen')) {
        stop();
        writeFileSync(join(world.dataDir, ...adapter.path.split('/')), 'something else');
      }
    });
    await engine.controller.idle();
    const record = engine.store.runs.get(runId);
    expect(record?.run.status).toBe('paused');
    expect(record?.run.error).toBe(
      "The adapter trn_kept changed after the graduate was frozen, so it won't be tested.",
    );
    expect(engine.store.attempts.list({ runId, split: 'test' })).toHaveLength(0);
  });
});
