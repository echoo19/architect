import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TaskSchema,
  type ExperimentDetail,
  type ExperimentInput,
  type ExperimentRecord,
  type Job,
} from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { pinInputs } from '../src/comparisons/inputs';
import { stageLibraryJob } from '../src/experiments/library';
import { ExperimentService } from '../src/experiments/service';
import { createEngineDeps } from '../src/host/wiring';
import { systemClock } from '../src/loop/deps';
import { JobLibrary } from '../src/loop/jobs';
import { DataPaths } from '../src/loop/paths';
import { openEngineStore, type EngineStore } from '../src/store/engine-store';
import { comparisonWorld, type ComparisonWorld } from './support/comparison-world';
import { BRIEF, fieldJob, ORGANIZATIONS } from './support/field-comparison';

/*
 * An experiment on a field already in the library (decision 074, amended Oct 30): the runner
 * reads the stored job and tasks, and the sealed organizations from the library's vault, through
 * a job folder staged for as long as it is read. Planned, preregistered with its hypothesis and
 * primary comparison, run and read on fakes; nothing calls a model or spends.
 */

const worlds: ComparisonWorld[] = [];
const services: ExperimentService[] = [];
const stores: EngineStore[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const store of stores.splice(0)) store.close();
  for (const world of worlds.splice(0)) await world.close();
});

/** A comparison world, and the field job imported into an app library of its own. */
async function setUp() {
  const world = comparisonWorld({ clock: systemClock });
  worlds.push(world);
  const drafting = world.mentor.script;
  world.mentor.script = (request, call) =>
    request.json?.name === 'study_brief' ? BRIEF : drafting(request, call);
  const { dir } = fieldJob(world);
  const dataDir = join(world.root, 'library');
  mkdirSync(dataDir, { recursive: true });
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  stores.push(store);
  const deps = createEngineDeps({ dataDir, getSecret: async () => undefined });
  const jobs = new JobLibrary(store, paths, deps, systemClock);
  const job = await jobs.importFile(join(dir, 'job.json'));
  const library = { jobs, paths, vault: deps.vault };
  const service = new ExperimentService({
    dir: join(world.root, 'experiments'),
    clock: systemClock,
    environment: () => ({ env: world.env, close: async () => undefined }),
    library: (jobId, staged) => stageLibraryJob(library, jobId, staged),
    onError: (error) => {
      throw error;
    },
  });
  services.push(service);
  return { world, service, jobs, job, library, source: dir };
}

function inputFor(jobId: string, changes: Partial<ExperimentInput> = {}): ExperimentInput {
  return {
    name: 'Desks from the library',
    jobId,
    arms: [{ arm: 'bare' }, { arm: 'draft', sparkUsd: 0.8 }],
    seeds: { mentoring: 1, lockedTest: [101] },
    rounds: 1,
    caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 600 },
    ...changes,
  };
}

const HYPOTHESIS = {
  hypothesis:
    "Spark's one-shot draft passes more of the desks Glimmer never sees than Glimmer alone.",
  primaryComparison: { a: 'draft', b: 'bare', group: 'unseen' },
} as const;

function until(
  service: ExperimentService,
  id: () => string,
  done: (record: ExperimentRecord) => boolean,
): Promise<ExperimentRecord> {
  return new Promise((resolve) => {
    const stop = service.onEvent((event) => {
      if (event.experimentId !== id() || !done(event.experiment)) return;
      stop();
      resolve(event.experiment);
    });
  });
}

/** Folders a library field was staged in that are still there. */
const staged = (world: ComparisonWorld, id: string) =>
  readdirSync(join(world.root, 'experiments', id)).filter((name) => name.startsWith('source-'));

const SEALED = ORGANIZATIONS.filter((org) => org.role === 'transfer');

