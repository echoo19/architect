import type { Job, MentorCompletionRequest, RunEvent } from '@architect/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { LineageLog } from '../src/loop/lineage';
import { OUT_OF_TIME_ROUND, planNextStep, type PlanInput } from '../src/loop/plan';
import { devSeeds, fanOutSeeds, probeSeeds } from '../src/loop/seeds';
import { parseProposals } from '../src/mentor/reply';
import { diagnosis, hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { defaultJob } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

/*
 * Propose, probe, compose (decision 108): the mentor proposes several changes, the runner
 * measures each on dev and on the round's practice tasks, the mentor composes one change from
 * what they did, and that change is kept or reverted by the same rule as any other.
 */

const MINUTE = 60_000;
const EVALUATION = defaultJob().evaluation;
const PROBING = { ...EVALUATION, roundMode: 'propose_probe_compose' as const };

let world: World;
let engine: Engine;

/** Three alternatives, each fixing one task type. */
function proposals() {
  return {
    proposals: [
      hypothesis('Add the invoice rule', 'Service desk.\nfix:invoice', {
        causeTaskIds: ['train-invoice-1', 'train-invoice-2'],
      }),
      hypothesis('Add the overdue rule', 'Service desk.\nfix:overdue'),
      hypothesis('Add the scheduling rule', 'Service desk.\nfix:scheduling'),
    ],
  };
}

const COMPOSED = 'Service desk.\nfix:invoice\nfix:overdue';

async function setUp(
  options: {
    job?: Partial<Job>;
    script?: (request: MentorCompletionRequest, call: number) => unknown;
  } = {},
) {
  world = await createWorld({
    job: {
      evaluation: PROBING,
      budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 },
      ...options.job,
    },
  });
  world.mentor.script =
    options.script ??
    ((request) =>
      request.json?.name === 'proposals'
        ? proposals()
        : diagnosis('Invoice and overdue rules together', { system: COMPOSED }));
  engine = openEngine(world);
  return engine.jobs.importFile(world.jobFile);
}

async function run(job: { id: string }) {
  const started = await engine.controller.start(job.id, 'architect', 7);
  await engine.controller.idle();
  expect(engine.errors).toEqual([]);
  const record = engine.store.runs.get(started.id);
  if (!record) throw new Error('The run vanished.');
  return record;
}

function lineageOf(record: { run: { id: string; jobId: string } }) {
  return new LineageLog(engine.paths.lineageFile(record.run.jobId, record.run.id)).read();
}

