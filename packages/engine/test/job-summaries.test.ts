import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hypothesis } from './fakes/adapters';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

beforeEach(async () => {
  world = await createWorld();
  world.mentor.script = () => hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
  engine = openEngine(world);
});

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

/** A job with the run of its agent and the baselines a comparison starts after it, all finished. */
async function jobWithBaselines() {
  const job = await engine.jobs.importFile(world.jobFile);
  const agent = await engine.controller.start(job.id, 'architect', 7);
  const bare = await engine.controller.start(job.id, 'bare', 7);
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  return { job, agent, bare };
}

describe("a job's newest run", () => {
  it("is the agent's own run, not a baseline that was started after it", async () => {
    const { job, agent, bare } = await jobWithBaselines();
    // The baseline really is the newest run of the job, the one the list used to name.
    expect(engine.store.runs.list(job.id)[0]?.run.id).toBe(bare.id);

    const [summary] = engine.jobs.summaries();
    expect(summary?.latestRun).toMatchObject({ id: agent.id, method: 'architect' });
  });

  it('is none while the job has only baselines', async () => {
    const job = await engine.jobs.importFile(world.jobFile);
    await engine.controller.start(job.id, 'bare', 7);
    await engine.controller.idle();
    const [summary] = engine.jobs.summaries();
    expect(summary).toMatchObject({ id: job.id });
    expect(summary?.latestRun).toBeUndefined();
  });

  it('is a later run of the agent over an earlier one, whatever came after the earlier one', async () => {
    const { job } = await jobWithBaselines();
    const again = await engine.controller.start(job.id, 'architect', 8);
    await engine.controller.start(job.id, 'bare', 8);
    await engine.controller.idle();
    const [summary] = engine.jobs.summaries();
    expect(summary?.latestRun?.id).toBe(again.id);
  });
});

describe('what a finished run says of its agent', () => {
  it('says its version waits to be accepted, then that it was', async () => {
    const { agent } = await jobWithBaselines();
    expect(engine.jobs.summaries()[0]?.latestRun).toMatchObject({
      id: agent.id,
      status: 'finished',
      accepted: false,
    });
    expect(engine.jobs.summaries()[0]?.latestRun?.improves).toBeUndefined();

    const made = engine.store.versions.forRun(agent.id);
    if (!made) throw new Error('The run made no version.');
    engine.store.versions.update({ ...made, state: 'accepted', acceptedAt: made.createdAt });
    expect(engine.jobs.summaries()[0]?.latestRun?.accepted).toBe(true);
  });

  it('says nothing of an agent that has been removed', async () => {
    const { agent } = await jobWithBaselines();
    const made = engine.store.versions.forRun(agent.id);
    if (!made) throw new Error('The run made no version.');
    engine.store.graduates.remove(made.graduateId);
    expect(engine.jobs.summaries()[0]?.latestRun).toMatchObject({
      id: agent.id,
      status: 'finished',
    });
    expect(engine.jobs.summaries()[0]?.latestRun?.accepted).toBeUndefined();
  });

  it('says nothing of a version before the run has made one', async () => {
    const job = await engine.jobs.importFile(world.jobFile);
    const run = await engine.controller.start(job.id, 'architect', 7);
    const [summary] = engine.jobs.summaries();
    expect(summary?.latestRun).toMatchObject({ id: run.id, status: 'queued' });
    expect(summary?.latestRun?.accepted).toBeUndefined();
    await engine.controller.idle();
  });

  it('marks an improvement, whose version belongs to an agent that already exists', async () => {
    const { job, agent } = await jobWithBaselines();
    const record = engine.store.runs.get(agent.id);
    const made = engine.store.versions.forRun(agent.id);
    if (!record || !made) throw new Error('The run is missing.');
    // An improvement is an Architect run on the same job that carries what it improves.
    const improvement = {
      ...record,
      run: { ...record.run, id: 'run_improve', createdAt: '2026-10-28T12:00:00.000Z' },
      improves: { graduateId: made.graduateId, version: made.version, corrections: ['cor_1'] },
    };
    engine.store.runs.insert(improvement);
    expect(engine.store.runs.list(job.id)[0]?.run.id).toBe('run_improve');
    expect(engine.jobs.summaries()[0]?.latestRun).toMatchObject({
      id: 'run_improve',
      improves: true,
    });
  });
});
