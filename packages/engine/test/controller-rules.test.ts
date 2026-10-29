import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyTotals, newId, type Job, type Run } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KeyedLock } from '../src/graduates/library';
import { RunController } from '../src/loop/controller';
import { writeJsonFile } from '../src/loop/files';
import { fanOutSeeds } from '../src/loop/seeds';
import { RetestSession } from '../src/loop/retest';
import type { StoredRun } from '../src/store/records';
import { draftingWorld, TEACHER, type DraftingWorld } from './support/drafting-world';
import { bikeShop, POLICY, type Bike } from './support/rule-data';
import { bikeDraft } from './support/rule-draft';

/*
 * A run on a job with a rule must not go on, whichever way it comes to be going again, when the
 * rule is not confirmed over the records as they are now. The first start is held to this already
 * (`drafting-rules`); these are the other ways a run goes: resumed, found again after a restart,
 * let go of its hold, or stopped with a final test still to take. None of them is allowed to reach
 * the student, which these tests never give a chance to: they only look at what is refused.
 */

let world: DraftingWorld;
let bike: Bike;
let controller: RunController;

beforeEach(() => {
  world = draftingWorld();
  bike = bikeShop({ offGrid: true });
  // A run that is let through would reach for the student on this computer: it is not to be asked.
  Object.assign(world.deps.adapters, {
    createStudent: () => {
      throw new Error('A run that should have been held reached for the student.');
    },
  });
  controller = new RunController({
    store: world.store,
    paths: world.paths,
    jobs: world.jobs,
    deps: world.deps,
    onError: () => undefined,
  });
});

afterEach(async () => {
  await controller.close();
  world.cleanup();
});

async function draftedJob(): Promise<Job> {
  world.mentor.script = () => bikeDraft();
  const turn = await world.drafting.start(
    'A repair desk for our bike shop',
    [
      world.attach('customers.csv', bike.customersCsv),
      world.attach('tickets.csv', bike.ticketsCsv),
      world.attach('policy.md', POLICY),
    ],
    TEACHER,
  );
  if (turn.draft === undefined) throw new Error(turn.message);
  return turn.draft;
}

async function confirm(job: Job): Promise<void> {
  const state = await world.jobs.ruleState(job.id);
  await world.jobs.confirmRules(job.id, state?.token ?? '');
}

/** A record of a run that was going when the app closed, or was paused, with its copy of the job. */
async function storedRun(
  job: Job,
  status: Run['status'],
  extra: Partial<Omit<StoredRun, 'run'>> = {},
): Promise<string> {
  const id = newId('run');
  const at = '2026-10-29T12:00:00.000Z';
  const record: StoredRun = {
    run: {
      id,
      jobId: job.id,
      method: 'architect',
      seed: 7,
      status,
      phase: 'attempting',
      createdAt: at,
      updatedAt: at,
      currentVersion: 1,
      devBaseline: null,
      devCurrent: null,
      totals: emptyTotals(),
    },
    seeds: fanOutSeeds(7),
    today: '2026-10-29',
    lockedTestOn: 'local',
    stopRequested: false,
    freeze: null,
    ...extra,
  };
  await writeJsonFile(world.paths.runJobFile(job.id, id), job);
  world.store.runs.insert(record);
  return id;
}

/** The records edited after the rule was confirmed. */
function edit(job: Job): void {
  writeFileSync(
    join(world.paths.dataDir(job.id), 'tickets.csv'),
    `${bike.ticketsCsv}T-9999,C-101,Open,1,2\n`,
  );
}

