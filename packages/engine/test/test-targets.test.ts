import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Job, Task } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { StoredRun } from '../src/store/records';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { defaultJob } from './fakes/job';
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

interface TestSeen {
  model: string;
  hash: string;
  version: number;
  seed: number;
}

/** Each locked-test attempt as the runtime saw it, in the order they ran. */
function testsSeen(): TestSeen[] {
  const seen: TestSeen[] = [];
  world.runtime.beforeAttempt = (task, ctx, options) => {
    if (!task.id.startsWith('test-')) return;
    const { hash, version } = ctx.harness.meta;
    seen.push({ model: ctx.student.model, hash, version, seed: options.seed });
  };
  return seen;
}

/** Holds the first matching attempt until released; resolves `reached` when it gets there. */
function holdAt(matches: (task: Task) => boolean) {
  const reached = deferred();
  const release = deferred();
  world.runtime.beforeAttempt = async (held) => {
    if (!matches(held)) return;
    world.runtime.beforeAttempt = undefined;
    reached.resolve();
    await release.promise;
  };
  return { reached: reached.promise, release: () => release.resolve() };
}

function stored(runId: string): StoredRun {
  const record = engine.store.runs.get(runId);
  if (!record) throw new Error(`Run ${runId} is missing.`);
  return record;
}

/** An architect run, with a kept change and a mentor, whose locked test ran on the hosted copy. */
async function finishedOnHosted(): Promise<StoredRun> {
  const job = await setUp();
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice', { readyClaim: true }),
      hypothesis('Swap in the overdue rules', 'Service desk.\nfix:overdue'),
    ][call - 1];
  const run = await engine.controller.start(job.id, 'architect', 7, { lockedTestOn: 'hosted' });
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  return stored(run.id);
}

function localTests(runId: string) {
  return engine.store.attempts.list({ runId, split: 'test', target: 'local' });
}

describe('where the locked test runs', () => {
  it('runs on the local student unless the run asks otherwise', async () => {
    const job = await setUp();
    const seen = testsSeen();
    const run = await engine.controller.start(job.id, 'bare', 3);
    await engine.controller.idle();

    expect(engine.store.runs.get(run.id)?.lockedTestOn).toBe('local');
    expect(seen.map(({ model }) => model)).toEqual(Array(6).fill('glimmer:test'));
    expect(engine.store.reports.get(run.id, 'local')).toMatchObject({
      testedOn: 'local',
      student: { model: 'glimmer:test', runtime: 'ollama', quantization: 'Q4_K_M' },
      test: { ranOffline: true },
    });
  });

  it('runs on the hosted copy when the run asks, and the card says it was not offline', async () => {
    const job = await setUp();
    const seen = testsSeen();
    const run = await engine.controller.start(job.id, 'bare', 3, { lockedTestOn: 'hosted' });
    await engine.controller.idle();

    expect(engine.store.runs.get(run.id)).toMatchObject({
      run: { status: 'finished' },
      lockedTestOn: 'hosted',
    });
    expect(seen.map(({ model }) => model)).toEqual(Array(6).fill('glimmer-hosted'));
    const attempts = engine.store.attempts.list({ runId: run.id });
    expect(attempts.filter((a) => a.split === 'test').map((a) => a.target)).toEqual(
      Array(6).fill('hosted'),
    );
    expect(attempts.filter((a) => a.split === 'dev').every((a) => a.target === 'local')).toBe(true);
    expect(engine.store.reports.targets(run.id)).toEqual(['hosted']);
    const card = engine.store.reports.get(run.id, 'hosted');
    expect(card).toMatchObject({ testedOn: 'hosted', test: { ranOffline: false } });
    expect(card?.student).toEqual({
      label: 'Glimmer',
      model: 'glimmer-hosted',
      runtime: 'openai_compatible',
    });
  });

  it('pauses before testing a local student that is no longer the frozen build', async () => {
    const job = await setUp();
    const swap = engine.controller.onEvent((event) => {
      if (event.type === 'log' && event.message.startsWith('Graduate frozen')) {
        world.localDigest = 'sha256:newer';
      }
    });
    const run = await engine.controller.start(job.id, 'bare', 3);
    await engine.controller.idle();
    swap();

    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'paused',
      phase: 'testing',
      error:
        "The local student isn't the model this graduate was frozen with: glimmer:test has digest sha256:newer instead of sha256:fake. A test on it wouldn't describe the graduate.",
    });
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
    expect(world.vault.opened).toEqual([]);

    world.localDigest = 'sha256:fake';
    await engine.controller.resume(run.id);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run.status).toBe('finished');
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
  });

  it('refuses a hosted locked test when the job has no hosted endpoint', async () => {
    const { label, local } = defaultJob().student;
    const job = await setUp({ student: { label, local, trainOn: 'local' } });
    await expect(
      engine.controller.start(job.id, 'bare', 3, { lockedTestOn: 'hosted' }),
    ).rejects.toThrow('"Service desk" has no hosted student endpoint.');
    expect(engine.store.runs.list(job.id)).toEqual([]);
  });
});

