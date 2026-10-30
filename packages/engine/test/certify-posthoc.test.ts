import { join } from 'node:path';
import type { CertifyRequest, Job, Task } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { JobStudy } from '../src/drafting/studying';
import {
  certificationView,
  discardCertification,
  freshTasks,
  planCertification,
  type CertifyContext,
  type Seen,
} from '../src/loop/posthoc';
import { hypothesis } from './fakes/adapters';
import { TYPES } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';
import { orgJob, orgTask, orgTasks, writeOrgJobFolder } from './support/organizations';

let world: World;
let engine: Engine;
let open = false;

afterEach(async () => {
  if (!open) return;
  open = false;
  await engine.close();
  world.cleanup();
});

const MINUTE = 60_000;

/** Four new dev tasks per taught organization and type: 24 the first run never saw. */
function newTasks(): Task[] {
  return ['north', 'south'].flatMap((org) =>
    TYPES.flatMap((type) => [5, 6, 7, 8].map((n) => orgTask('dev', org, type, n))),
  );
}

/** The same field again, with more tasks: everything the first job had, and new ones. */
async function importNewer(extra: Task[]): Promise<Job> {
  const file = await writeOrgJobFolder(
    join(world.root, 'newer'),
    orgJob({ name: 'Branches, more' }),
    [...orgTasks(), ...newTasks(), ...extra],
  );
  return engine.jobs.importFile(file);
}

/** A finished run of the branches job, and the version it made. */
async function trainedVersion() {
  world = await createWorld();
  engine = openEngine(world);
  open = true;
  const job = await engine.jobs.importFile(
    await writeOrgJobFolder(join(world.root, 'branches'), orgJob(), orgTasks()),
  );
  world.mentor.script = () => ({
    skills: job.taskTypes.map((type) => ({
      taskType: type.id,
      text: `Answer ${type.label} requests from the organization's own files.`,
      needs: [],
      steps: ["Read the organization's files for its facts."],
      quotes: [],
    })),
    connections: [],
    rules: [],
    differences: [],
    questions: [],
    outOfScope: [],
  });
  const study = new JobStudy({
    jobs: engine.jobs,
    paths: engine.paths,
    deps: world.deps,
    clock: world.clock,
  });
  await engine.jobs.confirmStudy(job.id, (await study.study(job.id)).token);
  world.mentor.script = () =>
    hypothesis('Read the records', 'Branches.\nfix:invoice fix:overdue fix:scheduling');
  // A new task at Hillcrest is always answered wrong, the same way each time.
  world.runtime.passes = (task, harness) =>
    !/^xfer-hillcrest-.*-3$/.test(task.id) && harness.system.includes(`fix:${task.type}`);
  const run = await engine.controller.start(job.id, 'architect', 7);
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  const record = engine.store.runs.get(run.id);
  expect(record?.run.status).toBe('finished');
  const graduateId = record?.run.graduateId ?? '';
  return { job, runId: run.id, graduateId };
}

function context(): CertifyContext {
  return {
    store: engine.store,
    paths: engine.paths,
    jobs: engine.jobs,
    deps: world.deps,
    clock: world.clock,
  };
}

function request(graduateId: string, jobId: string, change: Partial<CertifyRequest> = {}) {
  return {
    graduateId,
    version: 1,
    jobId,
    k: 3,
    epsilon: 0.6,
    delta: 0.2,
    size: 18,
    check: [],
    maxUsd: 0,
    maxMinutes: 600,
    ...change,
  } satisfies CertifyRequest;
}

/** The tasks a certification sealed, as the fake vault holds them. */
function sealedOf(jobId: string, id: string) {
  const sealed = world.vault.certifications.get(`${jobId}/${id}`);
  if (sealed === undefined) throw new Error('nothing sealed');
  return sealed.sets;
}

