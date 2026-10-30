import {
  newId,
  TraceSchema,
  type GateResult,
  type Harness,
  type Intervention,
  type Measurement as RecordedMeasurement,
  type Round,
  type RunStopReason,
  type Score,
  type TrainedAdapter,
  type TypeScore,
} from '@architect/shared';
import { improvementHarness, improvementLessons } from '../improve/improvement';
import type { StoredRound } from '../store/records';
import { resultOf, type EvaluationResult } from './attempts';
import { configurationKey, LLAMA_CPP, llamaCppConfig, type AttemptConfig } from './configuration';
import { must } from './errors';
import { evaluate, type EvaluationSpec } from './evaluation';
import { measurement, recordExperiment, settleExperimentCompute } from './experiments';
import { readJsonFile } from './files';
import {
  confirmKeep,
  decideKeep,
  decideLearned,
  formatScore,
  isHarmful,
  type KeepDecision,
  type LearnedTask,
  type Measurement,
} from './keep';
import { percentile } from '../report/report-card';
import { menuOf, nothingToTry } from './menu';
import { TRAINING_ENDED, trainingEnd, type RunState } from './run-state';
import { deriveSeed, devSeeds, roundSeed, sampleTrainBatch } from './seeds';
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
function draftDecision(
  state: RunState,
  before: Score,
  after: Score,
  adopted: boolean,
): KeepDecision {
  const scores = `Dev ${formatScore(before)} → ${formatScore(after)}`;
  if (adopted) {
    return {
      keep: true,
      reason: `${scores}; the comparison's harness is adopted whatever it scores, as a shared draft is`,
    };
  }
  return {
    keep: true,
    reason:
      state.run.method === 'one_shot'
        ? `${scores}; the one-shot method keeps its harness without a keep-or-revert check`
        : `${scores}; the first draft is kept as the starting point, and later rounds keep only measured gains`,
  };
}

/**
 * Saves the first version: blank for the bare baseline, the starting version's own harness for
 * an improvement, otherwise the job's starting harness.
 */
export async function prepare(state: RunState): Promise<void> {
  const start = (await state.versions.latest()) ?? (await state.versions.save(await first(state)));
  state.saveRun({ phase: 'baseline', currentVersion: start.meta.version });
  // Said before the baseline, which is the student on every check task: a run whose mentor may
  // change nothing has no use for it. A comparison's adopted harness and its one-shot adapter are
  // the runner's own plan, so the mentor is not asked there.
  const planned = adopts(state, 1) || isOneShotAdapter(state);
  const idle = planned ? null : await nothingToTry(state, 1);
  if (idle !== null) finishTraining(state, 'nothing_to_try', idle);
}

async function first(state: RunState): Promise<Harness> {
  const { harness } = state.ctx.deps;
  if (state.record.improves !== undefined) return improvementHarness(state);
  return state.run.method === 'bare'
    ? harness.blankHarness(state.job.name, state.job.description)
    : startingHarness(state.job, state.jobDir, harness);
}

/**
 * One version on every dev task, under the seeds of the baseline (round null) or a round: the
 * job's repeats, or more when a round measures again. The incumbent's configuration unless one
 * is named: the job's student, or llama.cpp with the run's kept adapter.
 */
async function devEvaluation(
  state: RunState,
  version: number,
  round: number | null,
  runs = state.job.evaluation.devRepeats,
  config: AttemptConfig = state.incumbentConfig(),
): Promise<EvaluationSpec> {
  return {
    tasks: await state.devTasks(),
    split: 'dev',
    round,
    version,
    seeds: devSeeds(state.record.seeds.devPanel, round, runs),
    target: state.targetOf(config),
    purpose: 'training',
    concurrency: state.ctx.concurrency,
    config,
  };
}

/** The starting version on dev: where the dev curve starts and what the first round sees. */
export async function baseline(state: RunState): Promise<void> {
  state.setPhase('baseline');
  const version = state.run.currentVersion;
  if (!(await evaluate(state, await devEvaluation(state, version, null)))) return;
  const result = state.devResult(version, null, undefined, state.incumbentConfig());
  state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  state.saveRun({ devBaseline: result.score, devCurrent: result.score });
}

/** The title an adopted harness's round carries, so the decision and reports can name it. */
export const ADOPTED_TITLE = 'Adopt the comparison harness';

/** The protocol plans one adapter itself in place of the mentor's choice, for every round. */
function isOneShotAdapter(state: RunState): boolean {
  return state.record.protocol?.oneShotAdapter !== undefined;
}

/** The round adopts the protocol's harness: the first round of a run whose protocol names one. */
function adopts(state: RunState, index: number): boolean {
  return state.record.protocol?.adopt !== undefined && index === 1;
}

