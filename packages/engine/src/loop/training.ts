import {
  newId,
  TraceSchema,
  type GateResult,
  type Harness,
  type Measurement as RecordedMeasurement,
  type Round,
  type RunStopReason,
  type Score,
  type TrainedAdapter,
  type TypeScore,
} from '@architect/shared';
import { improvementHarness } from '../improve/improvement';
import type { StoredRound } from '../store/records';
import { resultOf, type EvaluationResult } from './attempts';
import { configurationKey, llamaCppConfig, type AttemptConfig } from './configuration';
import { must } from './errors';
import { evaluate, type EvaluationSpec } from './evaluation';
import { measurement, recordExperiment } from './experiments';
import { readJsonFile } from './files';
import {
  confirmKeep,
  decideKeep,
  formatScore,
  isHarmful,
  type KeepDecision,
  type Measurement,
} from './keep';
import { percentile } from '../report/report-card';
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

/**
 * Saves the first version: blank for the bare baseline, the starting version's own harness for
 * an improvement, otherwise the job's starting harness.
 */
export async function prepare(state: RunState): Promise<void> {
  const start = (await state.versions.latest()) ?? (await state.versions.save(await first(state)));
  state.saveRun({ phase: 'baseline', currentVersion: start.meta.version });
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
  const result = state.devResult(version, null);
  state.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
  state.saveRun({ devBaseline: result.score, devCurrent: result.score });
}

export function startRound(state: RunState, index: number): void {
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
  if (decision.keep && failed === undefined) return { decision, disposition: 'kept' };
  if (decision.keep && failed !== undefined) {
    return {
      decision: { keep: false, reason: `${decision.reason}, but ${failed.detail}` },
      disposition: 'rejected',
    };
  }
  return { decision, disposition: harmful ? 'rejected' : 'reverted' };
}

/** The version the run measured at its baseline: the reference harness H0 an adapter is tried on. */
function referenceVersion(state: RunState, fallback: number): number {
  return state.attempts({ split: 'dev', round: null })[0]?.harnessVersion ?? fallback;
}

/**
 * A weights round's candidate: the adapter it trained, on the incumbent harness. Every
 * configuration runs on one llama-server, with the same base and decoding, grouped by adapter so
 * a scale change doesn't clear the server's prompt cache between requests. The keep rule compares
 * the candidate (H1/A1) with the incumbent (H1/A0), measuring both again when the first
 * measurement clears it; the reference harness with each adapter (H0/A0, H0/A1) is measured once
 * on the first seeds, so the experiment records the four configurations apart. When the run kept
 * no harness change, H0 is H1, and each of those measurements stands for both, so labelled.
 */
async function evaluateAdapter(state: RunState, index: number): Promise<void> {
  const stored = state.round(index);
  const candidate = must(stored.round.candidateAdapter, 'The candidate adapter');
  const incumbent = state.run.currentAdapter ?? null;
  const loaded = incumbent === null ? [candidate] : [incumbent, candidate];
  const off = llamaCppConfig(loaded, incumbent);
  const on = llamaCppConfig(loaded, candidate);
  const h1 = stored.baseVersion;
  const h0 = referenceVersion(state, h1);
  const { evaluation } = state.job;
  const runs = evaluation.devRepeats;
  const seeds = devSeeds(state.record.seeds.devPanel, index, runs);
  const plan: [number, AttemptConfig][] = [
    [h1, off],
    ...(h0 === h1 ? [] : ([[h0, off]] as [number, AttemptConfig][])),
    [h1, on],
    ...(h0 === h1 ? [] : ([[h0, on]] as [number, AttemptConfig][])),
  ];
  for (const [version, config] of plan) {
    if (!(await evaluate(state, await devEvaluation(state, version, index, runs, config)))) return;
  }
  const pairOf = (measured: readonly number[]): DevPair => ({
    before: state.devResult(h1, index, measured, off),
    after: state.devResult(h1, index, measured, on),
  });
  const first = pairOf(seeds);
  let decision = decideKeep({ ...measurementOf(first), evaluation, runs });
  let pair = first;
  let usedSeeds: readonly number[] = seeds;
  let confirmed = false;
  if (decision.keep) {
    state.log('info', `Round ${index} cleared the keep limits; measuring both again.`);
    for (const config of [off, on]) {
      if (!(await evaluate(state, await devEvaluation(state, h1, index, 2 * runs, config)))) return;
    }
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
  const again = confirmed ? ', and again on new seeds when it cleared the keep limits' : '';
  const same = 'The same configuration: the run had kept no harness change, so H0 is H1.';
  const measurements = [
    recorded(state, 'H1/A0', h1, index, usedSeeds, off, `Measured in this round${again}.`),
    recorded(state, 'H1/A1', h1, index, usedSeeds, on, `Measured in this round${again}.`),
    h0 === h1
      ? recorded(state, 'H0/A0', h1, index, usedSeeds, off, same)
      : recorded(
          state,
          'H0/A0',
          h0,
          index,
          seeds,
          off,
          'Measured in this round, on its first seeds.',
        ),
    h0 === h1
      ? recorded(state, 'H0/A1', h1, index, usedSeeds, on, same)
      : recorded(
          state,
          'H0/A1',
          h0,
          index,
          seeds,
          on,
          'Measured in this round, on its first seeds.',
        ),
  ];
  const gates = await hardGates(state, index, h1, usedSeeds, on, candidate);
  const harmful = isHarmful({
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
      decision: draftDecision(state, draft.before.score, draft.after.score),
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
  const decision = decideKeep({ ...measurementOf(first), evaluation, runs });
  const label = (both: boolean) =>
    both ? 'Measured in this round, and again on new seeds.' : 'Measured in this round.';
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