describe('re-testing a frozen graduate', () => {
  it('tests it on the local student with its frozen harness and pin, beside the hosted card', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    const frozen = record.freeze;
    if (!frozen) throw new Error('The run froze no graduate.');
    const graduate = engine.store.graduates.forRun(runId);
    const folder = join(engine.paths.fromStored(graduate?.path ?? ''), 'graduate.json');
    const written = readFileSync(folder, 'utf8');
    const lineageFile = engine.paths.lineageFile(record.run.jobId, runId);
    const lineage = readFileSync(lineageFile, 'utf8');
    const rounds = engine.store.rounds.list(runId);
    const dev = engine.store.attempts.list({ runId, split: 'dev' });
    const seen = testsSeen();
    const from = engine.events.length;

    await engine.controller.retest(runId, 'local');
    await engine.controller.idle();

    expect(engine.errors).toEqual([]);
    expect(frozen.student).toMatchObject({ model: 'glimmer:test', digest: 'sha256:fake' });
    expect(seen).toEqual(
      Array(6).fill({
        model: 'glimmer:test',
        hash: frozen.harnessHash,
        version: frozen.harnessVersion,
        seed: record.seeds.test,
      }),
    );
    expect(localTests(runId).map((a) => a.harnessVersion)).toEqual(Array(6).fill(2));
    expect(engine.store.reports.targets(runId)).toEqual(['hosted', 'local']);
    expect(engine.store.reports.get(runId, 'hosted')).toMatchObject({
      testedOn: 'hosted',
      test: { ranOffline: false, score: { pass: 2, total: 6 } },
    });
    expect(engine.store.reports.get(runId, 'local')).toMatchObject({
      testedOn: 'local',
      student: { model: 'glimmer:test', runtime: 'ollama', quantization: 'Q4_K_M' },
      test: { ranOffline: true, score: { pass: 2, total: 6 } },
      cost: { rounds: 2 },
      overclaim: true,
    });
    expect(engine.store.retests.get(runId, 'local')).toMatchObject({ status: 'finished' });

    expect(engine.store.runs.get(runId)).toEqual(record);
    expect(engine.store.graduates.forRun(runId)).toEqual(graduate);
    expect(readFileSync(folder, 'utf8')).toBe(written);
    expect(engine.store.rounds.list(runId)).toEqual(rounds);
    expect(readFileSync(lineageFile, 'utf8')).toBe(lineage);
    expect(engine.store.attempts.list({ runId, split: 'dev' })).toEqual(dev);

    const events = engine.events.slice(from);
    const touchesRun = ['run.updated', 'round.updated', 'budget', 'mentor.started'];
    expect(events.filter((e) => touchesRun.includes(e.type))).toEqual([]);
    const progress = events.flatMap((e) => (e.type === 'eval.progress' ? [e] : []));
    expect(progress.map((e) => [e.split, e.harnessVersion, e.done, e.total])).toEqual(
      [1, 2, 3, 4, 5, 6].map((done) => ['test', 2, done, 6]),
    );
    expect(events.at(-1)).toMatchObject({
      type: 'eval.finished',
      runId,
      split: 'test',
      harnessVersion: 2,
      score: { pass: 2, total: 6 },
    });
  });

  it('never makes a mentor: the vault opens on a release from a session that had none', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    expect(world.mentorsCreated).toBe(1);
    const requests = world.mentor.requests.length;
    const sequenceFrom = world.runtime.sequence.length;

    await engine.controller.retest(runId, 'local');
    await engine.controller.idle();

    expect(world.mentorsCreated).toBe(1);
    expect(world.mentor.requests).toHaveLength(requests);
    expect(world.runtime.releases.map(({ mentor }) => mentor)).toEqual([world.mentor, null]);
    expect(world.vault.opened).toEqual([record.run.jobId, record.run.jobId]);
    const sequence = world.runtime.sequence.slice(sequenceFrom);
    expect(sequence[0]).toBe(`release:${runId}`);
    expect(sequence.slice(1)).toHaveLength(6);
    expect(sequence.slice(1).every((entry) => entry.startsWith('test:'))).toBe(true);
  });

  it('leaves the test sealed when the mentor release fails', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    world.runtime.releaseMentor = async () => {
      throw new Error('The release could not be confirmed.');
    };

    await engine.controller.retest(runId, 'local');
    await engine.controller.idle();

    expect(world.vault.opened).toEqual([record.run.jobId]);
    expect(localTests(runId)).toEqual([]);
    expect(engine.store.retests.get(runId, 'local')).toMatchObject({
      status: 'paused',
      error: 'The release could not be confirmed.',
    });
    expect(engine.store.reports.targets(runId)).toEqual(['hosted']);
  });

  it('refuses a second re-test of a target, and one on the run’s own target', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    await engine.controller.retest(runId, 'local');
    await expect(engine.controller.retest(runId, 'local')).rejects.toThrow(
      "This run's graduate is already being re-tested on the local student.",
    );
    await engine.controller.idle();

    await expect(engine.controller.retest(runId, 'local')).rejects.toThrow(
      "This run's graduate was already re-tested on the local student.",
    );
    await expect(engine.controller.retest(runId, 'hosted')).rejects.toThrow(
      "This run's locked test already ran on the hosted student; a re-test runs on the other one.",
    );
    expect(localTests(runId)).toHaveLength(6);
    expect(engine.store.retests.get(runId, 'hosted')).toBeNull();
  });

  it('resumes a re-test interrupted mid-way, without attempting a task twice', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    let localSeen = 0;
    const crashed = deferred();
    world.runtime.beforeAttempt = (task, ctx) => {
      if (!task.id.startsWith('test-') || ctx.student.model !== 'glimmer:test') return;
      if (++localSeen !== 3) return;
      world.runtime.beforeAttempt = undefined;
      crashed.resolve();
      return new Promise<void>(() => {});
    };
    await engine.controller.retest(runId, 'local');
    await crashed.promise;
    // The process dies mid-attempt: nothing more reaches the disk, and the app starts again.
    engine.store.close();
    engine = openEngine(world);

    expect(engine.store.retests.get(runId, 'local')?.status).toBe('testing');
    expect(localTests(runId)).toHaveLength(2);
    const before = world.runtime.attempts.length;
    engine.controller.recover();
    await engine.controller.idle();

    const local = localTests(runId);
    expect(local).toHaveLength(6);
    expect(new Set(local.map((a) => a.taskId)).size).toBe(6);
    expect(world.runtime.attempts.slice(before)).toHaveLength(4);
    expect(engine.store.retests.get(runId, 'local')?.status).toBe('finished');
    expect(engine.store.reports.targets(runId)).toEqual(['hosted', 'local']);
    expect(engine.store.runs.get(runId)).toEqual(record);
    expect(world.mentorsCreated).toBe(1);
  });

  it('pauses on a local student that is no longer the frozen build, and resumes when asked again', async () => {
    const record = await finishedOnHosted();
    const runId = record.run.id;
    world.localDigest = 'sha256:newer';
    await engine.controller.retest(runId, 'local');
    await engine.controller.idle();

    expect(engine.store.retests.get(runId, 'local')).toMatchObject({
      status: 'paused',
      error: expect.stringContaining("isn't the model this graduate was frozen with"),
    });
    expect(localTests(runId)).toEqual([]);
    expect(engine.store.reports.targets(runId)).toEqual(['hosted']);
    expect(engine.events).toContainEqual(
      expect.objectContaining({
        type: 'log',
        level: 'error',
        message: expect.stringContaining('The re-test on the local student paused after an error'),
      }),
    );

    world.localDigest = 'sha256:fake';
    await engine.controller.retest(runId, 'local');
    await engine.controller.idle();
    const retest = engine.store.retests.get(runId, 'local');
    expect(retest?.status).toBe('finished');
    expect(retest?.error).toBeUndefined();
    expect(localTests(runId)).toHaveLength(6);
    expect(engine.store.runs.get(runId)).toEqual(record);
  });

  it('tests a locally tested graduate on the hosted copy, which never runs offline', async () => {
    const job = await setUp();
    const run = await engine.controller.start(job.id, 'bare', 3);
    await engine.controller.idle();
    const record = stored(run.id);

    await engine.controller.retest(run.id, 'hosted');
    await engine.controller.idle();

    expect(engine.store.reports.targets(run.id)).toEqual(['local', 'hosted']);
    expect(engine.store.reports.get(run.id, 'hosted')).toMatchObject({
      testedOn: 'hosted',
      student: { model: 'glimmer-hosted', runtime: 'openai_compatible' },
      test: { ranOffline: false },
    });
    expect(engine.store.reports.get(run.id, 'hosted')?.student.quantization).toBeUndefined();
    expect(engine.store.runs.get(run.id)).toEqual(record);
  });

  it('waits its turn while another run holds the student', async () => {
    const first = await finishedOnHosted();
    const hold = holdAt((task) => task.id.startsWith('dev-'));
    const busy = await engine.controller.start(first.run.jobId, 'bare', 4);
    await hold.reached;

    const from = engine.events.length;
    await engine.controller.retest(first.run.id, 'local');
    expect(localTests(first.run.id)).toEqual([]);
    hold.release();
    await engine.controller.idle();

    const events = engine.events.slice(from);
    const done = events.findIndex((e) => e.type === 'graduate.ready' && e.runId === busy.id);
    const retested = events.findIndex(
      (e) => e.type === 'attempt.started' && e.runId === first.run.id && e.split === 'test',
    );
    expect(done).toBeGreaterThanOrEqual(0);
    expect(retested).toBeGreaterThan(done);
    expect(localTests(first.run.id)).toHaveLength(6);
  });

  it('refuses a run that has not finished, or ended without a graduate, and says why', async () => {
    const job = await setUp();
    const hold = holdAt((task) => task.id.startsWith('dev-'));
    const training = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    await expect(engine.controller.retest(training.id, 'hosted')).rejects.toThrow(
      "This run hasn't finished yet; only a finished run's frozen graduate can be re-tested.",
    );
    await engine.controller.stop(training.id);
    hold.release();
    await engine.controller.idle();

    expect(engine.store.runs.get(training.id)?.run.status).toBe('stopped');
    await expect(engine.controller.retest(training.id, 'hosted')).rejects.toThrow(
      'This run ended without a graduate, so there is nothing to re-test.',
    );
    await expect(engine.controller.retest('run_missing', 'local')).rejects.toThrow(
      'There is no run "run_missing".',
    );
    expect(engine.store.retests.get(training.id, 'hosted')).toBeNull();
  });

  it('refuses the hosted copy when the job has none', async () => {
    const { label, local } = defaultJob().student;
    const job = await setUp({ student: { label, local, trainOn: 'local' } });
    const run = await engine.controller.start(job.id, 'bare', 3);
    await engine.controller.idle();
    await expect(engine.controller.retest(run.id, 'hosted')).rejects.toThrow(
      '"Service desk" has no hosted student endpoint.',
    );
  });
});
