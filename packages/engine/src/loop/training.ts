import {
  newId,
  type Round,
  type RunStopReason,
  type Score,
  type TypeScore,
} from '@architect/shared';
import type { StoredRound } from '../store/records';
import { resultOf, type EvaluationResult } from './attempts';
import { must } from './errors';
import { evaluate, type EvaluationSpec } from './evaluation';
import { decideKeep, formatScore, type KeepDecision } from './keep';
import { TRAINING_ENDED, trainingEnd, type RunState } from './run-state';
import { devSeeds, roundSeed } from './seeds';
import { startingHarness } from './setup';

function comparePerType(before: TypeScore[], after: TypeScore[]) {
  const types = [...new Set([...before, ...after].map((score) => score.type))];
  return types.map((type) => ({
    type,
    before: before.find((score) => score.type === type)?.pass ?? 0,
    after: after.find((score) => score.type === type)?.pass ?? 0,
  }));
}

function oneShotDecision(before: Score, after: Score): KeepDecision {
  return {
    keep: true,
    reason: `Dev ${formatScore(before)} → ${formatScore(after)}; the one-shot method keeps its harness without a keep-or-revert check`,
  };
}

/** Saves the first version: blank for the bare baseline, otherwise the job's starting harness. */
export async function prepare(state: RunState): Promise<void> {
  const { harness } = state.ctx.deps;
  const start =
    (await state.versions.latest()) ??
    (await state.versions.save(
      state.run.method === 'bare'
        ? harness.blankHarness(state.job.name, state.job.description)
        : await startingHarness(state.job, state.jobDir, harness),
    ));
  state.saveRun({ phase: 'baseline', currentVersion: start.meta.version });
}

/** One version on every dev task, under the seeds of the baseline (round null) or a round. */
async function devEvaluation(
  state: RunState,
  version: number,
  round: number | null,
): Promise<EvaluationSpec> {
  return {
    tasks: await state.devTasks(),
    split: 'dev',
    round,
    version,
    seeds: devSeeds(state.record.seeds.devPanel, round, state.job.evaluation.devRepeats),
    target: state.job.student.trainOn,
    purpose: 'training',
    concurrency: state.ctx.concurrency,
  };
}

/** The starting version on dev: where the dev curve starts and what the first round sees. */
export async function baseline(state: RunState): Promise<void> {
  state.setPhase('baseline');
  const version = state.run.currentVersion;
  if (!(await evaluate(state, await devEvaluation(state, version, null)))) return;
  const result = state.devResult(version, null);
  state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  state.saveRun({ devBaseline: result.score, devCurrent: result.score });
}

export function startRound(state: RunState, index: number): void {
  const oneShot = state.run.method === 'one_shot';
  const round: Round = {
    runId: state.ctx.runId,
    index,
    status: oneShot ? 'diagnosing' : 'attempting',
    train: { pass: 0, total: 0 },
    files: [],
    costUsd: 0,
    startedAt: state.now(),
  };
  const run = state.ctx.store.transaction(() => {
    state.ctx.store.rounds.insert({
      round,
      baseVersion: state.run.currentVersion,
      reply: null,
      hypothesis: null,
      rejected: false,
    });
    return state.writeRun((current) => ({
      phase: oneShot ? 'diagnosing' : 'attempting',
      totals: { ...current.totals, rounds: current.totals.rounds + 1 },
    }));
  });
  state.budget.recordRound();
  state.emit({ type: 'round.updated', round });
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
}

/** The round's train batch on the incumbent, the evidence the author diagnoses. */
export async function attemptTrain(state: RunState, index: number): Promise<void> {
  state.setPhase('attempting');
  const { baseVersion } = state.round(index);
  const complete = await evaluate(state, {
    tasks: await state.trainBatch(index),
    split: 'train',
    round: index,
    version: baseVersion,
    seeds: [roundSeed(state.record.seeds.trainStudent, index)],
    target: state.job.student.trainOn,
    purpose: 'training',
    concurrency: state.ctx.concurrency,
  });
  if (!complete) return;
  const stored = state.round(index);
  const train = resultOf(
    state.attempts({ split: 'train', round: index, version: baseVersion }),
    state.job,
  );
  state.saveRound({
    ...stored,
    round: { ...stored.round, status: 'diagnosing', train: train.score },
  });
}

