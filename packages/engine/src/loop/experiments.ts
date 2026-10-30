import { createHash } from 'node:crypto';
import {
  type Decoding,
  type Experiment,
  type ExperimentBudget,
  type ExperimentDisposition,
  type ExperimentKind,
  type GateResult,
  type Measurement,
  type Score,
  type TypeScore,
} from '@architect/shared';
import { percentile } from '../report/report-card';
import type { EngineStore } from '../store/engine-store';
import { computeEnded, computeSoFar } from '../training/budget';
import type { TrainingDeps } from './deps';
import type { RunState } from './run-state';
import { roundSeed } from './seeds';

/** How a round ended, beside what the records already hold about it. */
export interface ExperimentOutcome {
  disposition: ExperimentDisposition;
  reason: string;
  measurements?: Measurement[];
  devBefore?: Score;
  devAfter?: Score;
  beforePerType?: readonly TypeScore[];
  afterPerType?: readonly TypeScore[];
  gates?: GateResult[];
  /** The dev seeds the decision used. */
  devSeeds?: readonly number[];
  decoding?: Decoding;
  /** An improvement's check that the student learned its lessons. */
  learned?: Experiment['learned'];
}

/** The experiment's id: one per round, the same however often a retry writes it. */
function experimentId(runId: string, round: number): string {
  return `exp_${createHash('sha256').update(`${runId}/${round}`).digest('hex').slice(0, 24)}`;
}

function perTypeChange(
  before: readonly TypeScore[],
  after: readonly TypeScore[],
): Experiment['perType'] {
  const types = [...new Set([...before, ...after].map((score) => score.type))];
  return types.map((type) => ({
    type,
    before: before.find((score) => score.type === type)?.pass ?? 0,
    after: after.find((score) => score.type === type)?.pass ?? 0,
  }));
}

/** What the round spent, line by line, from the cost ledger, the attempts and its training job. */
function budgetOf(state: RunState, round: number, trainingJobId: string | null): ExperimentBudget {
  const costs = state.ctx.store.costs.list(state.ctx.runId).filter((cost) => cost.round === round);
  const mentor = costs.filter((cost) => cost.role === 'mentor');
  const student = costs.filter((cost) => cost.role === 'student');
  const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);
  const attempts = state.ctx.store.attempts
    .list({ runId: state.ctx.runId, round })
    .filter((attempt) => attempt.split !== 'test');
  const job = trainingJobId === null ? null : state.ctx.deps.training?.worker.get(trainingJobId);
  const stored = state.round(round);
  const ended = Date.parse(stored.round.endedAt ?? state.now());
  // A job that hasn't stopped running, as after a stop during training, counts at the most it
  // can cost until it ends; `settleExperimentCompute` puts its own cost in then.
  const compute = job ? computeSoFar(job) : { usd: 0, seconds: 0, settled: true };
  return {
    mentorUsd: sum(mentor.map((cost) => cost.usd ?? 0)),
    mentorInputTokens: sum(mentor.map((cost) => cost.usage.inputTokens)),
    mentorOutputTokens: sum(mentor.map((cost) => cost.usage.outputTokens)),
    studentUsd: student.some((cost) => cost.usd === null)
      ? null
      : sum(student.map((cost) => cost.usd ?? 0)),
    studentInputTokens: sum(student.map((cost) => cost.usage.inputTokens)),
    studentOutputTokens: sum(student.map((cost) => cost.usage.outputTokens)),
    computeUsd: compute.usd,
    computeMinutes: compute.seconds / 60,
    ...(compute.settled ? {} : { computeSettled: false as const }),
    examples: job?.dataset.exampleCount ?? 0,
    trainedTokens: job ? (state.ctx.deps.training?.trainedTokens(job) ?? 0) : 0,
    attempts: attempts.length,
    minutes: Math.max(0, ended - Date.parse(stored.round.startedAt)) / 60_000,
  };
}

/**
 * Writes the experiment a round ends in (decision 042), whatever ended it: kept, reverted or
 * rejected after measurement, refused before it, or stopped. Its inputs, versions, recipe, seeds
 * and budget come from the stored round, intervention, lessons, attempts and training job, so
 * every number an evidence screen shows can be traced to them. Synchronous, so it joins the
 * transaction that decides the round.
 */