/**
 * The first round of a run whose protocol names a harness to adopt (decision 045): that harness,
 * saved as the round's candidate and measured on dev like a draft, which is kept whatever it
 * scores. Nobody wrote it this round, so it costs no mentor call; its record says where it came
 * from.
 */
async function adoptRound(state: RunState, index: number): Promise<void> {
  const { deps } = state.ctx;
  const folder = must(state.record.protocol?.adopt, 'The harness to adopt');
  const base = state.run.currentVersion;
  const from = await state.resources.harness(base);
  const adopted = await state.versions.save(
    await deps.harness.importHarness(state.ctx.paths.fromStored(folder)),
    base,
  );
  const changed = deps.harness.diffHarness(from, adopted).map((diff) => diff.path);
  const files = deps.harness.harnessToFiles(adopted);
  const edits = changed
    .filter((path) => files[path] !== undefined)
    .slice(0, 16)
    .map((path) => ({ op: 'write' as const, path, content: files[path] ?? '' }));
  const diagnosis = `The harness in ${folder}, frozen by another arm of this comparison, adopted whole as this run's H1, so its adapters are measured on both harnesses.`;
  const round: Round = {
    runId: state.ctx.runId,
    index,
    draft: true,
    status: 'evaluating',
    train: { pass: 0, total: 0 },
    title: ADOPTED_TITLE,
    diagnosis,
    files: changed,
    candidateVersion: adopted.meta.version,
    costUsd: 0,
    startedAt: state.now(),
  };
  const run = state.ctx.store.transaction(() => {
    state.ctx.store.rounds.insert({
      round,
      baseVersion: base,
      reply: {
        text: diagnosis,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        model: 'adopted',
        latencyMs: 0,
        fix: 0,
      },
      hypothesis: {
        title: ADOPTED_TITLE,
        diagnosis,
        edits:
          edits.length > 0 ? edits : [{ op: 'write', path: 'AGENTS.md', content: adopted.system }],
        causeTaskIds: [],
        predicted: { devDeltaMin: 0, devDeltaMax: 0, rationale: 'Adopted, not predicted.' },
        readyClaim: false,
      },
      rejected: false,
    });
    return state.writeRun((current) => ({
      phase: 'evaluating',
      totals: { ...current.totals, rounds: current.totals.rounds + 1 },
    }));
  });
  state.budget.recordRound();
  state.emit({ type: 'round.updated', round });
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
}

/**
 * A one-shot adapter's round (decision 045): verified demonstrations of a seeded sample of train
 * tasks, chosen before any attempt and never from a failure, then one training job. Its
 * intervention is the runner's, not an author's: no mentor call decides it. A run that can't
 * train weights here ends the round as invalid with the menu's reason.
 */
async function oneShotRound(state: RunState, index: number): Promise<void> {
  const { store, runId } = state.ctx;
  const perType = must(state.record.protocol?.oneShotAdapter, 'The one-shot adapter').perType;
  const types = new Set((await state.trainTasks()).map((task) => task.type)).size;
  const sample = sampleTrainBatch(
    await state.trainTasks(),
    perType * types,
    deriveSeed(state.record.seeds.trainBatch, 'one-shot-adapter'),
  );
  const round: Round = {
    runId,
    index,
    status: 'teaching',
    train: { pass: 0, total: 0 },
    title: 'One-shot adapter from verified demonstrations',
    files: [],
    costUsd: 0,
    startedAt: state.now(),
  };
  const intervention: Intervention = {
    id: newId('itv'),
    runId,
    round: index,
    type: 'weights',
    title: round.title ?? 'One-shot adapter',
    hypothesis: `Verified demonstrations of ${sample.length} train tasks, ${perType} of each type, chosen by seed before any attempt, teach the student through one adapter.`,
    findings: [],
    setAside: [],
    edits: [],
    workedExamples: [],
    practicePerFinding: 0,
    predicted: { devDeltaMin: 0, devDeltaMax: 0, rationale: 'One-shot: measured, not predicted.' },
    estimatedCost: { mentorUsd: 0, computeUsd: 0, minutes: 0 },
    verificationPlan:
      'Each demonstration passes the checker and the mutation audit; the adapter is measured in four configurations on one llama-server.',
    parent: { harnessVersion: state.run.currentVersion, adapter: state.run.currentAdapter ?? null },
    status: 'accepted',
    teaching: {
      items: sample.map((task) => ({ kind: 'demonstration' as const, taskId: task.id })),
      skipped: [],
    },
    createdAt: state.now(),
  };
  const run = store.transaction(() => {
    store.rounds.insert({
      round,
      baseVersion: state.run.currentVersion,
      // The runner's own plan, recorded as the round's reply so its lineage entry says who chose it.
      reply: {
        text: intervention.hypothesis,
        usage: { inputTokens: 0, outputTokens: 0 },
        costUsd: 0,
        model: 'one-shot',
        latencyMs: 0,
        fix: 0,
      },
      hypothesis: {
        title: intervention.title,
        diagnosis: intervention.hypothesis,
        edits: [],
        causeTaskIds: [],
        predicted: intervention.predicted,
        readyClaim: false,
        intervention: {
          type: 'weights',
          hypothesis: intervention.hypothesis,
          workedExamples: [],
          practicePerFinding: 0,
          question: '',
          estimatedCost: intervention.estimatedCost,
          verificationPlan: intervention.verificationPlan,
        },
      },
      rejected: false,
    });
    store.interventions.put(intervention);
    return state.writeRun((current) => ({
      phase: 'teaching',
      totals: { ...current.totals, rounds: current.totals.rounds + 1 },
    }));
  });
  state.budget.recordRound();
  state.emit({ type: 'round.updated', round });
  state.emit({ type: 'run.updated', run });
  state.emitBudget();
  state.announce('intervention', intervention.id, index);
  const menu = await menuOf(state);
  if (!menu.allowed.includes('weights')) {
    state.closeRound(
      index,
      `A one-shot adapter can't be trained in this run: ${menu.refused.weights ?? 'weights are off the menu.'}`,
      undefined,
      'invalid',
    );
  }
}

