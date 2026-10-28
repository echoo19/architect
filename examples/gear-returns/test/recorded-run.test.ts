import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  connectEngine,
  createEngineDeps,
  createEngineHost,
  type EngineClient,
  type EngineHost,
  type EnginePort,
} from '@architect/engine';
import type { Experiment, ListedLesson } from '@architect/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FAKE_METER_READING,
  RecordedRunSummarySchema,
  recordRun,
  REFERENCE_CAP_USD,
  SCENARIO,
  SUMMARY_FILE,
  type RecordedRunSummary,
} from './recorded-run';

/**
 * The recorded run the evidence screens are built and photographed on, read back through the
 * engine's own API the way the desktop app reads it: every round of the scenario as the real
 * loop recorded it, and progress and the capability breakdown agreeing with the stored
 * experiments (A05). A change that breaks what the screens rely on fails here.
 */

const OUT_OF_TIME = 'The wall-clock budget ran out before this change was evaluated.';

/** Two connected ports in one process; a message is cloned and arrives a tick later. */
function portPair(): [EnginePort, EnginePort] {
  const handlers = [new Set<(message: unknown) => void>(), new Set<(message: unknown) => void>()];
  const end = (side: 0 | 1): EnginePort => ({
    postMessage(message) {
      const copy = structuredClone(message);
      setImmediate(() => {
        for (const handler of handlers[side === 0 ? 1 : 0] ?? []) handler(copy);
      });
    },
    onMessage(handler) {
      handlers[side]?.add(handler);
    },
  });
  return [end(0), end(1)];
}

let root: string;
let dataDir: string;
let summary: RecordedRunSummary;
let host: EngineHost | undefined;
let api: EngineClient | undefined;

function engine(): EngineClient {
  if (api === undefined) throw new Error('The engine is not connected.');
  return api;
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'gear-returns-recorded-'));
  dataDir = join(root, 'data');
  summary = await recordRun(dataDir);
  host = await createEngineHost({
    dataDir,
    deps: createEngineDeps({ dataDir, getSecret: async () => undefined }),
  });
  const [hostPort, clientPort] = portPair();
  host.serve(hostPort);
  api = connectEngine(clientPort);
}, 300_000);

