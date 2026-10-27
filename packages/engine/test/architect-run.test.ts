import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RunEvent } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LineageLog } from '../src/loop/lineage';
import { devSeeds, roundSeed } from '../src/loop/seeds';
import { hypothesis } from './fakes/adapters';
import { FileVersions } from './fakes/harness';
import { defaultTasks } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
let engine: Engine;

beforeEach(async () => {
  world = await createWorld();
  engine = openEngine(world);
  world.mentor.script = (_request, call) =>
    [
      hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice', {
        causeTaskIds: ['train-invoice-1', 'train-invoice-2', 'dev-invoice-1'],
        predicted: { devDeltaMin: 2, devDeltaMax: 3, rationale: 'Three invoice dev tasks.' },
        readyClaim: true,
      }),
      hypothesis('Swap in the overdue rules', 'Service desk.\nfix:overdue', {
        causeTaskIds: ['train-overdue-1'],
      }),
    ][call - 1];
});

afterEach(async () => {
  await engine.close();
  world.cleanup();
});

async function runArchitect() {
  const job = await engine.jobs.importFile(world.jobFile);
  const started = await engine.controller.start(job.id, 'architect', 7);
  await engine.controller.idle();
  const record = engine.store.runs.get(started.id);
  if (!record) throw new Error('The run vanished.');
  return { job, record };
}

/** Each predicate must match a later event than the one before it. */
function expectInOrder(events: RunEvent[], steps: [string, (event: RunEvent) => boolean][]) {
  let cursor = 0;
  for (const [name, matches] of steps) {
    const index = events.findIndex((event, i) => i >= cursor && matches(event));
    expect(index, name).toBeGreaterThanOrEqual(cursor);
    cursor = index + 1;
  }
}