export function recordExperiment(
  state: RunState,
  index: number,
  outcome: ExperimentOutcome,
): Experiment {
  const { store, runId } = state.ctx;
  const stored = state.round(index);
  const { round } = stored;
  const intervention = store.interventions.get(runId, index);
  const trainingJobId = intervention?.trainingJobId ?? null;
  const job = trainingJobId === null ? null : state.ctx.deps.training?.worker.get(trainingJobId);
  const kind: ExperimentKind = round.draft
    ? 'draft'
    : intervention?.type === 'weights'
      ? 'weights'
      : 'harness';
  const before = outcome.beforePerType ?? [];
  const after = outcome.afterPerType ?? [];
  const perType = outcome.devAfter === undefined ? [] : perTypeChange(before, after);
  const experiment: Experiment = {
    id: experimentId(runId, index),
    runId,
    round: index,
    interventionId: intervention?.id ?? null,
    kind,
    title: round.title ?? intervention?.title ?? `Round ${index}`,
    inputs: {
      baseVersion: stored.baseVersion,
      candidateVersion: round.candidateVersion ?? null,
      incumbentAdapter: intervention?.parent.adapter ?? state.run.currentAdapter ?? null,
      candidateAdapter: round.candidateAdapter ?? null,
      lessonIds: store.lessons
        .list({ runId, round: index, status: 'verified' })
        .map((lesson) => lesson.id),
      datasetSha256: job?.dataset.sha256 ?? null,
      trainingJobId,
      trainingBackend: job?.label ?? null,
    },
    recipe: job?.recipe ?? null,
    seeds: {
      dev: [...(outcome.devSeeds ?? [])],
      train: round.train.total > 0 ? roundSeed(state.record.seeds.trainStudent, index) : null,
    },
    decoding: outcome.decoding ?? null,
    measurements: outcome.measurements ?? [],
    devBefore: outcome.devBefore ?? null,
    devAfter: outcome.devAfter ?? null,
    perType,
    regressions: perType.filter((change) => change.after < change.before),
    gates: outcome.gates ?? [],
    ...(outcome.learned === undefined ? {} : { learned: outcome.learned }),
    budget: budgetOf(state, index, trainingJobId),
    disposition: outcome.disposition,
    reason: outcome.reason,
    startedAt: round.startedAt,
    endedAt: round.endedAt ?? state.now(),
  };
  store.experiments.put(experiment);
  return experiment;
}

/**
 * Puts each training job's own compute into the experiments that recorded it at its whole
 * authorization because the job was still running when their round ended (decision 045), once
 * the job has stopped. Returns the experiments it rewrote. Nothing else in them changes.
 */
export function settleExperimentCompute(
  store: EngineStore,
  training: TrainingDeps | undefined,
  runId: string,
): Experiment[] {
  if (training === undefined) return [];
  const settled: Experiment[] = [];
  for (const experiment of store.experiments.list(runId)) {
    const jobId = experiment.inputs.trainingJobId;
    if (experiment.budget.computeSettled !== false || jobId === null) continue;
    const job = training.worker.get(jobId);
    if (!computeEnded(job)) continue;
    const { computeSettled: _unsettled, ...budget } = experiment.budget;
    const next: Experiment = {
      ...experiment,
      budget: {
        ...budget,
        computeUsd: job.compute.usd,
        computeMinutes: job.compute.seconds / 60,
      },
    };
    store.experiments.put(next);
    settled.push(next);
  }
  return settled;
}

/** A measurement as an experiment records it. */
export function measurement(
  label: string,
  configuration: Measurement['configuration'],
  result: { score: Score; perType: TypeScore[]; latencies: readonly number[] },
  seeds: readonly number[],
  provenance: string,
): Measurement {
  return {
    label,
    configuration,
    seeds: [...seeds],
    score: result.score,
    perType: result.perType,
    latencyMs: { p50: percentile(result.latencies, 50), p95: percentile(result.latencies, 95) },
    provenance,
  };
}
