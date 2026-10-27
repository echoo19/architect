import { existsSync } from 'node:fs';
import { AdapterError, type Job, type Task } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { STOPPED_ROUND } from '../src/loop/plan';
import { TRAINING_ENDED } from '../src/loop/run-state';
import { devSeeds, fanOutSeeds, roundSeed } from '../src/loop/seeds';
import { hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { FileVersions } from './fakes/harness';
import { defaultJob, defaultTasks, task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

const MINUTE = 60_000;
const REJECTION = 'system.md: cannot be deleted. Every harness needs a system prompt.';
let world: World;
let engine: Engine;

/** A reply whose change set the harness refuses: it deletes the system prompt. */
function dropThePrompt() {
  return {
    ...hypothesis('Drop the prompt', ''),
    edits: [{ op: 'delete' as const, path: 'system.md', content: '' }],
  };
}

async function setUp(options: { job?: Partial<Job>; tasks?: Task[] } = {}) {
  world = await createWorld(options);
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
      hypothesis('Add the overdue procedure', 'Service desk.\nfix:invoice\nfix:overdue'),
      hypothesis('Add the scheduling procedure', 'fix:invoice\nfix:overdue\nfix:scheduling'),
    ][call - 1];
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

/** Holds the matching attempt until released; resolves `reached` when it gets there. */
function holdAt(matches: (task: Task, version: number) => boolean) {
  const reached = deferred();
  const release = deferred();
  world.runtime.beforeAttempt = async (held, ctx) => {
    if (!matches(held, ctx.harness.meta.version)) return;
    world.runtime.beforeAttempt = undefined;
    reached.resolve();
    await release.promise;
  };
  return { reached: reached.promise, release: () => release.resolve() };
}

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

describe('pause and resume', () => {
  it('waits for the attempt in flight, and paused time is not counted', async () => {
    const job = await setUp();
    let devSeen = 0;
    const reached = deferred();
    const release = deferred();
    world.runtime.beforeAttempt = async (held) => {
      world.clock.advance(MINUTE);
      if (held.id.startsWith('dev-') && ++devSeen === 3) {
        reached.resolve();
        await release.promise;
      }
    };
    const run = await engine.controller.start(job.id, 'bare', 3);
    await reached.promise;

    let paused = false;
    const pausing = engine.controller.pause(run.id).then(() => (paused = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(paused).toBe(false);
    release.resolve();
    await pausing;

    expect(engine.store.runs.get(run.id)?.run.status).toBe('paused');
    expect(engine.store.attempts.list({ runId: run.id })).toHaveLength(3);
    world.clock.advance(30 * MINUTE);

    await engine.controller.resume(run.id);
    await engine.controller.idle();
    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished?.status).toBe('finished');
    expect(finished?.totals.wallMs).toBe(15 * MINUTE);
    expect(engine.store.reports.get(run.id, 'local')?.cost.wallMs).toBe(15 * MINUTE);
    expect(engine.errors).toEqual([]);
  });

  it('runs one at a time; the next run waits its turn', async () => {
    const job = await setUp();
    const first = await engine.controller.start(job.id, 'bare', 1);
    const second = await engine.controller.start(job.id, 'bare', 2);
    expect(engine.store.runs.get(second.id)?.run.status).toBe('queued');
    await engine.controller.idle();
    const firstDone = engine.events.findIndex(
      (e) => e.type === 'graduate.ready' && e.runId === first.id,
    );
    const secondStarts = engine.events.findIndex(
      (e) => e.type === 'attempt.started' && e.runId === second.id,
    );
    expect(firstDone).toBeGreaterThanOrEqual(0);
    expect(secondStarts).toBeGreaterThan(firstDone);
    expect(engine.store.runs.get(second.id)?.run.status).toBe('finished');
  });
});

describe('stop', () => {
  it('ends a run that kept nothing without a locked test', async () => {
    const job = await setUp();
    const hold = holdAt((held) => held.id.startsWith('train-'));
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    await engine.controller.stop(run.id);
    expect(engine.store.runs.get(run.id)?.run.status).toBe('stopping');
    hold.release();
    await engine.controller.idle();

    const stopped = engine.store.runs.get(run.id)?.run;
    expect(stopped).toMatchObject({ status: 'stopped', phase: 'done', stopReason: 'user' });
    expect(engine.store.rounds.get(run.id, 1)?.round).toMatchObject({
      status: 'failed',
      error: STOPPED_ROUND,
    });
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
    expect(engine.store.attempts.list({ runId: run.id, split: 'train' })).toHaveLength(1);
    expect(engine.store.reports.get(run.id, 'local')).toBeNull();
    expect(engine.store.graduates.forRun(run.id)).toBeNull();
    expect(world.mentor.requests).toHaveLength(0);
    expect(world.vault.opened).toEqual([]);
  });

  it('after a kept change, finishes the step, skips to the locked test and graduates', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 5, maxMentorUsd: 5, maxWallMinutes: 60 } },
    });
    const hold = holdAt((held, version) => held.id.startsWith('train-') && version === 2);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    await engine.controller.stop(run.id);
    hold.release();
    await engine.controller.idle();

    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished).toMatchObject({ status: 'finished', stopReason: 'user', currentVersion: 2 });
    expect(engine.store.rounds.get(run.id, 2)?.round.status).toBe('failed');
    expect(world.mentor.requests).toHaveLength(1);
    expect(engine.store.reports.get(run.id, 'local')?.test.score).toEqual({ pass: 2, total: 6 });
    expect(engine.store.runs.get(run.id)?.freeze?.harnessVersion).toBe(2);
  });

  it('ends a paused run at once when nothing was kept', async () => {
    const job = await setUp();
    const hold = holdAt((held) => held.id.startsWith('dev-'));
    const run = await engine.controller.start(job.id, 'architect', 7);
    await hold.reached;
    const pausing = engine.controller.pause(run.id);
    hold.release();
    await pausing;
    await engine.controller.stop(run.id);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'stopped',
      stopReason: 'user',
    });
    await engine.controller.idle();
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toEqual([]);
  });
});

