import { join } from 'node:path';
import type { ExperimentDetail, ExperimentInput, ExperimentRecord } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { ExperimentService } from '../src/experiments/service';
import { systemClock, type Clock } from '../src/loop/deps';
import { ManualClock } from './fakes/clock';
import { comparisonWorld, RETURNS_DESK, type ComparisonWorld } from './support/comparison-world';
import { BRIEF, fieldJob, ORGANIZATIONS } from './support/field-comparison';

/*
 * Experiments from the app (decision 074): planned, preregistered, run, paused and read through
 * the comparisons runner, on fakes. Nothing calls a model or spends.
 */

const worlds: ComparisonWorld[] = [];
const services: ExperimentService[] = [];

afterEach(async () => {
  for (const service of services.splice(0)) await service.close();
  for (const world of worlds.splice(0)) await world.close();
});

function setUp(clock: Clock = systemClock) {
  const world = comparisonWorld({ clock: systemClock });
  worlds.push(world);
  const drafting = world.mentor.script;
  world.mentor.script = (request, call) =>
    request.json?.name === 'study_brief' ? BRIEF : drafting(request, call);
  const service = new ExperimentService({
    dir: join(world.root, 'experiments'),
    clock,
    environment: () => ({ env: world.env, close: async () => undefined }),
    onError: (error) => {
      throw error;
    },
  });
  services.push(service);
  return { world, service };
}

function inputFor(jobDir: string, changes: Partial<ExperimentInput> = {}): ExperimentInput {
  return {
    name: 'Desks',
    jobDir,
    arms: [{ arm: 'bare' }, { arm: 'draft', sparkUsd: 0.8 }],
    seeds: { mentoring: 1, lockedTest: [101, 102] },
    rounds: 2,
    caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 600 },
    ...changes,
  };
}

/** The next record of the experiment that `done` accepts, as its events say. */
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

const hostedPrice = (detail: ExperimentDetail) =>
  detail.projection.inputs.find((input) => input.name === 'Hosted attempt')?.source;