describe('a propose-probe-compose round', () => {
  afterEach(async () => {
    await engine.close();
    world.cleanup();
  });

  it('asks for the probes, measures each, composes one change and keeps it by the usual rule', async () => {
    const record = await run(await setUp());
    const { run: done } = record;
    expect(world.mentor.requests.map((request) => request.json?.name)).toEqual([
      'proposals',
      'diagnosis',
    ]);
    const [round] = engine.store.rounds.list(done.id).map((stored) => stored.round);
    expect(round).toMatchObject({
      status: 'decided',
      decision: 'kept',
      title: 'Invoice and overdue rules together',
      candidateVersion: 5,
      decisionReason:
        'Dev 0/9 → 6/9, measured again on new seeds: 0/18 → 12/18 over 2 runs, no type lost more than two',
    });
    expect(round?.probes).toEqual([
      expect.objectContaining({
        index: 1,
        title: 'Add the invoice rule',
        version: 2,
        devBefore: { pass: 0, total: 9 },
        devAfter: { pass: 3, total: 9 },
        train: { pass: 2, total: 6 },
      }),
      expect.objectContaining({ index: 2, version: 3, devAfter: { pass: 3, total: 9 } }),
      expect.objectContaining({ index: 3, version: 4, devAfter: { pass: 3, total: 9 } }),
    ]);
    expect(done).toMatchObject({ currentVersion: 5, devCurrent: { pass: 12, total: 18 } });
  });

  it('measures the probes under seeds of their own, apart from those the decision uses', async () => {
    const record = await run(await setUp());
    const seeds = fanOutSeeds(7);
    const own = probeSeeds(seeds.devPanel, 1, 1);
    const decision = devSeeds(seeds.devPanel, 1, 2);
    expect(own.some((seed) => decision.includes(seed))).toBe(false);
    const dev = engine.store.attempts.list({ runId: record.run.id, split: 'dev', round: 1 });
    const seedsOf = (version: number) => [
      ...new Set(dev.filter((a) => a.harnessVersion === version).map((a) => a.seed)),
    ];
    for (const version of [2, 3, 4]) expect(seedsOf(version)).toEqual(own);
    expect(seedsOf(5).sort()).toEqual([...decision].sort());
    expect(seedsOf(1).sort()).toEqual([...decision].sort());
    // Every probe takes the round's practice tasks too, under the round's train seed.
    const train = engine.store.attempts.list({ runId: record.run.id, split: 'train', round: 1 });
    expect(train.map((a) => a.harnessVersion).sort()).toEqual(
      [1, 2, 3, 4].flatMap((version) => Array<number>(6).fill(version)),
    );
    expect(new Set(train.map((a) => a.seed)).size).toBe(1);
  });

  it('logs every probe in lineage with its measured effect, beside the composed change', async () => {
    const record = await run(await setUp());
    const [entry] = await lineageOf(record);
    expect(entry).toMatchObject({
      round: 1,
      title: 'Invoice and overdue rules together',
      decision: 'kept',
      versionFrom: 1,
      versionTo: 5,
      measured: { devBefore: { pass: 0, total: 18 }, devAfter: { pass: 12, total: 18 } },
    });
    expect(entry?.probes?.map((probe) => [probe.title, probe.version, probe.devAfter])).toEqual([
      ['Add the invoice rule', 2, { pass: 3, total: 9 }],
      ['Add the overdue rule', 3, { pass: 3, total: 9 }],
      ['Add the scheduling rule', 4, { pass: 3, total: 9 }],
    ]);
    // Each probe and the composed change are versions of their own, all from the incumbent.
    const experiment = engine.store.experiments.list(record.run.id)[0];
    expect(
      experiment?.measurements.map((item) => [item.label, item.configuration.harnessVersion]),
    ).toEqual([
      ['incumbent', 1],
      ['candidate', 5],
      ['probe 1', 2],
      ['probe 2', 3],
      ['probe 3', 4],
    ]);
  });

  it('decides the composed change exactly as a one-change round decides the same change', async () => {
    const probed = await run(await setUp());
    const [composed] = engine.store.rounds.list(probed.run.id).map((stored) => stored.round);
    await engine.close();
    world.cleanup();

    const single = await run(
      await setUp({
        job: { evaluation: EVALUATION },
        script: () => diagnosis('Invoice and overdue rules together', { system: COMPOSED }),
      }),
    );
    expect(world.mentor.requests).toHaveLength(1);
    const [one] = engine.store.rounds.list(single.run.id).map((stored) => stored.round);
    expect(one?.probes).toBeUndefined();
    const decided = (round: typeof one) =>
      round && {
        decision: round.decision,
        decisionReason: round.decisionReason,
        devBefore: round.devBefore,
        devAfter: round.devAfter,
        firstMeasurement: round.firstMeasurement,
      };
    expect(decided(composed)).toEqual(decided(one));
  });

  it('reverts a composed change that falls short of the margin, and still logs its probes', async () => {
    const record = await run(
      await setUp({
        script: (request) =>
          request.json?.name === 'proposals'
            ? proposals()
            : diagnosis('Only restate the role', { system: 'Service desk, restated.' }),
      }),
    );
    const [round] = engine.store.rounds.list(record.run.id).map((stored) => stored.round);
    expect(round).toMatchObject({
      decision: 'reverted',
      decisionReason: 'Dev 0/9 → 0/9, no change',
    });
    expect(record.run.currentVersion).toBe(1);
    const [entry] = await lineageOf(record);
    expect(entry).toMatchObject({ decision: 'reverted', versionTo: 5 });
    expect(entry?.probes).toHaveLength(3);
  });

  it('counts the probes and the composed change as one measurement, which never starts over', async () => {
    await run(await setUp());
    const dev = engine.events.filter(
      (event): event is Extract<RunEvent, { type: 'eval.progress' }> =>
        event.type === 'eval.progress' && event.split === 'dev',
    );
    // The baseline's 9, then one count of 45: the incumbent, three probes and the composed change.
    const round = dev.filter((event) => event.total === 45);
    expect(round.map((event) => event.done)).toEqual(Array.from({ length: 45 }, (_, i) => i + 1));
    expect(new Set(round.map((event) => event.harnessVersion))).toEqual(new Set([1, 2, 3, 4, 5]));
  });

  it('counts every probe in the budget: one round, both mentor calls, every attempt', async () => {
    const record = await run(await setUp());
    expect(record.run.totals).toMatchObject({
      rounds: 1,
      // The baseline 9, practice 6, the incumbent and three probes on dev 36, their practice 18,
      // the composed change 9, both measured again 18, and the final test's 6.
      attempts: 102,
      mentorInputTokens: 4000,
      mentorOutputTokens: 1000,
    });
    const [experiment] = engine.store.experiments.list(record.run.id);
    expect(experiment?.budget).toMatchObject({ attempts: 87, mentorInputTokens: 4000 });
    expect(record.run.totals.mentorUsd).toBeCloseTo(2 * 0.004625, 9);
  });

  it('shows the mentor scores and practice verdicts only, never a dev or test task', async () => {
    const record = await run(await setUp());
    const compose = JSON.stringify(world.mentor.requests[1]);
    expect(compose).toContain('# Probes this round');
    expect(compose).toContain('Dev: 3/9 passed, against 0/9 for the current harness (+3).');
    expect(compose).toContain('train-invoice-1: current harness FAIL');
    for (const request of world.mentor.requests) {
      const text = JSON.stringify(request);
      expect(text).not.toMatch(/\b(dev|test)-(invoice|overdue|scheduling)-\d/);
      expect(text).not.toMatch(/\[(dev|test)\]/);
    }
    // The mentor is let go before the locked test, which starts only after training ended.
    const { sequence } = world.runtime;
    const firstTest = sequence.findIndex((entry) => entry.startsWith('test:'));
    expect(sequence.indexOf(`release:${record.run.id}`)).toBeLessThan(firstTest);
  });

  it('measures what a restart left over, and pays for no proposal twice', async () => {
    const job = await setUp();
    const reached = deferred();
    const release = deferred();
    let held = false;
    world.runtime.beforeAttempt = async (task, ctx) => {
      if (held || ctx.harness.meta.version !== 3 || !task.id.startsWith('dev-')) return;
      held = true;
      reached.resolve();
      await release.promise;
    };
    const started = await engine.controller.start(job.id, 'architect', 7);
    await reached.promise;
    const pausing = engine.controller.pause(started.id);
    release.resolve();
    await pausing;
    expect(engine.store.rounds.get(started.id, 1)?.round.status).toBe('probing');
    await engine.controller.resume(started.id);
    await engine.controller.idle();
    expect(world.mentor.requests.map((request) => request.json?.name)).toEqual([
      'proposals',
      'diagnosis',
    ]);
    expect(engine.store.rounds.get(started.id, 1)?.round.decision).toBe('kept');
    // The count goes on where it was after the restart, out of the same total.
    const counted = engine.events.flatMap((event) =>
      event.type === 'eval.progress' && event.split === 'dev' && event.total > 18 ? [event] : [],
    );
    expect(new Set(counted.map((event) => event.total))).toEqual(new Set([45]));
    const done = counted.map((event) => event.done);
    expect(done).toEqual([...done].sort((a, b) => a - b));
    expect(done.at(-1)).toBe(45);
  });

  it('composes a harness change only, even where a question is on the menu', async () => {
    const job = await setUp();
    await engine.controller.start(job.id, 'architect', 7, { interactive: true });
    await engine.controller.idle();
    expect(engine.errors).toEqual([]);
    const [propose, compose] = world.mentor.requests;
    expect(propose?.json?.name).toBe('proposals');
    const schema = compose?.json?.schema as unknown as {
      properties: { intervention: { properties: { type: { enum: string[] } } } };
    };
    expect(schema.properties.intervention.properties.type.enum).toEqual([
      'procedure',
      'retrieval',
      'helper',
    ]);
    expect(compose?.system).toContain(
      'clarification is off the menu this round: A change composed from probes changes the harness, as its probes did.',
    );
  });

  it('keeps each probe it measured, in lineage and its experiment, when a stop cuts the round', async () => {
    const job = await setUp();
    const reached = deferred();
    const release = deferred();
    let held = false;
    world.runtime.beforeAttempt = async (task, ctx) => {
      if (held || ctx.harness.meta.version !== 3 || !task.id.startsWith('dev-')) return;
      held = true;
      reached.resolve();
      await release.promise;
    };
    const started = await engine.controller.start(job.id, 'architect', 7);
    await reached.promise;
    const stopping = engine.controller.stop(started.id);
    release.resolve();
    await stopping;
    await engine.controller.idle();
    const record = engine.store.runs.get(started.id);
    if (!record) throw new Error('The run vanished.');
    expect(record.run).toMatchObject({ status: 'stopped', currentVersion: 1 });
    const [experiment] = engine.store.experiments.list(started.id);
    expect(experiment?.disposition).toBe('stopped');
    expect(experiment?.measurements.map((item) => item.label)).toEqual(['probe 1']);
    const [entry] = await lineageOf(record);
    expect(entry).toMatchObject({
      round: 1,
      title: 'Probes, with no change decided',
      decision: 'reverted',
      versionFrom: 1,
      versionTo: 1,
      measured: { delta: 0 },
    });
    expect(entry?.probes?.map((probe) => [probe.index, probe.devAfter])).toEqual([
      [1, { pass: 3, total: 9 }],
      [2, undefined],
      [3, undefined],
    ]);
    expect(engine.store.lineage.list(started.id).map((row) => row.round)).toEqual([1]);
  });

  it('logs the probes of a round whose composed change was refused twice', async () => {
    const record = await run(
      await setUp({
        script: (request) =>
          request.json?.name === 'proposals'
            ? proposals()
            : {
                ...diagnosis('Drop the prompt'),
                edits: [{ op: 'delete', path: 'AGENTS.md', content: '' }],
              },
      }),
    );
    expect(world.mentor.requests.map((request) => request.json?.name)).toEqual([
      'proposals',
      'diagnosis',
      'diagnosis',
    ]);
    expect(engine.store.rounds.get(record.run.id, 1)?.rejected).toBe(true);
    const [entry] = await lineageOf(record);
    expect(entry).toMatchObject({ decision: 'reverted', versionTo: 1 });
    expect(entry?.probes?.every((probe) => probe.devAfter !== undefined)).toBe(true);
  });

  it('asks for no fix once the time limit has run out during the call', async () => {
    const record = await run(
      await setUp({
        job: { budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 30 } },
        script: () => {
          world.clock.advance(31 * MINUTE);
          return { proposals: [hypothesis('Only one idea', 'Service desk.\nfix:invoice')] };
        },
      }),
    );
    expect(world.mentor.requests).toHaveLength(1);
    expect(engine.store.rounds.get(record.run.id, 1)?.round).toMatchObject({
      status: 'failed',
      error: OUT_OF_TIME_ROUND,
    });
    expect(record.run.stopReason).toBe('wall_clock');
  });

  it('saves no proposal twice when saving them fails part way and the run resumes', async () => {
    const job = await setUp();
    const { harness } = world.deps;
    const versionsOf = harness.versions;
    let saves = 0;
    // The third save, the second probe's after the starting version and the first probe's, fails.
    harness.versions = (dir) => {
      const store = versionsOf(dir);
      return new Proxy(store, {
        get(target, key) {
          if (key !== 'save') {
            const value: unknown = Reflect.get(target, key, target);
            return typeof value === 'function' ? value.bind(target) : value;
          }
          return async (...args: Parameters<typeof store.save>) => {
            saves += 1;
            if (saves === 3) throw new Error('The disk went away.');
            return target.save(...args);
          };
        },
      });
    };
    const started = await engine.controller.start(job.id, 'architect', 7);
    await engine.controller.idle();
    expect(engine.store.runs.get(started.id)?.run.status).toBe('paused');
    await engine.controller.resume(started.id);
    await engine.controller.idle();
    const round = engine.store.rounds.get(started.id, 1)?.round;
    expect(round?.probes?.map((probe) => probe.version)).toEqual([2, 3, 4]);
    expect(round).toMatchObject({ decision: 'kept', candidateVersion: 5 });
    expect(world.mentor.requests.map((request) => request.json?.name)).toEqual([
      'proposals',
      'diagnosis',
    ]);
  });

  it('refuses a probe that repeats another and measures the rest', async () => {
    const record = await run(
      await setUp({
        script: (request) => {
          if (request.json?.name !== 'proposals') {
            return diagnosis('Invoice rule', { system: 'Service desk.\nfix:invoice' });
          }
          const [first, second] = proposals().proposals;
          return { proposals: [first, second, first] };
        },
      }),
    );
    const [round] = engine.store.rounds.list(record.run.id).map((stored) => stored.round);
    expect(round?.probes?.[2]).toMatchObject({ refused: 'The same change set as probe 1.' });
    expect(round?.probes?.[2]?.version).toBeUndefined();
    const dev = engine.store.attempts.list({ runId: record.run.id, split: 'dev', round: 1 });
    expect(new Set(dev.map((attempt) => attempt.harnessVersion))).toEqual(new Set([1, 2, 3, 4]));
    expect(JSON.stringify(world.mentor.requests[1])).toContain(
      'Refused by the runner, so never measured: The same change set as probe 1.',
    );
  });

  it('gives an unusable list of proposals one fix, then rejects the round', async () => {
    const record = await run(
      await setUp({
        job: { budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 60 } },
        script: () => ({ proposals: [hypothesis('Only one idea', 'Service desk.\nfix:invoice')] }),
      }),
    );
    expect(world.mentor.requests).toHaveLength(2);
    const stored = engine.store.rounds.get(record.run.id, 1);
    expect(stored?.rejected).toBe(true);
    expect(stored?.round.error).toBe(
      'The reply held one proposal; 3 alternative changes were asked for.',
    );
  });

  it('abandons a round whose time runs out while it probes, keeping nothing but its record', async () => {
    const job = await setUp({
      job: { budget: { maxRounds: 1, maxMentorUsd: 5, maxWallMinutes: 30 } },
    });
    world.runtime.beforeAttempt = (_task, ctx) => {
      if (ctx.harness.meta.version >= 2) world.clock.advance(MINUTE);
    };
    const record = await run(job);
    const stored = engine.store.rounds.get(record.run.id, 1);
    expect(stored?.round.status).toBe('failed');
    expect(record.run).toMatchObject({ stopReason: 'wall_clock', currentVersion: 1 });
    expect(world.mentor.requests).toHaveLength(1);
    const [entry] = await lineageOf(record);
    expect(entry).toMatchObject({ decision: 'reverted', versionFrom: 1, versionTo: 1 });
    expect(entry?.probes?.filter((probe) => probe.devAfter !== undefined)).toHaveLength(3);
    expect(engine.store.experiments.list(record.run.id)[0]?.disposition).toBe('stopped');
  });
});