describe('budgets during a run', () => {
  it('never starts a mentor call that could cross the dollar cap, and still tests', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 3, maxMentorUsd: 0.01, maxWallMinutes: 60 } },
    });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(world.mentor.requests).toHaveLength(0);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      stopReason: 'usd',
      currentVersion: 1,
    });
    expect(engine.store.rounds.get(run.id, 1)?.round.error).toMatch(
      /could cost up to .* left in the budget/,
    );
    expect(engine.store.reports.get(run.id, 'local')?.cost.mentorUsd).toBe(0);
  });

  it('cuts the attempt in flight when the wall clock runs out, unscored, and runs the test', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 3, maxMentorUsd: 5, maxWallMinutes: 5 } },
    });
    world.runtime.beforeAttempt = () => world.clock.advance(2 * MINUTE);
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const finished = engine.store.runs.get(run.id)?.run;
    expect(finished).toMatchObject({
      status: 'finished',
      stopReason: 'wall_clock',
      devBaseline: null,
    });
    const started = engine.events.filter((e) => e.type === 'attempt.started' && e.split === 'dev');
    expect(started).toHaveLength(3);
    expect(engine.store.attempts.list({ runId: run.id, split: 'dev' })).toHaveLength(2);
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
    expect(world.mentor.requests).toHaveLength(0);
    expect(engine.errors).toEqual([]);
  });

  it('stops when rounds in a row bring no kept change', async () => {
    const job = await setUp({
      job: {
        budget: { maxRounds: 10, maxMentorUsd: 5, maxWallMinutes: 60 },
        evaluation: { ...defaultJob().evaluation, patience: 2 },
      },
    });
    world.mentor.script = () => hypothesis('Reword the rules', 'Service desk, reworded.');
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run.stopReason).toBe('patience');
    expect(engine.store.rounds.list(run.id)).toHaveLength(2);
  });

  it('stops as soon as dev meets the target', async () => {
    const job = await setUp({ job: { requirements: { passRate: 0.3 } } });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      stopReason: 'target_met',
      devCurrent: { pass: 6, total: 18 },
    });
    expect(world.mentor.requests).toHaveLength(1);
  });
});

