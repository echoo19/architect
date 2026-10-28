import type { Harness, Task } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lessonId } from '../src/loop/teach';
import { diagnosis, hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { FileVersions } from './fakes/harness';
import { defaultTasks, task } from './fakes/job';
import { createWorld, openEngine, type Engine, type World } from './fakes/world';

let world: World;
const engines: Engine[] = [];

function open(): Engine {
  const engine = openEngine(world);
  engines.push(engine);
  return engine;
}

/** A student that passes invoices once the harness shows it a worked example of one. */
function passesWithExamples(subject: Task, harness: Harness): boolean {
  return (
    harness.system.includes(`fix:${subject.type}`) ||
    harness.examples.some((example) => example.taskTypes.includes(subject.type))
  );
}

async function run(engine: Engine, interactive = false) {
  const job = await engine.jobs.importFile(world.jobFile);
  const started = await engine.controller.start(job.id, 'architect', 7, { interactive });
  await engine.controller.idle();
  return started.id;
}

beforeEach(async () => {
  world = await createWorld();
  world.runtime.passes = passesWithExamples;
});

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.close();
  world.cleanup();
});

describe('a round that teaches by example', () => {
  beforeEach(() => {
    world.mentor.script = (_request, call) =>
      [
        diagnosis('Show an invoice done right', {
          system: 'Service desk. Read the policy before pricing.',
          findings: [{ taskId: 'train-invoice-1' }],
          intervention: { workedExamples: ['invoice'], practicePerFinding: 1 },
        }),
        hypothesis('Nothing more', 'Service desk. Read the policy before pricing.\nAgain.'),
      ][call - 1];
  });

  it('records the finding, a verified repair and related practice, and keeps the change', async () => {
    const engine = open();
    const runId = await run(engine);
    expect(engine.errors).toEqual([]);

    const intervention = engine.store.interventions.get(runId, 1);
    expect(intervention).toMatchObject({
      type: 'procedure',
      status: 'accepted',
      findings: [{ taskId: 'train-invoice-1', taskType: 'invoice', failureTurn: 2 }],
      workedExamples: ['invoice'],
      teaching: {
        items: [
          { kind: 'repair', finding: 0 },
          { kind: 'practice', finding: 0, taskId: 'train-invoice-2' },
        ],
        skipped: [],
      },
    });
    const [category] = engine.store.categories.list('service-desk');
    expect(category).toMatchObject({ slug: 'missed-rule', taskType: 'invoice' });
    expect(intervention?.findings[0]?.categoryId).toBe(category?.id);

    const lessons = engine.store.lessons.list({ runId, round: 1 });
    expect(lessons.map((lesson) => [lesson.kind, lesson.status, lesson.source.kind])).toEqual([
      ['replay_correction', 'verified', 'attempt'],
      ['practice', 'verified', 'practice'],
    ]);
    const [repair] = lessons;
    expect(repair?.checkpoint).toEqual({ turn: 2, replayedCalls: 1, fallback: 'none' });
    expect(repair?.episode?.verifiedTurns).toEqual([2]);
    expect(repair?.episode?.origin).toEqual({
      kind: 'task',
      taskId: 'train-invoice-1',
      split: 'train',
    });
    expect(repair?.cost.calls).toBe(1);
    expect(world.runtime.corrections.map((item) => [item.taskId, item.start])).toEqual([
      ['train-invoice-1', 'turn 2'],
      ['train-invoice-2', 'full task'],
    ]);

    const record = engine.store.runs.get(runId);
    const versions = new FileVersions(engine.paths.harnessDir('service-desk', runId));
    const candidate = await versions.load(2);
    expect(candidate.examples.map((example) => example.slug)).toEqual(['lesson-1-1', 'lesson-1-2']);
    expect(candidate.retrieval.rules).toEqual([
      { whenAny: ['invoice'], loadSkills: [], loadExamples: ['lesson-1-1', 'lesson-1-2'] },
    ]);
    expect(record?.run.currentVersion).toBe(2);

    const [experiment] = engine.store.experiments.list(runId);
    expect(experiment).toMatchObject({
      round: 1,
      kind: 'harness',
      disposition: 'kept',
      interventionId: intervention?.id,
      inputs: { baseVersion: 1, candidateVersion: 2, lessonIds: lessons.map((item) => item.id) },
    });
    expect(experiment?.measurements.map((item) => item.label)).toEqual(['incumbent', 'candidate']);
    expect(experiment?.gates.map((gate) => [gate.gate, gate.passed])).toEqual([
      ['permission', true],
      ['device', true],
    ]);
    // Spark's diagnosis and both corrections are charged to the round.
    expect(experiment?.budget.mentorUsd).toBeCloseTo(
      engine.store.costs
        .list(runId)
        .filter((cost) => cost.role === 'mentor' && cost.round === 1)
        .reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    );
    expect(experiment?.budget.mentorInputTokens).toBe(2000 + 2 * 300);
  });

  it('labels a correction that had to start over as a whole-task demonstration', async () => {
    world.runtime.correction = (_subject, start) =>
      start.kind === 'checkpoint'
        ? {
            verified: false,
            replayed: null,
            reason: "The replay didn't hold: The data changed since the attempt.",
          }
        : { verified: true };
    const engine = open();
    const runId = await run(engine);
    const lessons = engine.store.lessons.list({ runId, round: 1 });
    expect(
      lessons.map((lesson) => [lesson.kind, lesson.status, lesson.checkpoint?.fallback]),
    ).toEqual([
      ['replay_correction', 'rejected', 'none'],
      ['full_task_demonstration', 'verified', 'full_task'],
      ['practice', 'verified', 'none'],
    ]);
    expect(lessons[0]?.reason).toBe("The replay didn't hold: The data changed since the attempt.");
    expect(lessons[0]?.episode).toBeNull();
  });

  it('keeps a rejected correction with its reason and trains on none of it', async () => {
    world.runtime.correction = () => ({ verified: false, reason: 'total_cents is 250.' });
    const engine = open();
    const runId = await run(engine);
    const lessons = engine.store.lessons.list({ runId, round: 1 });
    expect(lessons.every((lesson) => lesson.status === 'rejected')).toBe(true);
    expect(lessons.every((lesson) => lesson.episode === null)).toBe(true);
    expect(lessons.map((lesson) => lesson.reason)).toContain('total_cents is 250.');
    // With nothing verified, the change goes to dev without examples.
    const versions = new FileVersions(engine.paths.harnessDir('service-desk', runId));
    expect((await versions.load(2)).examples).toEqual([]);
  });

  it('resumes teaching after a crash without a second lesson for any try', async () => {
    const crashed = deferred();
    let seen = 0;
    world.runtime.beforeCorrection = () => {
      seen += 1;
      if (seen !== 2) return;
      crashed.resolve();
      return new Promise<void>(() => {});
    };
    const first = open();
    const job = await first.jobs.importFile(world.jobFile);
    const runId = (await first.controller.start(job.id, 'architect', 7)).id;
    await crashed.promise;
    first.store.close();
    engines.splice(engines.indexOf(first), 1);

    const second = open();
    expect(second.store.rounds.get(runId, 1)?.round.status).toBe('teaching');
    expect(second.store.lessons.list({ runId })).toHaveLength(1);
    world.runtime.beforeCorrection = undefined;
    second.controller.recover();
    await second.controller.idle();

    expect(second.errors).toEqual([]);
    const lessons = second.store.lessons.list({ runId, round: 1 });
    expect(lessons.map((lesson) => lesson.id)).toEqual([
      lessonId(runId, 1, 0, 0),
      lessonId(runId, 1, 1, 0),
    ]);
    expect(second.store.interventions.list(runId)).toHaveLength(2);
    expect(world.mentor.requests).toHaveLength(2);
    expect(second.store.experiments.list(runId).map((item) => item.disposition)).toEqual([
      'kept',
      'reverted',
    ]);
  });
});

