import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPARISON_REPORT_FORMAT, type Experiment, type RunEvent } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { connectEngine, type EngineClient } from '../src/host/client';
import { createEngineHost, type EngineHost } from '../src/host/engine-host';
import { DataPaths } from '../src/loop/paths';
import { STOPPED_ROUND } from '../src/loop/plan';
import { openEngineStore } from '../src/store/engine-store';
import { diagnosis, hypothesis } from './fakes/adapters';
import { deferred } from './fakes/clock';
import { defaultTasks } from './fakes/job';
import { portPair } from './fakes/ports';
import { createWorld, type World } from './fakes/world';

let world: World;
let host: EngineHost | undefined;
let client: EngineClient | undefined;

async function connect(): Promise<EngineClient> {
  host = await createEngineHost({ dataDir: world.dataDir, deps: world.deps, clock: world.clock });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  client = connectEngine(clientPort);
  return client;
}

async function disconnect(): Promise<void> {
  client?.close();
  await host?.close();
  host = undefined;
  client = undefined;
}

function next(engine: EngineClient, matches: (event: RunEvent) => boolean): Promise<RunEvent> {
  return new Promise((resolve) => {
    const stop = engine.runs.onEvent((event) => {
      if (!matches(event)) return;
      stop();
      resolve(event);
    });
  });
}

const settled = (event: RunEvent, runId: string) =>
  event.type === 'run.updated' &&
  event.run.id === runId &&
  ['finished', 'stopped', 'paused', 'failed'].includes(event.run.status);

afterEach(async () => {
  await disconnect();
  world.cleanup();
});

describe('the progress and capability numbers', () => {
  beforeEach(async () => {
    world = await createWorld({
      job: {
        budget: { maxRounds: 5, maxMentorUsd: 5, maxWallMinutes: 600 },
        evaluation: {
          trainBatch: 6,
          minDevGain: 2,
          maxTypeRegression: 1,
          patience: 5,
          devRepeats: 1,
        },
      },
    });
    world.mentor.script = (_request, call) => {
      if (call === 1) return hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
      if (call === 2) return hypothesis('Reword it', 'Service desk.\nfix:invoice\nPlease.');
      if (call === 3) return hypothesis('Drop the procedure', 'Service desk. Be brief.');
      if (call <= 5) {
        return diagnosis('Train the reading', {
          findings: [{ taskId: 'train-overdue-1' }],
          intervention: { type: 'weights' },
        });
      }
      return hypothesis('One more', 'Service desk.\nfix:invoice\nOne more.');
    };
  });

  it('reconcile with the stored experiments, rejected, invalid and stopped ones included', async () => {
    const api = await connect();
    const job = await api.jobs.createSample();
    // Round 5 is stopped while its train batch is under way.
    const reached = deferred();
    world.runtime.beforeAttempt = (task, ctx) => {
      if (!task.id.startsWith('train-') || ctx.harness.meta.version !== 2) return;
      const rounds = world.runtime.attempts.filter((item) => item.taskId.startsWith('train-'));
      if (rounds.length < 4 * 6) return;
      world.runtime.beforeAttempt = undefined;
      reached.resolve();
      return new Promise<void>((resolve) => setTimeout(resolve, 20));
    };
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7 });
    await reached.promise;
    await api.runs.stop(run.id);
    await next(
      api,
      (event) =>
        settled(event, run.id) && event.type === 'run.updated' && event.run.status === 'finished',
    );

    const experiments = await api.mentoring.experiments(run.id);
    const dispositions = experiments.map((experiment) => experiment.disposition);
    expect(dispositions).toEqual(['kept', 'reverted', 'rejected', 'invalid', 'stopped']);
    expect(experiments[4]?.reason).toBe(STOPPED_ROUND);

    const progress = await api.mentoring.progress(run.id);
    const count = (disposition: Experiment['disposition']) =>
      experiments.filter((experiment) => experiment.disposition === disposition).length;
    expect(progress.experiments).toEqual({
      total: experiments.length,
      kept: count('kept'),
      reverted: count('reverted'),
      rejected: count('rejected'),
      invalid: count('invalid'),
      stopped: count('stopped'),
    });
    expect(progress.dev.current).toEqual(
      experiments.filter((experiment) => experiment.disposition === 'kept').at(-1)?.devAfter,
    );
    const sum = (pick: (experiment: Experiment) => number) =>
      experiments.reduce((total, experiment) => total + pick(experiment), 0);
    expect(progress.spent.mentorUsd).toBeCloseTo(sum((item) => item.budget.mentorUsd));
    expect(progress.spent.attempts).toBe(sum((item) => item.budget.attempts));
    const detail = await api.runs.get(run.id);
    expect(progress.spent.mentorUsd).toBeCloseTo(detail.run.totals.mentorUsd);
    expect(progress.budget).toEqual({
      maxRounds: 5,
      maxMentorUsd: 5,
      maxComputeUsd: 0,
      maxWallMinutes: 600,
    });

    const capabilities = await api.mentoring.capabilities(run.id);
    const invoices = capabilities.capabilities.find((item) => item.type === 'invoice');
    const latest = experiments.filter((item) => item.measurements.length > 0).at(-1);
    const incumbent = latest?.measurements.find((item) => item.label === 'incumbent');
    expect(invoices?.check).toEqual({
      pass: incumbent?.perType.find((item) => item.type === 'invoice')?.pass,
      total: incumbent?.perType.find((item) => item.type === 'invoice')?.total,
    });
    const card = await api.reports.get(run.id);
    expect(invoices?.finalTest).toEqual({
      pass: card.test.perType.find((item) => item.type === 'invoice')?.pass,
      total: card.test.perType.find((item) => item.type === 'invoice')?.total,
    });
    expect(invoices?.installCheck).toBeNull();
    const interventions = await api.mentoring.interventions(run.id);
    expect(interventions.map((item) => [item.round, item.status])).toEqual([
      [1, 'accepted'],
      [2, 'accepted'],
      [3, 'accepted'],
      [4, 'invalid'],
    ]);
  });
});

