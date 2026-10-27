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
import { confirmKeep, decideKeep, formatScore, type KeepDecision, type Measurement } from './keep';
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

/** A whole-harness draft is kept as measured: one-shot's only harness, or a refined run's start. */
function draftDecision(state: RunState, before: Score, after: Score): KeepDecision {
  const scores = `Dev ${formatScore(before)} → ${formatScore(after)}`;
  return {
    keep: true,
    reason:
      state.run.method === 'one_shot'
        ? `${scores}; the one-shot method keeps its harness without a keep-or-revert check`
        : `${scores}; the first draft is kept as the starting point, and later rounds keep only measured gains`,
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

/**
 * One version on every dev task, under the seeds of the baseline (round null) or a round: the
 * job's repeats, or more when a round measures again.
 */
async function devEvaluation(
  state: RunState,
  version: number,
  round: number | null,
  runs = state.job.evaluation.devRepeats,
): Promise<EvaluationSpec> {
  return {
    tasks: await state.devTasks(),
    split: 'dev',
    round,
    version,
    seeds: devSeeds(state.record.seeds.devPanel, round, runs),
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
  const drafting = state.drafts(index);
  const round: Round = {
    runId: state.ctx.runId,
    index,
    status: drafting ? 'diagnosing' : 'attempting',
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
      phase: drafting ? 'diagnosing' : 'attempting',
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

/** A round's dev results for the incumbent and its candidate. */
interface DevPair {
  before: EvaluationResult;
  after: EvaluationResult;
}

function measurementOf(pair: DevPair): Measurement {
  return {
    before: pair.before.score,
    after: pair.after.score,
    beforePerType: pair.before.perType,
    afterPerType: pair.after.perType,
  };
}

/** Tokens of every author call the round paid for, a fix included, like its cost. */
function authorTokens(state: RunState, index: number) {
  const calls = state.ctx.store.costs
    .list(state.ctx.runId)
    .filter((cost) => cost.role === 'mentor' && cost.round === index);
  return {
    inputTokens: calls.reduce((sum, cost) => sum + cost.usage.inputTokens, 0),
    outputTokens: calls.reduce((sum, cost) => sum + cost.usage.outputTokens, 0),
  };
}

/**
 * Logs the hypothesis in lineage with its measured effect, and keeps or reverts it. `first` is
 * the first measurement when the round measured again; `pair` then adds up both.
 */
async function decide(
  state: RunState,
  stored: StoredRound,
  pair: DevPair,
  decision: KeepDecision,
  first?: DevPair,
): Promise<void> {
  const { before, after } = pair;
  const firstMeasurement = first && {
    devBefore: first.before.score,
    devAfter: first.after.score,
  };
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
      ...(firstMeasurement ? { firstMeasurement } : {}),
    },
    decision: decision.keep ? 'kept' : 'reverted',
    decisionReason: decision.reason,
    versionFrom: stored.baseVersion,
    versionTo: must(round.candidateVersion, 'The candidate version'),
    mentor: { model: reply.model, costUsd: round.costUsd, ...authorTokens(state, round.index) },
    at: state.now(),
  });
  const decided: Round = {
    ...round,
    status: 'decided',
    devBefore: entry.measured.devBefore,
    devAfter: entry.measured.devAfter,
    ...(firstMeasurement ? { firstMeasurement } : {}),
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
 * Both versions on dev under `runs` of the round's seeds, or null when the evaluation stopped
 * short. Runs already measured are reused, so a second measurement only adds the new seeds.
 */
async function measureRound(
  state: RunState,
  index: number,
  versions: { base: number; candidate: number },
  runs: number,
): Promise<DevPair | null> {
  const seeds = devSeeds(state.record.seeds.devPanel, index, runs);
  for (const version of [versions.base, versions.candidate]) {
    if (!(await evaluate(state, await devEvaluation(state, version, index, runs)))) return null;
    const result = state.devResult(version, index, seeds);
    state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  }
  return {
    before: state.devResult(versions.base, index, seeds),
    after: state.devResult(versions.candidate, index, seeds),
  };
}

/**
 * The incumbent and its candidate on dev, under the round's own seeds. The incumbent is measured
 * again rather than judged by the score that got it kept, which was the luckier of its draws. A
 * candidate that clears the keep limits is measured again, both versions under new seeds, and
 * kept only if it clears them over both measurements, so one lucky draw isn't enough (decision
 * 022).
 */
export async function evaluateCandidate(state: RunState, index: number): Promise<void> {
  state.setPhase('evaluating');
  const { baseVersion, round } = state.round(index);
  const versions = {
    base: baseVersion,
    candidate: must(round.candidateVersion, 'The candidate version'),
  };
  const { evaluation } = state.job;
  const runs = evaluation.devRepeats;
  const first = await measureRound(state, index, versions, runs);
  if (first === null) return;
  if (state.drafts(index)) {
    await decide(
      state,
      state.round(index),
      first,
      draftDecision(state, first.before.score, first.after.score),
    );
    return;
  }
  const decision = decideKeep({ ...measurementOf(first), evaluation, runs });
  if (!decision.keep) {
    await decide(state, state.round(index), first, decision);
    return;
  }
  state.log('info', `Round ${index} cleared the keep limits; measuring both versions again.`);
  const both = await measureRound(state, index, versions, 2 * runs);
  if (both === null) return;
  const confirmed = confirmKeep({
    first: measurementOf(first),
    both: measurementOf(both),
    evaluation,
    runs,
  });
  await decide(state, state.round(index), both, confirmed, first);
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