describe('dev noise', () => {
  it('measures the incumbent again, so a lucky score that got it kept is not the next bar', async () => {
    const job = await setUp();
    const lucky = roundSeed(fanOutSeeds(7).devPanel, 1);
    world.runtime.passes = (held, harness, seed) =>
      harness.system.includes(`fix:${held.type}`) ||
      (held.type === 'overdue' && harness.system.includes('lucky') && seed === lucky);
    world.mentor.script = (_request, call) =>
      [
        hypothesis('Add the invoice procedure', 'fix:invoice lucky'),
        hypothesis('Add the scheduling procedure', 'fix:invoice lucky fix:scheduling'),
      ][call - 1];
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(
      engine.store.rounds.list(run.id).map(({ round }) => [round.decision, round.decisionReason]),
    ).toEqual([
      [
        'kept',
        'Dev 0/9 → 6/9, measured again on new seeds: 0/18 → 9/18 over 2 runs, no type lost more than two',
      ],
      [
        'kept',
        'Dev 3/9 → 6/9, measured again on new seeds: 6/18 → 12/18 over 2 runs, no type lost more than two',
      ],
    ]);
  });

  it('measures a change that clears the limits again, and reverts a gain one draw made by luck', async () => {
    const job = await setUp();
    const panel = fanOutSeeds(7).devPanel;
    const [lucky, second] = devSeeds(panel, 1, 2);
    world.runtime.passes = (held, harness, seed) =>
      held.type === 'overdue' && harness.system.includes('fix:overdue') && seed === lucky;
    world.mentor.script = (_request, call) =>
      [
        hypothesis('Add the overdue procedure', 'Service desk.\nfix:overdue'),
        hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
      ][call - 1];
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const rounds = engine.store.rounds.list(run.id).map(({ round }) => round);
    expect(rounds[0]).toMatchObject({
      decision: 'reverted',
      decisionReason:
        'Dev 0/9 → 3/9, measured again on new seeds: 0/18 → 3/18 over 2 runs, short of the +4 margin',
      devBefore: { pass: 0, total: 18 },
      devAfter: { pass: 3, total: 18 },
      firstMeasurement: { devBefore: { pass: 0, total: 9 }, devAfter: { pass: 3, total: 9 } },
    });
    const roundOne = engine.store.attempts
      .list({ runId: run.id, split: 'dev' })
      .filter((attempt) => attempt.round === 1);
    expect(roundOne).toHaveLength(36);
    expect(new Set(roundOne.map((attempt) => attempt.seed))).toEqual(new Set([lucky, second]));
    // Round 2 had nothing to clear, so it measured once.
    expect(rounds[1]).toMatchObject({ decision: 'reverted', devAfter: { pass: 0, total: 9 } });
    expect(rounds[1]?.firstMeasurement).toBeUndefined();
    expect(world.mentor.requests[1]?.messages[0]?.content).toContain(
      'Round 1, reverted (dev +3; measured again, +3 over both): Add the overdue procedure.',
    );
  });

  it('runs every dev task under each repeat seed and keeps only gains past the scaled margin', async () => {
    const job = await setUp({
      job: { evaluation: { ...defaultJob().evaluation, devRepeats: 2 } },
    });
    const panel = fanOutSeeds(7).devPanel;
    const [lucky] = devSeeds(panel, 2, 2);
    world.runtime.passes = (held, harness, seed) =>
      harness.system.includes(`fix:${held.type}`) && (held.type !== 'overdue' || seed === lucky);
    world.mentor.script = (_request, call) =>
      [
        hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice'),
        hypothesis('Add the overdue procedure', 'Service desk.\nfix:invoice\nfix:overdue'),
      ][call - 1];
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const dev = engine.store.attempts.list({ runId: run.id, split: 'dev' });
    // Round 1 cleared the limits over its two runs, so it measured both versions over two more.
    expect(dev).toHaveLength(126);
    expect(new Set(dev.filter((a) => a.round === 1).map((a) => a.seed))).toEqual(
      new Set(devSeeds(panel, 1, 4)),
    );
    expect(new Set(dev.filter((a) => a.round === 2).map((a) => a.seed))).toEqual(
      new Set(devSeeds(panel, 2, 2)),
    );
    expect(
      engine.store.rounds.list(run.id).map(({ round }) => [round.decision, round.decisionReason]),
    ).toEqual([
      [
        'kept',
        'Dev 0/18 → 6/18 over 2 runs, measured again on new seeds: 0/36 → 12/36 over 4 runs, no type lost more than four',
      ],
      ['reverted', 'Dev 6/18 → 9/18 over 2 runs, short of the +4 margin'],
    ]);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      devBaseline: { pass: 0, total: 18 },
      devCurrent: { pass: 12, total: 36 },
    });
  });
});