describe('a correction played back beside its lesson', () => {
  beforeEach(async () => {
    world = await createWorld();
    world.mentor.script = (_request, call) =>
      call === 1
        ? diagnosis('Show an invoice done right', {
            system: 'Service desk.\nfix:invoice',
            findings: [{ taskId: 'train-invoice-1' }],
            intervention: { workedExamples: ['invoice'] },
          })
        : hypothesis('Nothing more', 'Service desk.\nfix:invoice\nAgain.');
    // The try from the suspected turn can't be replayed; the whole task then verifies.
    world.runtime.correction = (_task, start) =>
      start.kind === 'checkpoint'
        ? { verified: false, replayed: null, reason: "The replay didn't hold." }
        : { verified: true };
  });

  it('keeps the trace of each correction that ran, and none for a try that never did', async () => {
    const api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7 });
    await next(api, (event) => settled(event, run.id));

    const lessons = await api.mentoring.lessons(run.id);
    const tried = lessons.find((lesson) => lesson.kind === 'replay_correction');
    const whole = lessons.find((lesson) => lesson.kind === 'full_task_demonstration');
    expect(tried?.status).toBe('rejected');
    expect(whole?.status).toBe('verified');
    // Each lesson comes with its train task's request, for the list it shows in.
    const asked = defaultTasks().find((task) => task.id === 'train-invoice-1')?.prompt;
    expect(asked).toEqual(expect.any(String));
    expect(whole?.prompt).toBe(asked);
    expect(await api.mentoring.lessonTrace(tried?.id ?? '')).toBeNull();
    const played = await api.mentoring.lessonTrace(whole?.id ?? '');
    expect(played).toMatchObject({ taskId: 'train-invoice-1', stopReason: 'answer' });
    expect(played?.finalText).toBe(whole?.turns.at(-1)?.content);
    await expect(api.mentoring.lessonTrace('lsn_unknown')).rejects.toThrow(
      'There is no lesson "lsn_unknown".',
    );
  });

  it('opens the attempt a finding names, and never a final-test attempt', async () => {
    const api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7 });
    await next(api, (event) => settled(event, run.id));

    const [intervention] = await api.mentoring.interventions(run.id);
    const finding = intervention?.findings[0];
    const opened = await api.runs.attempt(finding?.attemptId ?? '');
    expect(opened).toMatchObject({
      id: finding?.attemptId,
      taskId: 'train-invoice-1',
      split: 'train',
      check: { pass: false },
    });
    expect(opened.prompt).toEqual(expect.any(String));

    const engine = openEngineStore(new DataPaths(world.dataDir).database);
    const tested = engine.attempts.list({ runId: run.id, split: 'test' })[0];
    engine.close();
    await expect(api.runs.attempt(tested?.id ?? '')).rejects.toThrow(
      "A final-test attempt isn't shown on its own; the report card counts it.",
    );
  });

  it('serves the runtime meter readings a run has, and a comparisons report only beside its data', async () => {
    const api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7 });
    await next(api, (event) => settled(event, run.id));

    // No meter ran, so there is nothing to show; a reading the store has comes back as stored.
    expect(await api.runs.runtimeMeasurements(run.id)).toEqual([]);
    const engine = openEngineStore(new DataPaths(world.dataDir).database);
    const reading = {
      id: 'msr_first',
      runId: run.id,
      split: 'test' as const,
      target: 'local' as const,
      config: 'student',
      harnessVersion: 1,
      seeds: [101],
      backend: 'ollama',
      peakProcessBytes: 19_000_000_000,
      peakGpuBytes: 7_000_000_000,
      coldStartMs: 8_400,
      samples: 12,
      sampler: 'a meter in a test',
      startedAt: '2026-10-28T10:00:00.000Z',
      endedAt: '2026-10-28T10:20:00.000Z',
    };
    engine.runtimeMeasurements.insert(reading);
    engine.close();
    expect(await api.runs.runtimeMeasurements(run.id)).toEqual([reading]);

    // The runner leaves its report beside the `data` folder it ran in. With none there, or a file
    // in another format, there is no report; one in its format that doesn't parse says so.
    const beside = join(world.dataDir, '..', 'report.json');
    expect(await api.reports.comparisons(run.id)).toBeNull();
    writeFileSync(beside, JSON.stringify({ format: 'something else', arms: [] }));
    expect(await api.reports.comparisons(run.id)).toBeNull();
    writeFileSync(beside, JSON.stringify({ format: COMPARISON_REPORT_FORMAT, arms: [] }));
    await expect(api.reports.comparisons(run.id)).rejects.toThrow(
      "doesn't match its format, so it can't be shown",
    );
  });
});