describe('the planner', () => {
  const input = (status: 'probing' | 'composing', stopRequested = false): PlanInput => ({
    method: 'architect',
    status: 'running',
    phase: 'evaluating',
    stopRequested,
    pauseRequested: false,
    devBaseline: { pass: 0, total: 9 },
    devCurrent: { pass: 0, total: 9 },
    frozen: false,
    rounds: [{ index: 1, status }],
    maxRounds: 3,
    patience: 3,
    passRateTarget: 0.9,
    wallClockSpent: false,
  });

  it('measures the probes, then has the mentor compose, and a stop ends either', () => {
    expect(planNextStep(input('probing'))).toEqual({ kind: 'probe', round: 1 });
    expect(planNextStep(input('composing'))).toEqual({ kind: 'compose', round: 1 });
    expect(planNextStep(input('probing', true))).toMatchObject({ kind: 'abandon_round', round: 1 });
    expect(planNextStep(input('composing', true))).toMatchObject({ kind: 'abandon_round' });
  });
});

describe('the proposals reply', () => {
  const visible = new Set(['train-invoice-1']);

  it('reads each proposal as a hypothesis, and takes no more than were asked for', () => {
    const many = {
      proposals: [...proposals().proposals, hypothesis('Fourth', 'Service desk.\nfix:x')],
    };
    const read = parseProposals({ json: many, text: '' }, visible, 3);
    expect(read.map((item) => item.title)).toEqual([
      'Add the invoice rule',
      'Add the overdue rule',
      'Add the scheduling rule',
    ]);
    expect(read[0]?.causeTaskIds).toEqual(['train-invoice-1']);
  });

  it('names the proposal a format problem is in', () => {
    const broken = { proposals: [proposals().proposals[0], { title: 'No edits' }] };
    expect(() => parseProposals({ json: broken, text: '' }, visible, 3)).toThrow(/^Proposal 2: /);
  });
});