/** Logs the hypothesis in lineage with its measured effect, and keeps or reverts it. */
async function decide(
  state: RunState,
  stored: StoredRound,
  before: EvaluationResult,
  after: EvaluationResult,
  decision: KeepDecision,
): Promise<void> {
  const { round } = stored;
  const hypothesis = must(stored.hypothesis, 'The hypothesis');
  const reply = must(stored.reply, 'The reply');
  const entry = await state.lineage.record({
    id: newId('chg'),
    runId: state.ctx.runId,
    round: round.index,
    title: hypothesis.title,
    diagnosis: hypothesis.diagnosis,
    files: round.files,
    causeTaskIds: hypothesis.causeTaskIds,
    predicted: hypothesis.predicted,
    measured: {
      devBefore: before.score,
      devAfter: after.score,
      delta: after.score.pass - before.score.pass,
      perType: comparePerType(before.perType, after.perType),
    },
    decision: decision.keep ? 'kept' : 'reverted',
    decisionReason: decision.reason,
    versionFrom: stored.baseVersion,
    versionTo: must(round.candidateVersion, 'The candidate version'),
    mentor: {
      model: reply.model,
      costUsd: round.costUsd,
      inputTokens: reply.usage.inputTokens,
      outputTokens: reply.usage.outputTokens,
    },
    at: state.now(),
  });
  const decided: Round = {
    ...round,
    status: 'decided',
    devBefore: entry.measured.devBefore,
    devAfter: entry.measured.devAfter,
    decision: entry.decision,
    decisionReason: entry.decisionReason,
    endedAt: state.now(),
  };
  const { store } = state.ctx;
  const run = store.transaction(() => {
    store.rounds.update({ ...stored, round: decided });
    store.lineage.insert({
      id: entry.id,
      runId: entry.runId,
      round: entry.round,
      title: entry.title,
      decision: entry.decision,
      delta: entry.measured.delta,
      versionFrom: entry.versionFrom,
      versionTo: entry.versionTo,
      at: entry.at,
    });
    return entry.decision === 'kept'
      ? state.writeRun({ currentVersion: entry.versionTo, devCurrent: entry.measured.devAfter })
      : null;
  });
  state.emit({ type: 'round.updated', round: decided });
  if (run) state.emit({ type: 'run.updated', run });
  state.log('info', `Round ${round.index} ${entry.decision}: ${entry.decisionReason}.`);
}

/**
 * The incumbent and its candidate on dev, under the round's own seeds. The incumbent is measured
 * again rather than judged by the score that got it kept, which was the luckier of its draws.
 */
export async function evaluateCandidate(state: RunState, index: number): Promise<void> {
  state.setPhase('evaluating');
  const { baseVersion, round } = state.round(index);
  const candidate = must(round.candidateVersion, 'The candidate version');
  for (const version of [baseVersion, candidate]) {
    if (!(await evaluate(state, await devEvaluation(state, version, index)))) return;
    const result = state.devResult(version, index);
    state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  }
  const before = state.devResult(baseVersion, index);
  const after = state.devResult(candidate, index);
  const decision =
    state.run.method === 'one_shot'
      ? oneShotDecision(before.score, after.score)
      : decideKeep({
          before: before.score,
          after: after.score,
          beforePerType: before.perType,
          afterPerType: after.perType,
          evaluation: state.job.evaluation,
        });
  await decide(state, state.round(index), before, after, decision);
}

export function abandonRound(state: RunState, index: number, reason: string): void {
  const stored = state.round(index);
  state.saveRound({
    ...stored,
    round: { ...stored.round, status: 'failed', error: reason, endedAt: state.now() },
  });
  state.log('info', `Round ${index}: ${reason}`);
}

/** Hands the run to its locked test, or ends it when a stop came before anything was kept. */
export function finishTraining(state: RunState, reason: RunStopReason | undefined): void {
  const kept = state.rounds().some(({ round }) => round.decision === 'kept');
  if (reason === 'user' && !kept) {
    state.saveRun({ status: 'stopped', phase: 'done', stopReason: 'user', endedAt: state.now() });
    state.log('info', 'Stopped before any change was kept, so there is no graduate to test.');
    return;
  }
  state.saveRun(trainingEnd(reason));
  state.log('info', TRAINING_ENDED[reason ?? 'complete']);
}