describe('findings and interventions the runner refuses', () => {
  it('sets aside a finding that does not hold and keeps the rest', async () => {
    world.mentor.script = (_request, call) =>
      [
        diagnosis('Fix invoices', {
          system: 'Service desk.\nfix:invoice',
          findings: [
            { taskId: 'dev-invoice-1' },
            { taskId: 'train-invoice-1', failureTurn: 9 },
            { taskId: 'train-invoice-2' },
          ],
        }),
        hypothesis('Nothing more', 'Service desk.\nfix:invoice\nAgain.'),
      ][call - 1];
    const engine = open();
    const runId = await run(engine);
    const intervention = engine.store.interventions.get(runId, 1);
    expect(intervention?.findings.map((finding) => finding.taskId)).toEqual(['train-invoice-2']);
    expect(intervention?.setAside).toEqual([
      { taskId: 'dev-invoice-1', reason: "it isn't a failed train attempt of this round" },
      {
        taskId: 'train-invoice-1',
        reason: "the attempt took 2 model turns, so turn 9 isn't one of them",
      },
    ]);
  });

  it('refuses weights with no training worker, gives one fix, then records the round invalid', async () => {
    world.mentor.script = () =>
      diagnosis('Train the reading', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { type: 'weights' },
      });
    const engine = open();
    const runId = await run(engine);
    expect(world.mentor.requests.length).toBeGreaterThanOrEqual(2);
    const intervention = engine.store.interventions.get(runId, 1);
    expect(intervention?.status).toBe('invalid');
    expect(intervention?.invalidReason).toBe(
      "A weights intervention isn't possible in this run: No training worker is set up in this build.",
    );
    const [experiment] = engine.store.experiments.list(runId);
    expect(experiment).toMatchObject({ round: 1, disposition: 'invalid', devAfter: null });
    expect(experiment?.reason).toBe(intervention?.invalidReason);
  });

  it('refuses a change that writes train answers into the harness', async () => {
    const tasks = defaultTasks().map((item) =>
      item.id.startsWith('train-invoice')
        ? {
            ...item,
            expected: {
              kind: 'answer' as const,
              value: { invoice: `INV-90${item.id.slice(-1)}` },
              compare: { mode: 'exact' as const },
            },
          }
        : item,
    );
    world.cleanup();
    world = await createWorld({ tasks });
    world.mentor.script = () =>
      diagnosis('Memorize the invoices', {
        edits: [
          {
            op: 'write',
            path: 'AGENTS.md',
            content: 'Service desk.\nRequest 1 is INV-901. Request 2 is INV-902.',
          },
        ],
      });
    const engine = open();
    const runId = await run(engine);
    expect(engine.store.interventions.get(runId, 1)?.invalidReason).toBe(
      'AGENTS.md holds the expected results of 2 train tasks (train-invoice-1, train-invoice-2). Teach the procedure, not the answers.',
    );
  });

  it('refuses an estimate past the mentor budget that is left', async () => {
    world.mentor.script = () =>
      diagnosis('Expensive', {
        system: 'Service desk.\nfix:invoice',
        intervention: { estimatedCost: { mentorUsd: 50, computeUsd: 0, minutes: 5 } },
      });
    const engine = open();
    const runId = await run(engine);
    expect(engine.store.interventions.get(runId, 1)?.invalidReason).toMatch(
      /^Its estimate of \$50\.00 of mentor spend is more than the \$4\.\d\d left\.$/,
    );
  });
});