describe('the split guard during a run', () => {
  it('ends training at a refused mentor payload, naming the part that matched', async () => {
    const leaky = task('test', 'invoice', 1).prompt;
    const tasks = defaultTasks().map((t) =>
      t.id === 'train-invoice-1' ? { ...t, prompt: `${t.prompt} Same as: ${leaky}` } : t,
    );
    const job = await setUp({
      tasks,
      job: { budget: { ...defaultJob().budget, maxRounds: 5 } },
    });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const refusal =
      'Refused a mentor call: its payload matched 1 locked test task, in train task train-invoice-1.';
    expect(world.mentor.requests).toHaveLength(0);
    expect(engine.store.rounds.list(run.id).map(({ round }) => round)).toMatchObject([
      { index: 1, status: 'failed', error: refusal },
    ]);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      stopReason: 'leak',
    });
    const logs = engine.events.flatMap((e) => (e.type === 'log' ? [e] : []));
    expect(logs).toContainEqual(expect.objectContaining({ level: 'error', message: refusal }));
    expect(logs.map((e) => e.message)).toContain(TRAINING_ENDED.leak);
    expect(logs.some((e) => e.message.includes(leaky))).toBe(false);
    expect(engine.events.some((e) => e.type === 'mentor.started')).toBe(false);
    expect(existsSync(engine.paths.mentorFile(job.id, run.id, 1))).toBe(false);
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
  });
});