export async function startRound(state: RunState, index: number): Promise<void> {
  if (adopts(state, index)) {
    await adoptRound(state, index);
    return;
  }
  if (isOneShotAdapter(state)) {
    await oneShotRound(state, index);
    return;
  }
  const idle = await nothingToTry(state, index);
  if (idle !== null) {
    finishTraining(state, 'nothing_to_try', idle);
    return;
  }
  const drafting = state.drafts(index);
  const round: Round = {
    runId: state.ctx.runId,
    index,
    ...(drafting ? { draft: true as const } : {}),
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
  const config = state.incumbentConfig();
  const complete = await evaluate(state, {
    tasks: await state.trainBatch(index),
    split: 'train',
    round: index,
    version: baseVersion,
    seeds: [roundSeed(state.record.seeds.trainStudent, index)],
    target: state.targetOf(config),
    purpose: 'training',
    concurrency: state.ctx.concurrency,
    config,
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

/** How a measured round ended, for its lineage entry, the run and its experiment. */
interface Verdict {
  decision: KeepDecision;
  disposition: 'kept' | 'reverted' | 'rejected';
  gates: GateResult[];
  measurements: RecordedMeasurement[];
  /** The dev seeds the decision used. */
  seeds: readonly number[];
  /** A kept adapter becomes the run's. */
  adapter?: TrainedAdapter;
  /** An improvement's check that the student learned its lessons. */
  learned?: LearnedTask[];
}

/**
 * Logs the change in lineage with its measured effect, keeps or reverts it, and records the
 * round's experiment, all in one transaction. `first` is the first measurement when the round
 * measured again; `pair` then adds up both.
 */
async function decide(
  state: RunState,
  stored: StoredRound,
  pair: DevPair,
  verdict: Verdict,
  first?: DevPair,
): Promise<void> {
  const { before, after } = pair;
  const { decision } = verdict;
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
  const { decoding } = await state.resources.harness(entry.versionTo);
  const { run, experiment } = store.transaction(() => {
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
    const recorded = recordExperiment(state, round.index, {
      disposition: verdict.disposition,
      reason: entry.decisionReason,
      measurements: verdict.measurements,
      devBefore: before.score,
      devAfter: after.score,
      beforePerType: before.perType,
      afterPerType: after.perType,
      gates: verdict.gates,
      devSeeds: verdict.seeds,
      decoding,
      ...(verdict.learned === undefined ? {} : { learned: verdict.learned }),
    });
    const kept = entry.decision === 'kept';
    return {
      experiment: recorded,
      run: kept
        ? state.writeRun({
            currentVersion: entry.versionTo,
            devCurrent: entry.measured.devAfter,
            ...(verdict.adapter === undefined ? {} : { currentAdapter: verdict.adapter }),
          })
        : null,
    };
  });
  state.emit({ type: 'round.updated', round: decided });
  state.announce('experiment', experiment.id, round.index);
  if (run) state.emit({ type: 'run.updated', run });
  state.log('info', `Round ${round.index} ${verdict.disposition}: ${entry.decisionReason}.`);
}

/** A configuration's dev attempts in a round under some of its seeds. */
function devAttempts(
  state: RunState,
  version: number,
  round: number | null,
  seeds: readonly number[],
  config: AttemptConfig,
) {
  return state
    .attempts({
      split: 'dev',
      version,
      round,
      target: state.targetOf(config),
      config: configurationKey(config),
    })
    .filter((attempt) => seeds.includes(attempt.seed));
}

/** One configuration's measurement, as an experiment records it. */
function recorded(
  state: RunState,
  label: string,
  version: number,
  round: number | null,
  seeds: readonly number[],
  config: AttemptConfig,
  provenance: string,
): RecordedMeasurement {
  const result = state.devResult(version, round, seeds, config);
  const latencies = devAttempts(state, version, round, seeds, config).map(
    (attempt) => attempt.latencyMs,
  );
  return measurement(
    label,
    {
      harnessVersion: version,
      actor: config.actor,
      backend: config.backend === 'job' ? state.studentBackend() : config.backend,
      adapter: config.adapter,
    },
    { ...result, latencies },
    seeds,
    provenance,
  );
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
  const config = state.incumbentConfig();
  for (const version of [versions.base, versions.candidate]) {
    if (!(await evaluate(state, await devEvaluation(state, version, index, runs, config)))) {
      return null;
    }
    const result = state.devResult(version, index, seeds, config);
    state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  }
  return {
    before: state.devResult(versions.base, index, seeds, config),
    after: state.devResult(versions.candidate, index, seeds, config),
  };
}

/**
 * A draft on dev under the round's seeds. It is kept whatever it scores, so the incumbent isn't
 * measured again: the run's baseline, the same harness, stands as the score before it.
 */
async function measureDraft(
  state: RunState,
  index: number,
  versions: { base: number; candidate: number },
  runs: number,
): Promise<DevPair | null> {
  const seeds = devSeeds(state.record.seeds.devPanel, index, runs);
  if (!(await evaluate(state, await devEvaluation(state, versions.candidate, index, runs)))) {
    return null;
  }
  const after = state.devResult(versions.candidate, index, seeds);
  state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: versions.candidate, ...after });
  return { before: state.devResult(versions.base, null), after };
}

/** Files a job lets the agent change: its writable data files, and `output/` when it has one. */
function writablePaths(state: RunState): (path: string) => boolean {
  const writable = new Set(
    state.job.data.files
      .filter((file) => file.access === 'write')
      .map((file) => `data/${file.name}`),
  );
  const output = state.job.data.output !== undefined;
  return (path) => writable.has(path) || (output && path.startsWith('output/'));
}

/**
 * The hard gates a candidate must pass whatever dev gained (spec section 7): every file its dev
 * attempts changed is one the job lets the agent change, their 95th-percentile latency is within
 * the job's limit when it sets one, and a stand-in adapter, which no model trained, is never kept.
 */
async function hardGates(
  state: RunState,
  index: number,
  version: number,
  seeds: readonly number[],
  config: AttemptConfig,
  adapter?: TrainedAdapter,
): Promise<GateResult[]> {
  const attempts = devAttempts(state, version, index, seeds, config);
  const allowed = writablePaths(state);
  const outside = new Set<string>();
  for (const attempt of attempts) {
    if (attempt.tracePath === null) continue;
    const trace = TraceSchema.parse(
      await readJsonFile(state.ctx.paths.fromStored(attempt.tracePath)),
    );
    for (const change of trace.changes ?? []) if (!allowed(change.path)) outside.add(change.path);
  }
  const gates: GateResult[] = [
    outside.size === 0
      ? {
          gate: 'permission',
          passed: true,
          detail: 'Every change was to a file the job lets it change.',
        }
      : {
          gate: 'permission',
          passed: false,
          detail: `Its dev attempts changed ${[...outside].sort().join(', ')}, which the job doesn't let the agent change`,
        },
  ];
  const limit = state.job.requirements.p95LatencyMs;
  const p95 = percentile(
    attempts.map((attempt) => attempt.latencyMs),
    95,
  );
  gates.push(
    limit === undefined
      ? { gate: 'device', passed: true, detail: 'The job sets no latency limit.' }
      : p95 <= limit
        ? {
            gate: 'device',
            passed: true,
            detail: `95% of dev answers within ${p95} ms of the ${limit} ms limit.`,
          }
        : {
            gate: 'device',
            passed: false,
            detail: `Its slowest 5% of dev answers took ${p95} ms, past the job's ${limit} ms limit`,
          },
  );
  if (adapter !== undefined) {
    gates.push(
      adapter.standIn
        ? {
            gate: 'stand_in',
            passed: false,
            detail: `Its adapter came from the stand-in backend (${adapter.label}), which trains nothing, so it is never kept`,
          }
        : { gate: 'stand_in', passed: true, detail: `Trained on ${adapter.label}.` },
    );
  }
  return gates;
}

/**
 * The verdict on a measured change: kept when the keep rule says so and every hard gate passes;
 * rejected when it was harmful or failed a gate, with the gate's own reason; else reverted.
 */
function verdictOf(
  decision: KeepDecision,
  harmful: boolean,
  gates: GateResult[],
): Pick<Verdict, 'decision' | 'disposition'> {
  const failed = gates.find((gate) => !gate.passed);
  if (failed !== undefined) {
    return {
      decision: {
        keep: false,
        reason: decision.keep ? `${decision.reason}, but ${failed.detail}` : decision.reason,
      },
      disposition: 'rejected',
    };
  }
  if (decision.keep) return { decision, disposition: 'kept' };
  return { decision, disposition: harmful ? 'rejected' : 'reverted' };
}

/**
 * An improvement's check that the student learned its lessons (decision 066): the round's train
 * tasks of its lessons' types that the incumbent failed, attempted again by the student with the
 * change (`version` under `config`). Null when the attempts stopped short.
 */
async function learnedCheck(
  state: RunState,
  index: number,
  version: number,
  config: AttemptConfig,
): Promise<LearnedTask[] | null> {
  const types = new Set(
    improvementLessons(state).flatMap(({ proposal }) => proposal.taskType ?? []),
  );
  const incumbent = state.incumbentConfig();
  const failed = new Set(
    state
      .attempts({
        split: 'train',
        round: index,
        version: state.round(index).baseVersion,
        target: state.targetOf(incumbent),
        config: configurationKey(incumbent),
      })
      .filter((attempt) => !attempt.check.pass)
      .map((attempt) => attempt.taskId),
  );
  const tasks = (await state.trainBatch(index)).filter(
    (task) => types.has(task.type) && failed.has(task.id),
  );
  const spec: EvaluationSpec = {
    tasks,
    split: 'train',
    round: index,
    version,
    seeds: [roundSeed(state.record.seeds.trainStudent, index)],
    target: state.targetOf(config),
    purpose: 'training',
    concurrency: state.ctx.concurrency,
    config,
  };
  if (tasks.length > 0 && !(await evaluate(state, spec))) return null;
  const passed = new Set(
    state
      .attempts({
        split: 'train',
        round: index,
        version,
        target: spec.target,
        config: configurationKey(config),
      })
      .filter((attempt) => attempt.check.pass)
      .map((attempt) => attempt.taskId),
  );
  return tasks.map((task) => ({ taskId: task.id, type: task.type, pass: passed.has(task.id) }));
}

/** The version the run measured at its baseline: the reference harness H0 an adapter is tried on. */
function referenceVersion(state: RunState, fallback: number): number {
  return state.attempts({ split: 'dev', round: null })[0]?.harnessVersion ?? fallback;
}

/** One configuration a weights round measures: a harness version with an adapter, or none. */
interface Cell {
  version: number;
  config: AttemptConfig;
}

/** The cells in measuring order, each once, grouped by the adapter applied. */
function distinctCells(cells: readonly Cell[]): Cell[] {
  const seen = new Set<string>();
  return cells.filter((cell) => {
    const key = `${cell.version}|${configurationKey(cell.config)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The reduced adapter protocol's check of a one-shot adapter (decision 051): the round's harness
 * with the adapter on a few train tasks, on the llama-server its locked test will use, instead of
 * four configurations on dev. It checks that the adapter loads and the student still works with
 * it, every attempt ending without an error, not what it adds: the adapter is kept unless the
 * check or a hard gate fails, and its locked test measures it with and without the adapter. It
 * changes no harness and measures nothing on dev, so it writes an experiment and no lineage entry.
 */
async function smokeAdapter(state: RunState, index: number, count: number): Promise<void> {
  const { store, runId } = state.ctx;
  const stored = state.round(index);
  const candidate = must(stored.round.candidateAdapter, 'The candidate adapter');
  const h1 = stored.baseVersion;
  const a1 = llamaCppConfig([candidate], candidate);
  const taught = new Set(
    (store.interventions.get(runId, index)?.teaching?.items ?? []).flatMap((item) =>
      item.kind === 'demonstration' ? [item.taskId] : [],
    ),
  );
  const train = await state.trainTasks();
  const untaught = train.filter((task) => !taught.has(task.id));
  const tasks = sampleTrainBatch(
    untaught.length >= count ? untaught : train,
    count,
    deriveSeed(state.record.seeds.trainBatch, `smoke-${index}`),
  );
  const seed = roundSeed(state.record.seeds.trainStudent, index);
  const spec: EvaluationSpec = {
    tasks,
    split: 'train',
    round: index,
    version: h1,
    seeds: [seed],
    target: 'local',
    purpose: 'training',
    concurrency: 1,
    config: a1,
  };
  if (!(await evaluate(state, spec))) return;
  const attempts = state
    .attempts({
      split: 'train',
      round: index,
      version: h1,
      target: 'local',
      config: configurationKey(a1),
    })
    .filter((attempt) => attempt.seed === seed);
  const result = resultOf(attempts, state.job);
  const broken = attempts.filter((attempt) => attempt.stopReason === 'error').length;
  const scored = `${result.score.pass} of ${result.score.total} passed the checker`;
  const gates: GateResult[] = [
    candidate.standIn
      ? {
          gate: 'stand_in',
          passed: false,
          detail: `Its adapter came from the stand-in backend (${candidate.label}), which trains nothing, so it is never kept`,
        }
      : { gate: 'stand_in', passed: true, detail: `Trained on ${candidate.label}.` },
    broken === 0
      ? {
          gate: 'smoke',
          passed: true,
          detail: `${attempts.length} train tasks on llama-server with the adapter all ended without an error; ${scored}.`,
        }
      : {
          gate: 'smoke',
          passed: false,
          detail: `${broken} of ${attempts.length} train tasks on llama-server with the adapter ended in an error, so it isn't kept`,
        },
  ];
  const failed = gates.find((gate) => !gate.passed);
  const kept = failed === undefined;
  const reason = kept
    ? `Smoke check on ${attempts.length} train tasks: ${scored}, none ended in an error. A one-shot adapter is kept as measured; the reduced protocol takes no dev measurement, and its locked test measures the harness with and without the adapter`
    : failed.detail;
  const smoke = {
    ...measurement(
      'H1/A1 smoke check',
      { harnessVersion: h1, actor: 'student', backend: LLAMA_CPP, adapter: a1.adapter },
      { ...result, latencies: attempts.map((attempt) => attempt.latencyMs) },
      [seed],
      'A smoke check on train tasks before the locked test, not a dev measurement.',
    ),
    split: 'train' as const,
  };
  const decided: Round = {
    ...stored.round,
    status: 'decided',
    decision: kept ? 'kept' : 'reverted',
    decisionReason: reason,
    endedAt: state.now(),
  };
  const { decoding } = await state.resources.harness(h1);
  const { run, experiment } = store.transaction(() => {
    store.rounds.update({ ...stored, round: decided });
    return {
      experiment: recordExperiment(state, index, {
        disposition: kept ? 'kept' : 'rejected',
        reason,
        measurements: [smoke],
        gates,
        decoding,
      }),
      run: kept ? state.writeRun({ currentAdapter: candidate }) : null,
    };
  });
  state.emit({ type: 'round.updated', round: decided });
  state.announce('experiment', experiment.id, index);
  if (run) state.emit({ type: 'run.updated', run });
  state.log('info', `Round ${index} ${kept ? 'kept' : 'rejected'}: ${reason}.`);
}

/**
 * A weights round's candidate: the adapter it trained, on the incumbent harness. Every
 * configuration runs on one llama-server, with the same base and decoding, grouped by adapter so
 * a scale change doesn't clear the server's prompt cache between requests. The four
 * configurations are the reference harness H0 and the round's harness H1, each with the base
 * alone (A0, no adapter applied, whatever the run kept before) and with the candidate (A1). The
 * keep rule compares the candidate (H1/A1) with the incumbent as it runs: H1/A0, or H1 with the
 * adapter the run kept, measured as its own configuration. When the first measurement clears the
 * limits, every configuration is measured again on the new seeds, so all of them cover the same
 * seeds and their paired counts hold. When the run kept no harness change, H0 is H1, and each of
 * those measurements stands for both, so labelled. A one-shot adapter is kept as measured, as a
 * one-shot harness is, unless a hard gate fails.
 */
async function evaluateAdapter(state: RunState, index: number): Promise<void> {
  const smokeTasks = state.record.protocol?.oneShotAdapter?.smokeTasks;
  if (smokeTasks !== undefined) {
    await smokeAdapter(state, index, smokeTasks);
    return;
  }
  const stored = state.round(index);
  const candidate = must(stored.round.candidateAdapter, 'The candidate adapter');
  const incumbent = state.run.currentAdapter ?? null;
  const loaded = incumbent === null ? [candidate] : [incumbent, candidate];
  const a0 = llamaCppConfig(loaded, null);
  const a1 = llamaCppConfig(loaded, candidate);
  const kept = incumbent === null ? a0 : llamaCppConfig(loaded, incumbent);
  const h1 = stored.baseVersion;
  const h0 = referenceVersion(state, h1);
  const { evaluation } = state.job;
  const runs = evaluation.devRepeats;
  const oneShot = state.record.protocol?.oneShotAdapter !== undefined;
  const cells = distinctCells([
    { version: h1, config: kept },
    { version: h1, config: a0 },
    { version: h0, config: a0 },
    { version: h1, config: a1 },
    { version: h0, config: a1 },
  ]);
  const measureAll = async (count: number): Promise<boolean> => {
    for (const cell of cells) {
      const spec = await devEvaluation(state, cell.version, index, count, cell.config);
      if (!(await evaluate(state, spec))) return false;
    }
    return true;
  };
  if (!(await measureAll(runs))) return;
  const seeds = devSeeds(state.record.seeds.devPanel, index, runs);
  const pairOf = (measured: readonly number[]): DevPair => ({
    before: state.devResult(h1, index, measured, kept),
    after: state.devResult(h1, index, measured, a1),
  });
  const first = pairOf(seeds);
  // An improvement keeps an adapter the student learned from and that held dev (decision 066).
  const learned =
    state.record.improves === undefined ? undefined : await learnedCheck(state, index, h1, a1);
  if (learned === null) return;
  let decision: KeepDecision = oneShot
    ? {
        keep: true,
        reason: `Dev ${formatScore(first.before.score)} → ${formatScore(first.after.score)}; a one-shot adapter is kept as measured, as a one-shot harness is`,
      }
    : learned !== undefined
      ? decideLearned({ ...measurementOf(first), evaluation, runs, learned })
      : decideKeep({ ...measurementOf(first), evaluation, runs });
  let pair = first;
  let usedSeeds: readonly number[] = seeds;
  let confirmed = false;
  if (decision.keep && !oneShot && learned === undefined) {
    state.log(
      'info',
      `Round ${index} cleared the keep limits; measuring every configuration again.`,
    );
    if (!(await measureAll(2 * runs))) return;
    usedSeeds = devSeeds(state.record.seeds.devPanel, index, 2 * runs);
    pair = pairOf(usedSeeds);
    decision = confirmKeep({
      first: measurementOf(first),
      both: measurementOf(pair),
      evaluation,
      runs,
    });
    confirmed = true;
  }
  const measured = `Measured in this round${confirmed ? ', and again on new seeds when it cleared the keep limits' : ''}.`;
  const same = 'The same configuration: the run had kept no harness change, so H0 is H1.';
  const cell = (label: string, version: number, config: AttemptConfig, provenance = measured) =>
    recorded(state, label, version, index, usedSeeds, config, provenance);
  const measurements = [
    ...(kept === a0
      ? []
      : [
          cell('incumbent', h1, kept, `${measured} The incumbent as it runs, its kept adapter on.`),
        ]),
    cell('H1/A0', h1, a0),
    cell('H1/A1', h1, a1),
    h0 === h1 ? cell('H0/A0', h1, a0, same) : cell('H0/A0', h0, a0),
    h0 === h1 ? cell('H0/A1', h1, a1, same) : cell('H0/A1', h0, a1),
  ];
  const gates = await hardGates(state, index, h1, usedSeeds, a1, candidate);
  const harmful =
    !oneShot &&
    isHarmful({
      ...measurementOf(pair),
      evaluation,
      runs: confirmed ? 2 * runs : runs,
    });
  await decide(
    state,
    state.round(index),
    pair,
    {
      ...verdictOf(decision, harmful, gates),
      gates,
      measurements,
      seeds: usedSeeds,
      adapter: candidate,
      ...(learned === undefined ? {} : { learned }),
    },
    confirmed ? first : undefined,
  );
}

/**
 * The incumbent and its candidate on dev, under the round's own seeds. The incumbent is measured
 * again rather than judged by the score that got it kept, which was the luckier of its draws. A
 * candidate that clears the keep limits is measured again, both versions under new seeds, and
 * kept only if it clears them over both measurements, so one lucky draw isn't enough (decision
 * 022), and only if it passes the hard gates. A round that trained an adapter is measured in four
 * configurations instead.
 */
export async function evaluateCandidate(state: RunState, index: number): Promise<void> {
  state.setPhase('evaluating');
  const { baseVersion, round } = state.round(index);
  if (round.candidateAdapter !== undefined) {
    await evaluateAdapter(state, index);
    return;
  }
  const versions = {
    base: baseVersion,
    candidate: must(round.candidateVersion, 'The candidate version'),
  };
  const { evaluation } = state.job;
  const runs = evaluation.devRepeats;
  const config = state.incumbentConfig();
  const seeds = devSeeds(state.record.seeds.devPanel, index, runs);
  if (state.drafts(index)) {
    const draft = await measureDraft(state, index, versions, runs);
    if (draft === null) return;
    await decide(state, state.round(index), draft, {
      decision: draftDecision(state, draft.before.score, draft.after.score, adopts(state, index)),
      disposition: 'kept',
      gates: [],
      measurements: [
        recorded(
          state,
          'incumbent',
          versions.base,
          null,
          devSeeds(state.record.seeds.devPanel, null, runs),
          config,
          "The run's baseline: a draft is kept whatever it scores.",
        ),
        recorded(
          state,
          'candidate',
          versions.candidate,
          index,
          seeds,
          config,
          'Measured in this round.',
        ),
      ],
      seeds,
    });
    return;
  }
  const first = await measureRound(state, index, versions, runs);
  if (first === null) return;
  const label = (both: boolean) =>
    both ? 'Measured in this round, and again on new seeds.' : 'Measured in this round.';
  if (state.record.improves !== undefined) {
    // An improvement keeps a change the student learned from and that held dev (decision 066),
    // measured once: it asks for no gain, so there is no lucky draw to measure again.
    const learned = await learnedCheck(state, index, versions.candidate, config);
    if (learned === null) return;
    const measured = { ...measurementOf(first), evaluation, runs };
    const gates = await hardGates(state, index, versions.candidate, seeds, config);
    await decide(state, state.round(index), first, {
      ...verdictOf(decideLearned({ ...measured, learned }), isHarmful(measured), gates),
      gates,
      measurements: [
        recorded(state, 'incumbent', versions.base, index, seeds, config, label(false)),
        recorded(state, 'candidate', versions.candidate, index, seeds, config, label(false)),
      ],
      seeds,
      learned,
    });
    return;
  }
  const decision = decideKeep({ ...measurementOf(first), evaluation, runs });
  if (!decision.keep) {
    await decide(state, state.round(index), first, {
      ...verdictOf(decision, isHarmful({ ...measurementOf(first), evaluation, runs }), []),
      gates: [],
      measurements: [
        recorded(state, 'incumbent', versions.base, index, seeds, config, label(false)),
        recorded(state, 'candidate', versions.candidate, index, seeds, config, label(false)),
      ],
      seeds,
    });
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
  const allSeeds = devSeeds(state.record.seeds.devPanel, index, 2 * runs);
  const gates = await hardGates(state, index, versions.candidate, allSeeds, config);
  await decide(
    state,
    state.round(index),
    both,
    {
      ...verdictOf(
        confirmed,
        isHarmful({ ...measurementOf(both), evaluation, runs: 2 * runs }),
        gates,
      ),
      gates,
      measurements: [
        recorded(state, 'incumbent', versions.base, index, allSeeds, config, label(true)),
        recorded(state, 'candidate', versions.candidate, index, allSeeds, config, label(true)),
      ],
      seeds: allSeeds,
    },
    first,
  );
}

export function abandonRound(state: RunState, index: number, reason: string): void {
  const stored = state.round(index);
  const round: Round = { ...stored.round, status: 'failed', error: reason, endedAt: state.now() };
  const experiment = state.ctx.store.transaction(() => {
    state.ctx.store.rounds.update({ ...stored, round });
    return recordExperiment(state, index, { disposition: 'stopped', reason });
  });
  state.emit({ type: 'round.updated', round });
  state.announce('experiment', experiment.id, index);
  state.log('info', `Round ${index}: ${reason}`);
}

/**
 * Hands the run to its locked test, or ends it when there is nothing to test: a stop, or a mentor
 * with nothing it may change (decision 063), before anything was kept. `why` is the sentence for
 * the second, which the run keeps where the person reads it.
 */
export function finishTraining(
  state: RunState,
  reason: RunStopReason | undefined,
  why?: string,
): void {
  for (const settled of settleExperimentCompute(
    state.ctx.store,
    state.ctx.deps.training,
    state.ctx.runId,
  )) {
    state.announce('experiment', settled.id, settled.round);
  }
  const kept = state.rounds().some(({ round }) => round.decision === 'kept');
  if (reason === 'user' && !kept) {
    state.saveRun({ status: 'stopped', phase: 'done', stopReason: 'user', endedAt: state.now() });
    state.log('info', 'Stopped before any change was kept, so there is no graduate to test.');
    return;
  }
  if (reason === 'nothing_to_try') {
    // The run keeps the sentence where the person reads it. An improvement that kept nothing goes
    // on to the step that hands its lessons back, which the planner takes before any freeze.
    const message = why ?? TRAINING_ENDED.nothing_to_try;
    if (!kept && state.record.improves === undefined) {
      state.saveRun({
        status: 'stopped',
        phase: 'done',
        stopReason: reason,
        error: message,
        endedAt: state.now(),
      });
      state.log('info', `${message} There is no graduate to test.`);
    } else {
      state.saveRun({ ...trainingEnd(reason), error: message });
      state.log('info', message);
    }
    return;
  }
  state.saveRun(trainingEnd(reason));
  state.log('info', TRAINING_ENDED[reason ?? 'complete']);
}