describe('an experiment on a field in the library', () => {
  it('plans, freezes the hypothesis with the pinned job, runs and keeps the sealed desks sealed', async () => {
    const { world, service, job, library, source } = await setUp();
    // The library keeps no sealed organization in the job, as decision 068 has it.
    expect((job.organizations ?? []).map((org) => org.id)).toEqual(['north', 'south']);

    const planned = await service.plan(inputFor(job.id));
    const { id } = planned.experiment;
    expect(planned.experiment.input).toMatchObject({ jobId: job.id });
    expect(planned.experiment.input.jobDir).toBeUndefined();
    expect(planned.experiment.job).toMatchObject({ id: job.id, splitsSeed: job.splits.seed });
    expect(planned.calibration).toMatchObject({ tasks: 12, studySparkUsdCap: 1 });
    expect(planned.groups).toEqual(['all', 'seen', 'unseen']);
    expect(staged(world, id)).toEqual([]);

    // No hypothesis, or a primary comparison of an arm it doesn't run, can't be preregistered.
    await expect(service.preregister(id)).rejects.toMatchObject({
      code: 'experiment_state',
      message: expect.stringContaining('hypothesis'),
    });
    await service.revise(
      id,
      inputFor(job.id, {
        ...HYPOTHESIS,
        primaryComparison: { a: 'targeted', b: 'bare', group: 'unseen' },
      }),
    );
    await expect(service.preregister(id)).rejects.toMatchObject({ code: 'experiment_state' });
    await service.revise(id, inputFor(job.id, HYPOTHESIS));

    const frozen = await service.preregister(id);
    const record = JSON.parse(
      readFileSync(join(world.root, 'experiments', id, 'preregistration.json'), 'utf8'),
    );
    expect(record.input).toMatchObject(HYPOTHESIS);
    // The pin is the job as the runner reads it: the library's job, tasks and files, and the
    // sealed desks' from the vault.
    const copy = join(world.root, 'copy');
    await stageLibraryJob(library, job.id, copy);
    const whole: Job = JSON.parse(readFileSync(join(copy, 'job.json'), 'utf8'));
    expect(frozen.preregistration?.pinned).toEqual(pinInputs(copy, whole));
    expect(frozen.preregistration?.pinned.jobId).toBe(job.id);
    expect(staged(world, id)).toEqual([]);

    // Before the release, nothing names a sealed desk.
    const seen: Promise<ExperimentDetail>[] = [];
    const stopSeeing = service.onEvent(() => seen.push(service.get(id)));
    const waiting = until(
      service,
      () => id,
      (item) => item.status === 'waiting',
    );
    await service.start(id, {});
    await waiting;
    const brief = await service.get(id);
    const ended = until(
      service,
      () => id,
      (item) => ['finished', 'incomplete', 'failed'].includes(item.status),
    );
    await service.resume(id, { studyToken: brief.study?.token ?? '' });
    expect(await ended).toMatchObject({ status: 'finished' });
    stopSeeing();
    const snapshots = await Promise.all(seen);
    expect(staged(world, id)).toEqual([]);
    for (const detail of snapshots.filter((item) => !item.released)) {
      const text = JSON.stringify(detail);
      for (const org of SEALED) expect(text).not.toContain(org.name);
    }

    // Spark never had a sealed desk or a locked-test task in any request (invariant 1).
    const sealedTasks = readFileSync(join(source, 'tasks.jsonl'), 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => TaskSchema.parse(JSON.parse(line)))
      .filter((task) => SEALED.some((org) => org.id === task.org));
    expect(sealedTasks.length).toBeGreaterThan(0);
    const asked = JSON.stringify(world.mentor.requests);
    for (const org of SEALED) {
      expect(asked).not.toContain(org.name);
      expect(asked).not.toContain(`"${org.id}"`);
    }
    for (const task of sealedTasks) expect(asked).not.toContain(task.prompt);

    // After the release the sealed desks are measured, from the vault's copy of them.
    const result = await service.get(id);
    expect(result.released).toBe(true);
    const hosted = result.report?.backends.find((table) => table.backend === 'hosted');
    for (const row of hosted?.rows ?? []) {
      expect(row.perOrg?.filter((org) => !org.seen).map((org) => org.orgName)).toEqual(
        expect.arrayContaining(SEALED.map((org) => org.name)),
      );
    }
  }, 300_000);

  it('refuses to run once the field changed in the library since it was preregistered', async () => {
    const { world, service, jobs, job } = await setUp();
    const { id } = (await service.plan(inputFor(job.id, HYPOTHESIS))).experiment;
    await service.preregister(id);
    await jobs.save({ ...job, summary: `${job.summary} Changed since.` });
    await expect(service.start(id, {})).rejects.toMatchObject({ code: 'experiment_frozen' });
    await expect(service.calibrate(id)).rejects.toMatchObject({ code: 'experiment_frozen' });
    expect(world.runtime.attempts).toHaveLength(0);
    expect(staged(world, id)).toEqual([]);
  });

  it('stages the same bytes every time, and the sealed part only from the vault', async () => {
    const { world, job, library } = await setUp();
    const first = join(world.root, 'first');
    const second = join(world.root, 'second');
    await stageLibraryJob(library, job.id, first);
    await stageLibraryJob(library, job.id, second);
    const whole: Job = JSON.parse(readFileSync(join(first, 'job.json'), 'utf8'));
    expect(pinInputs(first, whole)).toEqual(pinInputs(second, whole));
    // The staged job lists the sealed desks again, and holds their files and tasks.
    expect((whole.organizations ?? []).map((org) => org.id)).toEqual([
      'north',
      'south',
      'quayside',
      'hillcrest',
    ]);
    expect(readdirSync(join(first, 'orgs', 'quayside', 'data')).length).toBeGreaterThan(0);
    // The library's own folder still names no sealed desk.
    const kept = JSON.stringify(readdirSync(library.paths.jobDir(job.id), { recursive: true }));
    for (const org of SEALED) expect(kept).not.toContain(org.id);
  });
});