describe('a run that goes on without having been started again', () => {
  it('is not resumed on a rule nobody confirmed, or on records that changed since', async () => {
    const job = await draftedJob();
    const id = await storedRun(job, 'paused');
    await expect(controller.resume(id)).rejects.toMatchObject({ code: 'rule_unconfirmed' });
    expect(world.store.runs.get(id)?.run.status).toBe('paused');

    await confirm(job);
    edit(job);
    await expect(controller.resume(id)).rejects.toMatchObject({ code: 'rule_changed' });
    expect(world.store.runs.get(id)?.run.status).toBe('paused');
    expect(controller.studentBusy()).toBe(false);
  });

  it('is not found again after a restart to go on over changed records, and says why', async () => {
    const job = await draftedJob();
    await confirm(job);
    edit(job);
    const ids = [
      await storedRun(job, 'running'),
      await storedRun(job, 'queued'),
      await storedRun(job, 'testing'),
    ];
    controller.recover();
    await controller.idle();
    for (const id of ids) {
      const run = world.store.runs.get(id)?.run;
      expect(run?.status, id).toBe('paused');
      expect(run?.error, id).toContain('is not the file the tasks were made from');
    }
    expect(controller.studentBusy()).toBe(false);
  });

  it('is not found again over a rule that was never confirmed', async () => {
    const job = await draftedJob();
    const id = await storedRun(job, 'queued');
    controller.recover();
    await controller.idle();
    const run = world.store.runs.get(id)?.run;
    expect(run?.status).toBe('paused');
    expect(run?.error).toContain("isn't confirmed yet");
  });

  it('is not let go of its hold to take its final test over records that changed', async () => {
    const job = await draftedJob();
    await confirm(job);
    const id = await storedRun(job, 'paused', {
      protocol: { holdTest: true },
      freeze: {
        graduateId: 'grd_1',
        harnessVersion: 1,
        harnessHash: 'sha256-abc',
        student: { model: 'glimmer:test', digest: 'sha256:fake' },
        frozenAt: '2026-10-29T12:00:00.000Z',
      },
    });
    edit(job);
    controller.release(id);
    await controller.idle();
    const record = world.store.runs.get(id);
    expect(record?.protocol?.released).toBe(true);
    expect(record?.run.status).toBe('paused');
    expect(record?.run.error).toContain('is not the file the tasks were made from');
  });

  it('ends stopped, not stuck, when it was being stopped to take its final test over records that changed', async () => {
    const job = await draftedJob();
    await confirm(job);
    const id = await storedRun(job, 'queued', { stopRequested: true });
    edit(job);
    controller.recover();
    await controller.idle();
    const run = world.store.runs.get(id)?.run;
    expect(run?.status).toBe('stopped');
    expect(run?.phase).toBe('done');
    expect(run?.stopReason).toBe('user');
    expect(run?.error).toContain('is not the file the tasks were made from');
    expect(run?.endedAt).toBeDefined();
  });

  it('is told about by the same reason as a run that was started', async () => {
    const job = await draftedJob();
    const reasons: string[] = [];
    controller.onEvent((event) => {
      if (event.type === 'log') reasons.push(event.message);
    });
    const id = await storedRun(job, 'queued');
    controller.recover();
    await controller.idle();
    expect(reasons.join(' ')).toContain(`Paused. The rule for "${job.name}" isn't confirmed yet`);
    await expect(controller.start(job.id, 'architect')).rejects.toMatchObject({
      code: 'rule_unconfirmed',
    });
    expect(world.store.runs.get(id)?.run.status).toBe('paused');
  });
});

describe('work on a finished run that uses the job again', () => {
  it('is refused as a re-test, a repeat and a reference when the records changed', async () => {
    const job = await draftedJob();
    await confirm(job);
    const id = await storedRun(job, 'finished', {
      freeze: {
        graduateId: 'grd_1',
        harnessVersion: 1,
        harnessHash: 'sha256-abc',
        student: { model: 'glimmer:test', digest: 'sha256:fake' },
        frozenAt: '2026-10-29T12:00:00.000Z',
      },
    });
    edit(job);
    await expect(controller.retest(id, 'hosted')).rejects.toMatchObject({ code: 'rule_changed' });
    await expect(controller.repeat(id, 'local')).rejects.toMatchObject({ code: 'rule_changed' });
    await expect(controller.reference(id, 'dev', 1)).rejects.toMatchObject({
      code: 'rule_changed',
    });
    await expect(world.jobs.forWork(world.store.runs.get(id) as StoredRun)).rejects.toMatchObject({
      code: 'rule_changed',
    });
    expect(world.store.retests.get(id, 'hosted')).toBeNull();
  });

  it('pauses a re-test that was going when the app closed, rather than run it over changed records', async () => {
    const job = await draftedJob();
    await confirm(job);
    const id = await storedRun(job, 'finished');
    world.store.retests.insert({
      runId: id,
      target: 'hosted',
      status: 'testing',
      startedAt: '2026-10-29T12:00:00.000Z',
    });
    edit(job);
    const context = {
      runId: id,
      store: world.store,
      paths: world.paths,
      jobs: world.jobs,
      deps: world.deps,
      clock: world.clock,
      concurrency: 1,
      libraryLock: new KeyedLock(),
      emit: () => undefined,
    };
    await new RetestSession(context, 'hosted').run();
    const retest = world.store.retests.get(id, 'hosted');
    expect(retest?.status).toBe('paused');
    expect(retest?.error).toContain('is not the file the tasks were made from');
  });
});