describe('a clarifying question', () => {
  beforeEach(async () => {
    world = await createWorld();
    world.mentor.script = (_request, call) =>
      call === 1
        ? diagnosis('Ask about overdue', {
            intervention: {
              type: 'clarification',
              question: 'Should an invoice due today count as overdue?',
            },
          })
        : hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
  });

  it('pauses the run, keeps it waiting across a restart, and goes on once answered', async () => {
    let api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7, interactive: true });
    await next(api, (event) => settled(event, run.id));
    expect((await api.runs.get(run.id)).run.status).toBe('paused');
    expect((await api.runs.get(run.id)).rounds[0]?.status).toBe('clarifying');
    const [asked] = await api.mentoring.interventions(run.id);
    expect(asked).toMatchObject({ type: 'clarification', status: 'accepted' });
    expect(asked?.answer).toBeUndefined();

    await disconnect();
    api = await connect();
    expect((await api.runs.get(run.id)).run.status).toBe('paused');
    const done = next(
      api,
      (event) => event.type === 'run.updated' && event.run.status === 'finished',
    );
    await api.mentoring.answer(run.id, 1, {
      text: 'No, only from tomorrow.',
      changesCriteria: false,
    });
    await done;

    const detail = await api.runs.get(run.id);
    expect(detail.rounds[0]).toMatchObject({
      status: 'decided',
      decisionReason: 'Answered: No, only from tomorrow.',
    });
    const [answered] = await api.mentoring.interventions(run.id);
    expect(answered?.answer).toMatchObject({
      text: 'No, only from tomorrow.',
      changesCriteria: false,
    });
    // The next round's mentor sees the answer, as a confirmed interpretation.
    const second = world.mentor.requests[1]?.messages[0]?.content ?? '';
    expect(second).toContain(
      "# The person's answers\n- Q: Should an invoice due today count as overdue?\n  A: No, only from tomorrow.",
    );
    await expect(
      api.mentoring.answer(run.id, 1, { text: 'Again.', changesCriteria: false }),
    ).rejects.toThrow("Round 1 isn't waiting for an answer.");
  });

  it('stops the run when the answer changes what counts as success', async () => {
    const api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7, interactive: true });
    await next(api, (event) => settled(event, run.id));
    const stopped = next(
      api,
      (event) => event.type === 'run.updated' && event.run.status === 'stopped',
    );
    await api.mentoring.answer(run.id, 1, { text: 'It should count.', changesCriteria: true });
    await stopped;
    expect((await api.runs.get(run.id)).run).toMatchObject({
      status: 'stopped',
      stopReason: 'contract',
    });
  });

  it('is off the menu for a run nobody can answer', async () => {
    const question = diagnosis('Ask about overdue', {
      intervention: { type: 'clarification', question: 'Due today?' },
    });
    world.mentor.script = (_request, call) =>
      call <= 2 ? question : hypothesis('Add the invoice procedure', 'Service desk.\nfix:invoice');
    const api = await connect();
    const job = await api.jobs.createSample();
    const run = await api.runs.start(job.id, { method: 'architect', seed: 7 });
    await next(api, (event) => event.type === 'run.updated' && event.run.status === 'finished');
    const [refused] = await api.mentoring.interventions(run.id);
    expect(refused?.status).toBe('invalid');
    expect(refused?.invalidReason).toBe(
      "A clarification intervention isn't possible in this run: Nobody is there to answer: this run wasn't started from the app.",
    );
  });
});