describe('an architect run', () => {
  it('keeps the change that helps dev, reverts the one that does not, and graduates', async () => {
    const { record } = await runArchitect();
    const { run } = record;
    expect(engine.errors).toEqual([]);
    expect(run).toMatchObject({
      status: 'finished',
      phase: 'done',
      stopReason: 'rounds',
      currentVersion: 2,
      devBaseline: { pass: 0, total: 9 },
      devCurrent: { pass: 6, total: 18 },
    });
    expect(run.totals).toMatchObject({
      rounds: 2,
      attempts: 81,
      mentorInputTokens: 4000,
      mentorOutputTokens: 1000,
    });
    expect(run.totals.mentorUsd).toBeCloseTo(0.00925);

    const rounds = engine.store.rounds.list(run.id).map(({ round }) => round);
    expect(
      rounds.map((round) => [round.index, round.status, round.decision, round.candidateVersion]),
    ).toEqual([
      [1, 'decided', 'kept', 2],
      [2, 'decided', 'reverted', 3],
    ]);
    expect(rounds[0]?.decisionReason).toBe(
      'Dev 0/9 → 3/9, measured again on new seeds: 0/18 → 6/18 over 2 runs, no type lost more than two',
    );
    expect(rounds[0]?.firstMeasurement).toEqual({
      devBefore: { pass: 0, total: 9 },
      devAfter: { pass: 3, total: 9 },
    });
    expect(rounds[1]?.firstMeasurement).toBeUndefined();
    expect(rounds[1]?.decisionReason).toBe('Dev 3/9 → 3/9, no change');
    expect(rounds[0]?.train).toEqual({ pass: 0, total: 6 });
  });

  it('logs every change in lineage with its cause, prediction and measured effect', async () => {
    const { record } = await runArchitect();
    const lineage = await new LineageLog(
      engine.paths.lineageFile(record.run.jobId, record.run.id),
    ).read();
    expect(lineage).toHaveLength(2);
    const [kept, reverted] = lineage;
    expect(kept).toMatchObject({
      round: 1,
      title: 'Add the invoice procedure',
      files: ['system.md'],
      causeTaskIds: ['train-invoice-1', 'train-invoice-2'],
      predicted: { devDeltaMin: 2, devDeltaMax: 3, rationale: 'Three invoice dev tasks.' },
      measured: {
        devBefore: { pass: 0, total: 18 },
        devAfter: { pass: 6, total: 18 },
        delta: 6,
        perType: [
          { type: 'invoice', before: 0, after: 6 },
          { type: 'overdue', before: 0, after: 0 },
          { type: 'scheduling', before: 0, after: 0 },
        ],
        firstMeasurement: { devBefore: { pass: 0, total: 9 }, devAfter: { pass: 3, total: 9 } },
      },
      decision: 'kept',
      versionFrom: 1,
      versionTo: 2,
      mentor: { model: 'fake-mentor-1', inputTokens: 2000, outputTokens: 500 },
    });
    expect(reverted).toMatchObject({
      round: 2,
      decision: 'reverted',
      versionFrom: 2,
      versionTo: 3,
      measured: { delta: 0 },
    });
    expect(reverted?.measured.firstMeasurement).toBeUndefined();
    expect(
      engine.store.lineage.list(record.run.id).map((row) => [row.round, row.decision, row.delta]),
    ).toEqual([
      [1, 'kept', 6],
      [2, 'reverted', 0],
    ]);
    const versions = new FileVersions(engine.paths.harnessDir(record.run.jobId, record.run.id));
    expect((await versions.load(3)).meta.parent).toBe(2);
    expect((await versions.load(2)).system).toContain('fix:invoice');
  });

  it('emits events in order and never trains again once testing starts', async () => {
    const { record } = await runArchitect();
    const events = engine.events;
    expectInOrder(events, [
      ['queued', (e) => e.type === 'run.updated' && e.run.status === 'queued'],
      ['running', (e) => e.type === 'run.updated' && e.run.status === 'running'],
      [
        'baseline',
        (e) => e.type === 'eval.finished' && e.split === 'dev' && e.harnessVersion === 1,
      ],
      [
        'round 1 starts',
        (e) => e.type === 'round.updated' && e.round.index === 1 && e.round.status === 'attempting',
      ],
      ['mentor 1 starts', (e) => e.type === 'mentor.started' && e.round === 1],
      ['mentor 1 ends', (e) => e.type === 'mentor.finished' && e.round === 1],
      [
        'candidate 1',
        (e) => e.type === 'round.updated' && e.round.index === 1 && e.round.status === 'evaluating',
      ],
      [
        'candidate 1 on dev',
        (e) => e.type === 'eval.finished' && e.split === 'dev' && e.harnessVersion === 2,
      ],
      [
        'round 1 kept',
        (e) => e.type === 'round.updated' && e.round.index === 1 && e.round.decision === 'kept',
      ],
      [
        'round 2 starts',
        (e) => e.type === 'round.updated' && e.round.index === 2 && e.round.status === 'attempting',
      ],
      ['mentor 2 ends', (e) => e.type === 'mentor.finished' && e.round === 2],
      [
        'round 2 reverted',
        (e) => e.type === 'round.updated' && e.round.index === 2 && e.round.decision === 'reverted',
      ],
      ['testing', (e) => e.type === 'run.updated' && e.run.status === 'testing'],
      [
        'frozen',
        (e) => e.type === 'log' && e.message.startsWith('Graduate frozen at harness version 2'),
      ],
      ['test starts', (e) => e.type === 'attempt.started' && e.split === 'test'],
      [
        'test ends',
        (e) => e.type === 'eval.finished' && e.split === 'test' && e.harnessVersion === 2,
      ],
      ['finished', (e) => e.type === 'run.updated' && e.run.status === 'finished'],
      ['graduate', (e) => e.type === 'graduate.ready' && e.graduateId === record.run.graduateId],
    ]);
    const testing = events.findIndex((e) => e.type === 'run.updated' && e.run.status === 'testing');
    const afterTesting = events.slice(testing);
    expect(
      afterTesting.some((e) => e.type === 'mentor.started' || e.type === 'round.updated'),
    ).toBe(false);
    const testAttempts = events.filter(
      (e) => e.type === 'attempt.finished' && e.attempt.split === 'test',
    );
    expect(testAttempts).toHaveLength(6);
    expect(testAttempts.every((e) => e.type === 'attempt.finished' && e.prompt === undefined)).toBe(
      true,
    );
  });

  it('never shows the mentor a dev or test task', async () => {
    await runArchitect();
    expect(world.mentor.requests).toHaveLength(2);
    const hidden = defaultTasks().filter((t) => !t.id.startsWith('train-'));
    for (const request of world.mentor.requests) {
      const text = JSON.stringify(request);
      for (const t of hidden) {
        expect(text).not.toContain(t.id);
        expect(text).not.toContain(t.prompt);
      }
      expect(text).toContain('[train] invoice request number 1');
    }
    const second = world.mentor.requests[1]?.messages[0]?.content ?? '';
    expect(second).toContain('Dev with the current harness: 6/18 passed.');
    expect(second).toContain(
      'Round 1, kept (dev +3; measured again, +6 over both): Add the invoice procedure.',
    );
  });

  it('measures the incumbent again beside each candidate, on dev seeds the round draws', async () => {
    const { record } = await runArchitect();
    const { seeds } = record;
    const dev = engine.store.attempts.list({ runId: record.run.id, split: 'dev' });
    const seedsOf = (round: number | null, version: number) => [
      ...new Set(
        dev.filter((a) => a.round === round && a.harnessVersion === version).map((a) => a.seed),
      ),
    ];
    expect(dev).toHaveLength(63);
    expect(seedsOf(null, 1)).toEqual([seeds.devPanel]);
    // Round 1's change cleared the limits, so both versions ran again under a second seed.
    expect(seedsOf(1, 1)).toEqual(devSeeds(seeds.devPanel, 1, 2));
    expect(seedsOf(1, 2)).toEqual(devSeeds(seeds.devPanel, 1, 2));
    expect(seedsOf(2, 2)).toEqual([roundSeed(seeds.devPanel, 2)]);
    expect(seedsOf(2, 3)).toEqual([roundSeed(seeds.devPanel, 2)]);
    const lineage = await new LineageLog(
      engine.paths.lineageFile(record.run.jobId, record.run.id),
    ).read();
    expect(lineage.map((entry) => entry.measured.devBefore)).toEqual([
      { pass: 0, total: 18 },
      { pass: 3, total: 9 },
    ]);

    const attempts = world.runtime.attempts;
    const train = attempts.filter((a) => a.taskId.startsWith('train-'));
    expect(new Set(train.filter((a) => a.version === 1).map((a) => a.seed))).toEqual(
      new Set([roundSeed(seeds.trainStudent, 1)]),
    );
    expect(new Set(train.filter((a) => a.version === 2).map((a) => a.seed))).toEqual(
      new Set([roundSeed(seeds.trainStudent, 2)]),
    );
    expect(
      new Set(attempts.filter((a) => a.taskId.startsWith('test-')).map((a) => a.seed)),
    ).toEqual(new Set([seeds.test]));
  });

  it('freezes the graduate and releases the mentor before any test runs', async () => {
    const { record } = await runArchitect();
    const versions = new FileVersions(engine.paths.harnessDir(record.run.jobId, record.run.id));
    expect(record.freeze).toMatchObject({
      graduateId: record.run.graduateId,
      harnessVersion: 2,
      harnessHash: (await versions.load(2)).meta.hash,
      student: { model: 'glimmer:test', digest: 'sha256:fake' },
    });
    const sequence = world.runtime.sequence;
    const release = sequence.indexOf(`release:${record.run.id}`);
    const firstTest = sequence.findIndex((entry) => entry.startsWith('test:'));
    expect(release).toBeGreaterThanOrEqual(0);
    expect(release).toBeLessThan(firstTest);
    expect(world.runtime.releases[0]?.mentor).toBe(world.mentor);
    expect(world.vault.opened).toEqual([record.run.jobId]);
    const tests = engine.store.attempts.list({ runId: record.run.id, split: 'test' });
    expect(tests.map((a) => a.harnessVersion)).toEqual(Array(6).fill(2));
    expect(tests.every((a) => a.tracePath === null && a.expectedSummary === undefined)).toBe(true);
  });

  it('keeps no expected or actual value from a locked-test check, only the failing field', async () => {
    world.runtime.failedCheck = () => ({
      pass: false,
      reason: 'Expected ok to be true, but it is false.',
      details: { expected: { ok: true }, actual: { ok: false } },
    });
    const { record } = await runArchitect();
    const tests = engine.store.attempts.list({ runId: record.run.id, split: 'test' });
    expect(tests.map((attempt) => attempt.check)).toEqual(
      tests.map((attempt) =>
        attempt.taskType === 'invoice'
          ? { pass: true, reason: 'Passed.' }
          : { pass: false, reason: 'Failed: ok is wrong.' },
      ),
    );
    const emitted = engine.events.flatMap((e) =>
      e.type === 'attempt.finished' && e.attempt.split === 'test' ? [e.attempt.check] : [],
    );
    expect(emitted).toEqual(tests.map((attempt) => attempt.check));

    const dev = engine.store.attempts.list({ runId: record.run.id, split: 'dev' });
    expect(dev.find((attempt) => !attempt.check.pass)?.check).toEqual({
      pass: false,
      reason: 'Expected ok to be true, but it is false.',
      details: { expected: { ok: true }, actual: { ok: false } },
    });
  });

  it('computes the report card and writes the graduate folder', async () => {
    const { record } = await runArchitect();
    const report = engine.store.reports.get(record.run.id, 'local');
    expect(report).toMatchObject({
      method: 'architect',
      name: 'Service desk',
      student: { label: 'Glimmer', model: 'glimmer:test', runtime: 'ollama' },
      mentor: { label: 'Spark', model: 'fake-mentor-1' },
      test: {
        score: { pass: 2, total: 6 },
        perType: [
          { type: 'invoice', label: 'Invoices', pass: 2, total: 2, refused: false },
          { type: 'overdue', label: 'Overdue balances', pass: 0, total: 2, refused: false },
          { type: 'scheduling', label: 'Scheduling', pass: 0, total: 2, refused: false },
        ],
        latencyMs: { p50: 1000, p95: 2000 },
        refusals: 0,
        ranOffline: true,
      },
      dev: {
        baseline: { pass: 0, total: 9 },
        final: { pass: 6, total: 18 },
        curve: [
          { round: 0, score: { pass: 0, total: 9 }, decision: 'baseline' },
          { round: 1, score: { pass: 6, total: 18 }, decision: 'kept' },
          { round: 2, score: { pass: 3, total: 9 }, decision: 'reverted' },
        ],
      },
      cost: { mentorInputTokens: 4000, mentorOutputTokens: 1000, rounds: 2 },
      refusedTypes: [],
      topInterventions: [{ round: 1, title: 'Add the invoice procedure', delta: 6, runs: 2 }],
      requirements: { passRate: { target: 0.9, met: false } },
      overclaim: true,
    });
    expect(report?.requirements.passRate.actual).toBeCloseTo(1 / 3);

    const graduate = engine.store.graduates.forRun(record.run.id);
    expect(graduate?.manifest).toMatchObject({
      id: record.run.graduateId,
      method: 'architect',
      harness: { version: 2 },
      test: { score: { pass: 2, total: 6 } },
      student: {
        runtime: 'ollama',
        model: 'glimmer:test',
        quantization: 'Q4_K_M',
        contextLength: 16_384,
      },
    });
    expect(existsSync(join(engine.paths.fromStored(graduate?.path ?? ''), 'graduate.json'))).toBe(
      true,
    );
    expect(world.runtime.sandboxesDisposed).toBe(1);
    expect(world.students.map((student) => student.released)).toEqual([1]);
  });
});