describe('experiments from the app', () => {
  it('plans, freezes, studies once, runs to the release and reads the results', async () => {
    const { world, service } = setUp();
    const { dir } = fieldJob(world);
    const sealed = ORGANIZATIONS.filter((org) => org.role === 'transfer').map((org) => org.name);

    // Planning spends nothing: every arm projected at assumed prices, calibration's cost shown.
    const planned = await service.plan(inputFor(dir));
    const { id } = planned.experiment;
    expect(planned.experiment.status).toBe('draft');
    expect(planned.projection.arms.map((arm) => arm.arm)).toEqual(['bare', 'draft']);
    expect(hostedPrice(planned)).toBe('assumed');
    expect(planned.calibration).toMatchObject({
      tasks: 12,
      studentUsdCap: 15,
      studySparkUsdCap: 1,
    });
    expect(planned.report).toBeNull();
    expect(world.runtime.attempts).toHaveLength(0);
    expect(world.mentor.requests).toHaveLength(0);

    expect((await service.revise(id, inputFor(dir, { rounds: 1 }))).experiment.input.rounds).toBe(
      1,
    );
    await expect(service.start(id, {})).rejects.toMatchObject({ code: 'experiment_state' });

    // Calibration prices an attempt and Spark studies the desks once; the brief waits.
    const calibrated = until(
      service,
      () => id,
      (record) => record.calibratedAt !== null,
    );
    await service.calibrate(id);
    expect((await calibrated).status).toBe('draft');
    const measured = await service.get(id);
    expect(hostedPrice(measured)).toBe('measured');
    expect(measured.study?.confirmed).toBe(false);

    // Preregistering freezes the plan: stored, hashed, timestamped, and then immutable.
    const frozen = await service.preregister(id);
    expect(frozen.preregistration?.sha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(service.revise(id, inputFor(dir))).rejects.toMatchObject({
      code: 'experiment_frozen',
    });
    await expect(service.preregister(id)).rejects.toMatchObject({ code: 'experiment_frozen' });

    // Without the brief's token nothing runs past the study.
    const waiting = until(
      service,
      () => id,
      (record) => record.status === 'waiting',
    );
    await service.start(id, {});
    expect((await waiting).reason).toContain("Spark's brief");

    const seen: Promise<ExperimentDetail>[] = [];
    service.onEvent(() => seen.push(service.get(id)));
    const ended = until(
      service,
      () => id,
      (record) => ['finished', 'incomplete', 'failed'].includes(record.status),
    );
    await service.resume(id, { studyToken: measured.study?.token ?? '' });
    expect(await ended).toMatchObject({ status: 'finished' });
    const snapshots = await Promise.all(seen);

    // Invariant 1: before the release nothing shows a locked result or names a sealed desk.
    const before = snapshots.filter((detail) => !detail.released);
    expect(before.some((detail) => detail.report !== null)).toBe(true);
    for (const detail of before) {
      expect(detail.report?.backends ?? []).toEqual([]);
      const text = JSON.stringify(detail);
      for (const name of sealed) expect(text).not.toContain(name);
    }

    const result = await service.get(id);
    expect(result.released).toBe(true);
    expect(world.mentor.requests.filter((r) => r.json?.name === 'study_brief')).toHaveLength(1);
    const hosted = result.report?.backends.find((table) => table.backend === 'hosted');
    expect(hosted?.rows.map((row) => row.arm)).toEqual(['bare', 'draft']);
    for (const row of hosted?.rows ?? []) {
      expect(row.perType.length).toBeGreaterThan(0);
      expect(row.perOrg?.filter((org) => !org.seen).map((org) => org.orgName)).toEqual(
        expect.arrayContaining(sealed),
      );
    }
    const pair = hosted?.paired.find((item) => item.a === 'draft' && item.b === 'bare');
    expect(pair?.difference.low).toBeLessThanOrEqual(pair?.difference.high ?? -1);

    // The caps held: the draft's own Spark cap, and the totals.
    const draft = result.report?.arms.find((arm) => arm.arm === 'draft');
    expect(draft?.caps.sparkUsd).toBe(0.8);
    expect(draft?.spent.sparkUsd).toBeLessThanOrEqual(0.8);
    expect(result.report?.totals.studentUsd ?? Infinity).toBeLessThanOrEqual(15);
    expect(result.report?.totals.sparkUsd ?? Infinity).toBeLessThanOrEqual(10);

    await expect(service.resume(id, {})).rejects.toMatchObject({ code: 'experiment_state' });
  }, 300_000);

  it('pauses where it is, releases nothing meanwhile, and goes on from there', async () => {
    const { world, service } = setUp();
    let id = '';
    let asked = false;
    const paused = until(
      service,
      () => id,
      (record) => record.status === 'paused',
    );
    // Once calibration is done and an arm is under way, the person pauses.
    service.onEvent((event) => {
      if (asked || event.experiment.status !== 'running' || world.runtime.attempts.length <= 15) {
        return;
      }
      asked = true;
      void service.pause(id);
    });
    id = (await service.plan(inputFor(RETURNS_DESK))).experiment.id;
    await service.preregister(id);
    await service.start(id, {});
    await paused;
    const held = await service.get(id);
    expect(held.released).toBe(false);
    expect(held.report?.arms.some((arm) => arm.runId !== null)).toBe(true);
    expect(held.report?.backends).toEqual([]);
    await expect(service.pause(id)).rejects.toMatchObject({ code: 'experiment_state' });

    const ended = until(
      service,
      () => id,
      (record) => ['finished', 'incomplete', 'failed'].includes(record.status),
    );
    await service.resume(id, {});
    expect(await ended).toMatchObject({ status: 'finished' });
    const result = await service.get(id);
    expect(result.report?.arms.map((arm) => [arm.arm, arm.status])).toEqual([
      ['bare', 'complete'],
      ['draft', 'complete'],
    ]);
  }, 300_000);

  it('stops for good when its wall clock is up', async () => {
    const clock = new ManualClock();
    const { service } = setUp(clock);
    const { id } = (
      await service.plan(
        inputFor(RETURNS_DESK, {
          caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 1 },
        }),
      )
    ).experiment;
    await service.preregister(id);
    const stopped = until(
      service,
      () => id,
      (record) => record.status === 'stopped',
    );
    await service.start(id, {});
    clock.advance(60_000);
    expect((await stopped).reason).toContain('wall clock');
    expect((await service.get(id)).released).toBe(false);
    await expect(service.resume(id, {})).rejects.toMatchObject({ code: 'experiment_state' });
  }, 300_000);
});