describe('the guards on a correction', () => {
  beforeEach(() => {
    world.mentor.script = () =>
      diagnosis('Teach it', {
        findings: [{ taskId: 'train-invoice-1' }],
        intervention: { workedExamples: ['invoice'] },
      });
  });

  it('refuses a correction whose request would carry a locked test task, and ends training', async () => {
    const leaked = task('test', 'invoice', 1).prompt;
    world.runtime.actorRequest = (subject) => `${subject.prompt}\n${leaked}`;
    const engine = open();
    const runId = await run(engine);
    const [lesson] = engine.store.lessons.list({ runId });
    expect(lesson).toMatchObject({ status: 'rejected', episode: null });
    expect(lesson?.reason).toBe(
      "The leak check refused the correction's request: Refused a mentor call: its payload matched 1 locked test task.",
    );
    expect(engine.store.runs.get(runId)?.run.stopReason).toBe('leak');
    expect(engine.store.experiments.list(runId).map((item) => item.disposition)).toEqual([
      'stopped',
    ]);
    // Nothing of the refused request reached the actor.
    expect(world.actors.every((actor) => actor.chats.length === 0)).toBe(true);
  });

  it('refuses a correction the mentor budget left cannot cover, and records it', async () => {
    world.actorPriceScale = 10_000;
    const engine = open();
    const runId = await run(engine);
    const [lesson] = engine.store.lessons.list({ runId });
    expect(lesson?.status).toBe('rejected');
    expect(lesson?.reason).toMatch(/^The mentor budget refused the correction's request: /);
    expect(engine.store.runs.get(runId)?.run.stopReason).toBe('usd');
    expect(engine.store.experiments.list(runId).map((item) => item.disposition)).toEqual([
      'stopped',
    ]);
  });
});