describe('authoring failures', () => {
  it('charges an unusable reply the provider billed for, and goes on', async () => {
    const job = await setUp({ job: { budget: { ...defaultJob().budget, maxRounds: 1 } } });
    world.mentor.script = () => {
      throw Object.assign(
        new AdapterError(
          'bad_response',
          "The mentor's reply was not valid JSON, even after one correction.",
        ),
        { usage: { inputTokens: 4000, outputTokens: 1200 }, costUsd: 0.0101 },
      );
    };
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const record = engine.store.runs.get(run.id);
    expect(record?.run).toMatchObject({ status: 'finished', currentVersion: 1 });
    expect(record?.run.totals).toMatchObject({ mentorInputTokens: 4000, mentorOutputTokens: 1200 });
    expect(record?.run.totals.mentorUsd).toBeCloseTo(0.0101);
    expect(engine.store.costs.list(run.id).filter((cost) => cost.role === 'mentor')).toHaveLength(
      1,
    );
    const stored = engine.store.rounds.get(run.id, 1);
    expect(stored?.rejected).toBe(true);
    expect(stored?.round).toMatchObject({
      status: 'failed',
      error: expect.stringContaining('not valid JSON'),
    });
    expect(stored?.round.costUsd).toBeCloseTo(0.0101);
    expect(engine.events.some((e) => e.type === 'mentor.finished' && e.costUsd === 0.0101)).toBe(
      true,
    );
  });

  it('gives the author one fix for a change set the harness refuses, and adopts a fix that works', async () => {
    const job = await setUp({ job: { budget: { ...defaultJob().budget, maxRounds: 1 } } });
    world.mentor.script = (_request, call) =>
      call === 1
        ? dropThePrompt()
        : hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(world.mentor.requests).toHaveLength(2);
    const [asked, fix] = world.mentor.requests;
    expect(fix?.system).toBe(asked?.system);
    expect(fix?.messages.slice(0, -2)).toEqual(asked?.messages);
    expect(fix?.messages.at(-2)).toMatchObject({
      role: 'assistant',
      content: expect.stringContaining('Drop the prompt'),
    });
    expect(fix?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: expect.stringContaining(REJECTION),
    });
    const stored = engine.store.rounds.get(run.id, 1);
    expect(stored).toMatchObject({
      rejected: false,
      reply: { fix: 1 },
      round: { decision: 'kept', title: 'Add the invoice procedure' },
    });
    expect(
      engine.store.costs.list(run.id).filter((cost) => cost.role === 'mentor' && cost.round === 1),
    ).toHaveLength(2);
    expect(existsSync(engine.paths.mentorFile(job.id, run.id, 1))).toBe(true);
    expect(existsSync(engine.paths.mentorFile(job.id, run.id, 1, 1))).toBe(true);
    const logs = engine.events.flatMap((e) => (e.type === 'log' ? [e.message] : []));
    expect(logs).toContain(
      `Round 1: the runner couldn't use the reply, so the author gets one fix. ${REJECTION}`,
    );
  });

  it('rejects a change set whose fix does not validate either, shows the mentor why, and goes on', async () => {
    const job = await setUp();
    world.mentor.script = (_request, call) =>
      call <= 2
        ? dropThePrompt()
        : hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(engine.store.rounds.get(run.id, 1)).toMatchObject({
      rejected: true,
      round: {
        status: 'failed',
        title: 'Drop the prompt',
        files: ['system.md'],
        error: REJECTION,
      },
    });
    expect(engine.store.rounds.get(run.id, 1)?.reply?.fix).toBe(1);
    const second = world.mentor.requests[2]?.messages[0]?.content ?? '';
    expect(second).toContain(
      `- Round 1, rejected before dev saw it: Drop the prompt. Files: system.md. Why: ${REJECTION}`,
    );
    expect(second).not.toContain('None yet.');
    expect(engine.store.rounds.get(run.id, 2)?.round.decision).toBe('kept');
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      currentVersion: 2,
    });
  });

  it('ends training after two rejected rounds in a row, says why, and still tests', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 6, maxMentorUsd: 5, maxWallMinutes: 60 } },
    });
    world.mentor.script = () => dropThePrompt();
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    const rounds = engine.store.rounds.list(run.id);
    expect(rounds.map(({ round, rejected }) => [round.index, round.status, rejected])).toEqual([
      [1, 'failed', true],
      [2, 'failed', true],
    ]);
    expect(engine.store.runs.get(run.id)?.run).toMatchObject({
      status: 'finished',
      stopReason: 'rejected',
      currentVersion: 1,
    });
    const logs = engine.events.flatMap((e) => (e.type === 'log' ? [e.message] : []));
    expect(logs).toContain(`Round 2 was rejected before evaluation: ${REJECTION}`);
    expect(logs).toContain(TRAINING_ENDED.rejected);
    expect(engine.store.attempts.list({ runId: run.id, split: 'test' })).toHaveLength(6);
  });

  it('does not count a rejected round toward patience', async () => {
    const job = await setUp({
      job: {
        budget: { maxRounds: 6, maxMentorUsd: 5, maxWallMinutes: 60 },
        evaluation: { ...defaultJob().evaluation, patience: 1 },
      },
    });
    world.mentor.script = (_request, call) =>
      call <= 2 ? dropThePrompt() : hypothesis('Reword the rules', 'Service desk, reworded.');
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();

    expect(engine.store.rounds.list(run.id).map(({ round }) => round.decision)).toEqual([
      undefined,
      'reverted',
    ]);
    expect(engine.store.runs.get(run.id)?.run.stopReason).toBe('patience');
  });
});

describe('run setup', () => {
  it('evaluates against the job’s business date when it has one', async () => {
    const job = await setUp({ job: { businessDate: '2026-03-31' } });
    const seen = new Set<string>();
    world.runtime.beforeAttempt = (_task, ctx) => void seen.add(ctx.today);
    const run = await engine.controller.start(job.id, 'bare', 1);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.today).toBe('2026-03-31');
    expect(seen).toEqual(new Set(['2026-03-31']));
  });

  it('takes the date from the clock when the job has no business date', async () => {
    const job = await setUp();
    const run = await engine.controller.start(job.id, 'bare', 1);
    await engine.controller.idle();
    expect(engine.store.runs.get(run.id)?.today).toBe('2026-10-27');
  });

  it('starts from the template the job names', async () => {
    const job = await setUp({
      job: { startingHarness: { kind: 'template', template: 'ops-analyst' } },
    });
    const run = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    const versions = new FileVersions(engine.paths.harnessDir(job.id, run.id));
    expect((await versions.load(1)).system).toContain('Template: ops-analyst');
  });
});