describe('certifying a version after the fact (decision 079)', () => {
  it('certifies a frozen version on tasks its run never saw, and leaves the run as it was', async () => {
    const { job, runId, graduateId } = await trainedVersion();
    const newer = await importNewer([
      orgTask('xfer', 'hillcrest', 'invoice', 3),
      orgTask('xfer', 'hillcrest', 'overdue', 3),
    ]);
    const before = {
      run: engine.store.runs.get(runId),
      tests: engine.store.attempts.list({ runId, split: 'test' }).length,
      report: engine.store.reports.get(runId, 'local'),
      version: engine.store.versions.get(graduateId, 1),
    };
    const planned = await planCertification(
      context(),
      request(graduateId, newer.id, { check: ['north', 'hillcrest'] }),
    );
    expect(planned.status).toBe('planned');
    expect(planned.plan.calibration).toBe(18);
    const north = planned.plan.checks.find((check) => check.org === 'north');
    expect(north).toMatchObject({ seen: true, orgName: 'North Branch' });
    expect(planned.plan.checks.find((check) => check.org === 'hillcrest')).toMatchObject({
      seen: false,
      tasks: 2,
    });
    expect(planned.plan.attempts).toBe(3 * (18 + (north?.tasks ?? 0) + 2));
    expect(planned.plan.usd).toBe(0);
    // Planning spends nothing.
    expect(
      world.runtime.attempts.filter((attempt) => attempt.taskId.startsWith('dev-north-invoice-5')),
    ).toEqual([]);

    const mentors = world.mentorsCreated;
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);
    const done = engine.store.certifications.get(planned.id);
    expect(done?.status).toBe('finished');
    expect(world.mentorsCreated).toBe(mentors);
    const certificate = done?.certificate;
    if (certificate?.issued !== true) throw new Error('not issued');
    expect(certificate).toMatchObject({ n: 18, k: 3, delta: 0.2, epsilon: 0.6 });
    expect(certificate.checks).toEqual([
      expect.objectContaining({ org: 'north', seen: true, held: true }),
      expect.objectContaining({
        org: 'hillcrest',
        seen: false,
        answered: 2,
        errors: 2,
        held: false,
      }),
    ]);
    // Taught organizations' tasks ran on the newer job's own files.
    const view = certificationView(engine.store, done ?? planned);
    expect(view.done).toBe(planned.plan.attempts);

    // The run, its locked test, its card and the version are as they were.
    expect(engine.store.runs.get(runId)).toEqual(before.run);
    expect(engine.store.attempts.list({ runId, split: 'test' })).toHaveLength(before.tests);
    expect(engine.store.reports.get(runId, 'local')).toEqual(before.report);
    expect(engine.store.versions.get(graduateId, 1)).toEqual(before.version);
    expect(job.id).not.toBe(newer.id);
  });

  it('runs taught organizations on the job’s own files and sealed ones from its vault', async () => {
    const { graduateId } = await trainedVersion();
    const newer = await importNewer([orgTask('xfer', 'hillcrest', 'invoice', 3)]);
    const folders = new Map<string, string>();
    world.runtime.beforeAttempt = (task, ctx) => {
      const org = task.org ?? '';
      folders.set(org, ctx.sealedData?.[org] ?? '');
    };
    const planned = await planCertification(
      context(),
      request(graduateId, newer.id, { check: ['Hillcrest Prep'] }),
    );
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    expect(folders.get('north')).toBe(join(engine.paths.jobDir(newer.id), 'orgs', 'north', 'data'));
    expect(folders.get('hillcrest')).toBe(`sealed:${newer.id}/hillcrest`);
  });

  it('leaves out every task and family the run saw or was tested on, near duplicates too', async () => {
    const { job, graduateId } = await trainedVersion();
    const testPrompt = orgTask('test', 'south', 'overdue', 1).prompt;
    const renamed = { ...orgTask('dev', 'north', 'invoice', 9), family: 'Train North Invoice 1' };
    const reworded = {
      ...orgTask('dev', 'south', 'overdue', 9),
      prompt: `  ${testPrompt.toUpperCase().replace(/:/g, ' ;')} `,
    };
    const sibling = { ...orgTask('dev', 'south', 'overdue', 10), family: reworded.family };
    const newer = await importNewer([renamed, reworded, sibling]);
    const planned = await planCertification(
      context(),
      request(graduateId, newer.id, { size: 24, check: [] }),
    );
    const { calibration } = sealedOf(job.id, planned.id);
    const ids = new Set(calibration.map((task) => task.id));
    expect(ids).toEqual(new Set(newTasks().map((task) => task.id)));
    for (const task of orgTasks()) expect(ids.has(task.id)).toBe(false);
    expect(ids.has(renamed.id)).toBe(false);
    expect(ids.has(reworded.id)).toBe(false);
    expect(ids.has(sibling.id)).toBe(false);
  });

  it('keeps a family whole and drops it for one seen member', () => {
    const seen: Seen = {
      ids: new Set(['a-1']),
      families: new Set(),
      prompts: new Set(),
    };
    const pool = [
      { ...orgTask('dev', 'north', 'invoice', 1), id: 'a-1', family: 'fam-a' },
      { ...orgTask('dev', 'north', 'invoice', 2), id: 'a-2', family: 'Fam A' },
      { ...orgTask('dev', 'north', 'invoice', 3), id: 'b-1', family: 'fam-b' },
    ];
    expect(freshTasks(pool, seen).map((task) => task.id)).toEqual(['b-1']);
  });

  it('refuses when fewer tasks than asked are new, saying how many', async () => {
    const { job, graduateId } = await trainedVersion();
    await expect(
      planCertification(context(), request(graduateId, job.id, { size: 1 })),
    ).rejects.toThrow(/Only 0 tasks .* are new to version 1/);
    const newer = await importNewer([]);
    await expect(
      planCertification(context(), request(graduateId, newer.id, { size: 25 })),
    ).rejects.toThrow(/Only 24 tasks .* Ask for 24 or fewer/);
    expect(engine.store.certifications.list(graduateId, 1)).toEqual([]);
    expect(world.vault.certifications.size).toBe(0);
  });

  it('refuses a check on an organization the run was already tested on', async () => {
    const { job, graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    await expect(
      planCertification(context(), request(graduateId, newer.id, { check: ['hillcrest'] })),
    ).rejects.toThrow(/already tested on Hillcrest Prep/);
    await expect(
      planCertification(context(), request(graduateId, newer.id, { check: ['nowhere'] })),
    ).rejects.toThrow(/has no organization "nowhere"/);
    expect(job.id).not.toBe(newer.id);
  });

  it('refuses a plan its projected cost or time would take past the caps', async () => {
    const { graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    await expect(
      planCertification(
        context(),
        request(graduateId, newer.id, { student: 'openrouter-glimmer', maxUsd: 0.01 }),
      ),
    ).rejects.toThrow(/would cost about \$\d+\.\d\d for 54 attempts, more than the \$0\.01 cap/);
    await expect(
      planCertification(context(), request(graduateId, newer.id, { maxMinutes: 60 })),
    ).rejects.toThrow(/about 135 minutes for 54 attempts, more than the 60-minute cap/);
    const hosted = await planCertification(
      context(),
      request(graduateId, newer.id, { student: 'openrouter-glimmer', maxUsd: 5 }),
    );
    expect(hosted.plan).toMatchObject({ target: 'hosted', attempts: 54 });
    expect(hosted.plan.usd).toBeGreaterThan(0);
  });

  it('halts at its time cap, and makes no attempt past it', async () => {
    const { graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    world.runtime.beforeAttempt = () => world.clock.advance(10 * MINUTE);
    const planned = await planCertification(
      context(),
      request(graduateId, newer.id, { maxMinutes: 140 }),
    );
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    const paused = engine.store.certifications.get(planned.id);
    expect(paused?.status).toBe('paused');
    expect(paused?.error).toMatch(/140-minute cap/);
    expect(certificationView(engine.store, paused ?? planned).done).toBe(14);
    expect(paused?.certificate).toBeUndefined();
  });

  it('resumes where an error paused it, attempting only what is left', async () => {
    const { graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    let calls = 0;
    world.runtime.beforeAttempt = () => {
      calls += 1;
      if (calls === 10) throw new Error('The local model stopped answering.');
    };
    const planned = await planCertification(context(), request(graduateId, newer.id));
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    expect(engine.store.certifications.get(planned.id)).toMatchObject({
      status: 'paused',
      error: expect.stringContaining('The local model stopped answering.'),
    });
    const before = world.runtime.attempts.length;
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    expect(engine.store.certifications.get(planned.id)?.status).toBe('finished');
    expect(world.runtime.attempts.length - before).toBe(54 - 9);
  });

  it('is evidence once finished: it never changes, restarts or is taken back', async () => {
    const { graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    const planned = await planCertification(context(), request(graduateId, newer.id));
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    const done = engine.store.certifications.get(planned.id);
    if (done === null) throw new Error('missing');
    expect(() => engine.store.certifications.update({ ...done, status: 'paused' })).toThrow(
      /never changes/,
    );
    expect(() => engine.controller.certify(planned.id)).toThrow(/has finished/);
    await expect(discardCertification(context(), planned.id)).rejects.toThrow(/never started/);
    expect(engine.store.certifications.get(planned.id)).toEqual(done);
    // The version keeps its state.
    expect(engine.store.versions.get(graduateId, 1)?.state).toBe('candidate');
  });

  it('replaces a plan that never started, and takes back its sealed tasks', async () => {
    const { job, graduateId } = await trainedVersion();
    const newer = await importNewer([]);
    const first = await planCertification(context(), request(graduateId, newer.id));
    const second = await planCertification(context(), request(graduateId, newer.id, { size: 12 }));
    expect(engine.store.certifications.list(graduateId, 1).map((item) => item.id)).toEqual([
      second.id,
    ]);
    expect(world.vault.certifications.has(`${job.id}/${first.id}`)).toBe(false);
    await discardCertification(context(), second.id);
    expect(engine.store.certifications.list(graduateId, 1)).toEqual([]);
    expect(world.vault.certifications.size).toBe(0);
  });

  it('keeps its tasks in the vault: none reaches an event, a trace or its record', async () => {
    const { job, runId, graduateId } = await trainedVersion();
    const newer = await importNewer([orgTask('xfer', 'hillcrest', 'invoice', 3)]);
    const planned = await planCertification(
      context(),
      request(graduateId, newer.id, { check: ['north', 'hillcrest'] }),
    );
    const from = engine.events.length;
    engine.controller.certify(planned.id);
    await engine.controller.idle();
    const sets = sealedOf(job.id, planned.id);
    const tasks = [...sets.calibration, ...Object.values(sets.checks).flat()];
    const streamed = JSON.stringify(engine.events.slice(from));
    const shown = JSON.stringify(
      certificationView(engine.store, engine.store.certifications.get(planned.id) ?? planned),
    );
    for (const task of tasks) {
      expect(streamed).not.toContain(task.id);
      expect(streamed).not.toContain(task.prompt);
      expect(shown).not.toContain(task.id);
      expect(shown).not.toContain(task.prompt);
    }
    const attempts = engine.store.attempts.list({ runId, split: 'certify', round: 1 });
    expect(attempts).toHaveLength(planned.plan.attempts);
    expect(attempts.every((attempt) => attempt.tracePath === null)).toBe(true);
    expect(attempts.every((attempt) => attempt.answerSummary === undefined)).toBe(true);
    expect(attempts.every((attempt) => /^[0-9a-f]{64}$/.test(attempt.answerKey ?? ''))).toBe(true);
    // The tasks open only on a release proof.
    expect(() =>
      world.vault.openCertification(job.id, planned.id, planned.inputs.sealedSha256, {}),
    ).toThrow(/only after the mentor is released/);
    expect(world.vault.opened).toContain(`${job.id}:certification:${planned.id}`);
  });
});