afterAll(async () => {
  api?.close();
  await host?.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function experiments(): Promise<Experiment[]> {
  return engine().mentoring.experiments(summary.runId);
}

async function experiment(round: number): Promise<Experiment> {
  const found = (await experiments()).find((item) => item.round === round);
  if (found === undefined) throw new Error(`Round ${round} has no experiment.`);
  return found;
}

async function lessonsOf(round: number): Promise<ListedLesson[]> {
  return (await engine().mentoring.lessons(summary.runId)).filter(
    (lesson) => lesson.round === round,
  );
}

async function intervention(round: number) {
  const found = (await engine().mentoring.interventions(summary.runId)).find(
    (item) => item.round === round,
  );
  if (found === undefined) throw new Error(`Round ${round} has no intervention.`);
  return found;
}

async function changed(round: number): Promise<string[]> {
  const diff = await engine().runs.roundDiff(summary.runId, round);
  return diff.map((file) => file.path).sort();
}

function measured(item: Experiment, label: string) {
  const found = item.measurements.find((measurement) => measurement.label === label);
  if (found === undefined) throw new Error(`Round ${item.round} has no ${label} measurement.`);
  return found;
}

describe('the recorded run on the returns desk', () => {
  it('writes a summary that the schema reads and that names the stored records', async () => {
    const written = RecordedRunSummarySchema.parse(
      JSON.parse(readFileSync(join(dataDir, SUMMARY_FILE), 'utf8')),
    );
    expect(written).toEqual(summary);
    expect(summary.rounds.map((round) => round.disposition)).toEqual(SCENARIO);
    expect(
      (await experiments()).map(({ round, id, disposition }) => [round, id, disposition]),
    ).toEqual(
      summary.rounds.map(({ round, experimentId, disposition }) => [
        round,
        experimentId,
        disposition,
      ]),
    );
    const lessons = await engine().mentoring.lessons(summary.runId);
    expect(lessons.map(({ id, round, kind, status }) => [id, round, kind, status])).toEqual(
      summary.rounds.flatMap(({ round, lessons: taught }) =>
        taught.map(({ id, kind, status }) => [id, round, kind, status]),
      ),
    );
  });

  it('keeps a refund procedure taught by a replayed repair and a practice case', async () => {
    const { repair, runId } = summary;
    const failed = await engine().runs.attempt(repair.attemptId);
    expect(failed).toMatchObject({
      split: 'train',
      round: 1,
      taskId: repair.taskId,
      taskType: 'refund',
      check: { pass: false },
    });
    expect(await intervention(1)).toMatchObject({
      type: 'procedure',
      status: 'accepted',
      findings: [
        { attemptId: repair.attemptId, taskId: repair.taskId, failureTurn: repair.failureTurn },
      ],
    });
    const lessons = await lessonsOf(1);
    expect(lessons).toEqual([
      expect.objectContaining({
        id: repair.lessonId,
        kind: 'replay_correction',
        status: 'verified',
        source: { kind: 'attempt', attemptId: repair.attemptId, taskId: repair.taskId },
        checkpoint: {
          turn: repair.failureTurn,
          replayedCalls: repair.failureTurn - 1,
          fallback: 'none',
        },
        check: expect.objectContaining({ pass: true }),
        audit: expect.objectContaining({ ok: true }),
      }),
      expect.objectContaining({ kind: 'practice', status: 'verified', taskType: 'refund' }),
    ]);
    expect(await engine().mentoring.lessonTrace(repair.lessonId)).toMatchObject({
      stopReason: 'answer',
    });
    // The verified lessons became worked examples, with a rule that loads them for refunds.
    expect(await changed(1)).toEqual([
      'AGENTS.md',
      'examples/lesson-1-1.json',
      'examples/lesson-1-2.json',
      'retrieval.yaml',
    ]);
    const kept = await experiment(1);
    expect(kept).toMatchObject({
      kind: 'harness',
      disposition: 'kept',
      inputs: { lessonIds: lessons.map((lesson) => lesson.id) },
    });
    // A paired measurement, confirmed on new seeds before it was kept.
    const incumbent = measured(kept, 'incumbent');
    const candidate = measured(kept, 'candidate');
    expect(incumbent.seeds).toHaveLength(2);
    expect(candidate.seeds).toEqual(incumbent.seeds);
    expect(candidate.score.pass).toBeGreaterThan(incumbent.score.pass);
    const detail = await engine().runs.get(runId);
    expect(detail.run.devCurrent).toEqual(kept.devAfter);
  });

  it('rejects a dates skill that fixes pickups but breaks order questions', async () => {
    const proposed = await intervention(2);
    expect(proposed).toMatchObject({ type: 'retrieval', status: 'accepted' });
    expect(proposed.findings).toEqual([
      expect.objectContaining({ taskType: 'pickup', failureTurn: 4 }),
    ]);
    // The suspected turn and the one before it carried the student's misreading on, so the
    // checker failed both; the whole task, demonstrated from the start, verified.
    const lessons = await lessonsOf(2);
    expect(lessons.map(({ kind, status, checkpoint }) => [kind, status, checkpoint])).toEqual([
      ['replay_correction', 'rejected', { turn: 4, replayedCalls: 3, fallback: 'none' }],
      ['replay_correction', 'rejected', { turn: 3, replayedCalls: 2, fallback: 'earlier' }],
      ['full_task_demonstration', 'verified', { turn: 1, replayedCalls: 0, fallback: 'full_task' }],
    ]);
    for (const lesson of lessons.slice(0, 2)) {
      expect(lesson.reason).toMatch(/^The checker didn't pass it: /);
    }
    expect(await changed(2)).toEqual([
      'examples/lesson-2-1.json',
      'retrieval.yaml',
      'skills/pickup-dates/SKILL.md',
    ]);
    const rejected = await experiment(2);
    expect(rejected.disposition).toBe('rejected');
    expect(rejected.devAfter?.pass).toBeLessThan(rejected.devBefore?.pass ?? 0);
    expect(rejected.regressions).toEqual([{ type: 'order', before: 3, after: 0 }]);
    const pickups = rejected.perType.find((change) => change.type === 'pickup');
    expect(pickups?.after).toBeGreaterThan(pickups?.before ?? 0);
  });

  it('reverts a helper that changes nothing, after which pickup dates stop being taught', async () => {
    const proposed = await intervention(3);
    expect(proposed).toMatchObject({ type: 'helper', status: 'accepted' });
    const [category] = (await intervention(2)).findings.map((finding) => finding.categoryId);
    expect(proposed.findings).toEqual([
      expect.objectContaining({ categoryId: category, failureTurn: 2 }),
    ]);
    // Named at the turn the student misread the rules, the replay held and verified.
    expect(await lessonsOf(3)).toEqual([
      expect.objectContaining({
        kind: 'replay_correction',
        status: 'verified',
        checkpoint: { turn: 2, replayedCalls: 1, fallback: 'none' },
      }),
    ]);
    expect(await changed(3)).toEqual([
      'examples/lesson-3-1.json',
      'retrieval.yaml',
      'tools/pickup_days.js',
      'tools/pickup_days.json',
    ]);
    const reverted = await experiment(3);
    expect(reverted).toMatchObject({ disposition: 'reverted', regressions: [] });
    expect(reverted.devAfter).toEqual(reverted.devBefore);
    const categories = await engine().mentoring.categories(summary.jobId);
    expect(categories.map((item) => item.slug)).toEqual([
      'refund-amount',
      'pickup-date',
      'pickup-ready-date',
    ]);
    const breakdown = await engine().mentoring.capabilities(summary.runId);
    const pickup = breakdown.capabilities.find((item) => item.type === 'pickup');
    expect(pickup?.categories.map(({ slug, stopped }) => [slug, stopped])).toEqual([
      ['pickup-date', true],
      ['pickup-ready-date', false],
    ]);
  });

  it('refuses weights before measuring them', async () => {
    const proposed = await intervention(4);
    expect(proposed).toMatchObject({ type: 'weights', status: 'invalid' });
    expect(proposed.invalidReason).toMatch(/^A weights intervention isn't possible in this run: /);
    expect(await experiment(4)).toMatchObject({
      kind: 'weights',
      disposition: 'invalid',
      reason: proposed.invalidReason,
      measurements: [],
      devBefore: null,
      devAfter: null,
    });
    expect(await lessonsOf(4)).toEqual([]);
  });

  it('stops round 5 between corrections when the wall clock runs out', async () => {
    const proposed = await intervention(5);
    expect(proposed).toMatchObject({ type: 'procedure', status: 'accepted' });
    const [stopped, fresh] = proposed.findings;
    const [category] = (await intervention(2)).findings.map((finding) => finding.categoryId);
    expect(stopped?.categoryId).toBe(category);
    expect(fresh?.categoryId).not.toBe(category);
    expect(proposed.teaching).toEqual({
      items: [
        { kind: 'repair', finding: 1 },
        { kind: 'practice', finding: 1, taskId: expect.any(String) },
      ],
      skipped: [
        {
          what: `the repair of ${stopped?.taskId}`,
          reason: 'its category made no dev gain in 2 rounds, so its teaching stopped',
        },
      ],
    });
    // The repair verified; the clock ran out before the practice case could start.
    expect(await lessonsOf(5)).toEqual([
      expect.objectContaining({
        kind: 'replay_correction',
        status: 'verified',
        source: expect.objectContaining({ taskId: fresh?.taskId }),
      }),
    ]);
    expect(await experiment(5)).toMatchObject({
      disposition: 'stopped',
      reason: OUT_OF_TIME,
      measurements: [],
      inputs: { candidateVersion: null },
    });
    const detail = await engine().runs.get(summary.runId);
    expect(detail.run.stopReason).toBe('wall_clock');
    expect(detail.rounds[4]).toMatchObject({ status: 'failed', error: OUT_OF_TIME });
  });

  it("tests round 1's version on the locked test, and measures Spark on dev only", async () => {
    const detail = await engine().runs.get(summary.runId);
    expect(detail.run).toMatchObject({ status: 'finished', graduateId: summary.graduateId });
    expect(detail.run.currentVersion).toBe(detail.rounds[0]?.candidateVersion);
    const card = await engine().reports.get(summary.runId);
    expect(card.test.score).toEqual(summary.test.score);
    expect(card.test.perType.map(({ type, pass, total }) => [type, pass, total])).toEqual([
      ['refund', 2, 2],
      ['order', 2, 2],
      ['pickup', 1, 2],
    ]);
    const references = await engine().mentoring.references(summary.runId);
    expect(references).toEqual([
      expect.objectContaining({
        split: 'dev',
        status: 'finished',
        harnessVersion: detail.run.currentVersion,
        maxUsd: REFERENCE_CAP_USD,
        score: summary.reference.score,
      }),
    ]);
    expect(references[0]?.spentUsd).toBeGreaterThan(0);
    expect(references[0]?.spentUsd).toBeLessThanOrEqual(REFERENCE_CAP_USD);
    // The meter read the locked test on this computer, and only it: Spark's run isn't metered.
    expect(await engine().runs.runtimeMeasurements(summary.runId)).toEqual([
      expect.objectContaining({
        split: 'test',
        target: 'local',
        config: 'student',
        harnessVersion: detail.run.currentVersion,
        ...FAKE_METER_READING,
      }),
    ]);
  });

  it('reconciles progress and the capability breakdown with the stored experiments', async () => {
    const stored = await experiments();
    const count = (disposition: Experiment['disposition']) =>
      stored.filter((item) => item.disposition === disposition).length;
    const sum = (pick: (item: Experiment) => number) =>
      stored.reduce((total, item) => total + pick(item), 0);
    const progress = await engine().mentoring.progress(summary.runId);
    expect(progress.experiments).toEqual({
      total: stored.length,
      kept: count('kept'),
      reverted: count('reverted'),
      rejected: count('rejected'),
      invalid: count('invalid'),
      stopped: count('stopped'),
    });
    expect(progress.experiments).toEqual({
      total: 5,
      kept: 1,
      reverted: 1,
      rejected: 1,
      invalid: 1,
      stopped: 1,
    });
    const detail = await engine().runs.get(summary.runId);
    expect(progress.dev).toEqual({
      baseline: detail.run.devBaseline,
      current: stored.filter((item) => item.disposition === 'kept').at(-1)?.devAfter,
    });
    const lessons = await engine().mentoring.lessons(summary.runId);
    const verified = lessons.filter((lesson) => lesson.status === 'verified');
    const byKind: Record<string, number> = {};
    for (const lesson of verified) byKind[lesson.kind] = (byKind[lesson.kind] ?? 0) + 1;
    expect(progress.lessons).toEqual({
      verified: verified.length,
      rejected: lessons.length - verified.length,
      byKind,
    });
    // What was spent is the experiments' own budgets; Spark's reference isn't the run's.
    expect(progress.spent.mentorUsd).toBeCloseTo(
      sum((item) => item.budget.mentorUsd),
      9,
    );
    expect(progress.spent.mentorUsd).toBeCloseTo(detail.run.totals.mentorUsd, 9);
    expect(progress.spent.attempts).toBe(sum((item) => item.budget.attempts));
    expect(progress.spent.minutes).toBeCloseTo(
      sum((item) => item.budget.minutes),
      9,
    );

    const breakdown = await engine().mentoring.capabilities(summary.runId);
    const card = await engine().reports.get(summary.runId);
    // Check is dev for the incumbent, as the latest experiment that measured it measured it.
    const latest = stored.filter((item) => item.measurements.length > 0).at(-1);
    expect(latest?.round).toBe(3);
    const incumbent = latest === undefined ? undefined : measured(latest, 'incumbent');
    for (const capability of breakdown.capabilities) {
      const checked = incumbent?.perType.find((item) => item.type === capability.type);
      expect(capability.check).toEqual({ pass: checked?.pass, total: checked?.total });
      const tested = card.test.perType.find((item) => item.type === capability.type);
      expect(capability.finalTest).toEqual({ pass: tested?.pass, total: tested?.total });
      expect(capability.installCheck).toBeNull();
      for (const category of capability.categories) {
        expect(category.verifiedLessons).toBe(
          verified.filter((lesson) => lesson.categoryId === category.id).length,
        );
      }
    }
    // Practice is round 5's train batch: refunds and order questions right, pickups wrong.
    expect(breakdown.capabilities.map(({ type, practice }) => [type, practice])).toEqual([
      ['refund', { pass: 4, total: 4 }],
      ['order', { pass: 4, total: 4 }],
      ['pickup', { pass: 0, total: 4 }],
    ]);
  });
});
