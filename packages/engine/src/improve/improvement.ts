import { join } from 'node:path';
import type {
  Correction,
  Experiment,
  Harness,
  Improvement,
  ImproveOptions,
  Job,
  LessonOutcome,
  Run,
  RunImprovement,
  TrainedAdapter,
} from '@architect/shared';
import { adapterFile } from '../graduates/graduation';
import { tableColumns, type VersionFacts } from '../graduates/build';
import { ContractBook } from '../graduates/contracts';
import { nextVersion, registerVersion, writeVersionFolder } from '../graduates/versions';
import { formatUsd } from '../loop/budget';
import { must } from '../loop/errors';
import type { JobLibrary } from '../loop/jobs';
import type { DataPaths } from '../loop/paths';
import { isTerminal } from '../loop/plan';
import { TRAINING_ENDED, type RunState } from '../loop/run-state';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun, StoredVersion } from '../store/records';

/** What an improvement starts from, checked before its run is made. */
export interface ImprovementPlan extends RunImprovement {
  name: string;
  jobId: string;
  /** The starting version's adapter, which every measurement keeps on. */
  adapter?: TrainedAdapter;
}

/** The runs that improve an agent, newest first. */
function improvementRuns(store: EngineStore, jobId: string, graduateId: string): StoredRun[] {
  return store.runs.list(jobId).filter((record) => record.improves?.graduateId === graduateId);
}

/** The adapter a version ships, as a run keeps one on: its file inside the version's folder. */
function versionAdapter(
  paths: DataPaths,
  version: StoredVersion,
  name: string,
): TrainedAdapter | undefined {
  const adapter = version.manifest.model.adapter;
  if (adapter === undefined) return undefined;
  return {
    id: adapter.trainingJobId ?? `v${version.version}`,
    path: paths.toStored(join(paths.fromStored(version.path), adapter.path)),
    sha256: adapter.sha256,
    standIn: adapter.standIn === true,
    label: `${name} version ${version.version}`,
  };
}

/**
 * Checks that Improve agent can start on an agent and says what it starts from: an agent made
 * here from a job, its active version, and every lesson in its queue. One improvement at a time.
 */
export function improvementPlan(
  store: EngineStore,
  paths: DataPaths,
  graduateId: string,
): ImprovementPlan {
  const agent = must(store.graduates.get(graduateId), `There is no graduate "${graduateId}".`);
  const origin = agent.runId === null ? null : store.runs.get(agent.runId);
  if (!origin) {
    throw new Error(
      `${agent.name} came from a package, so this computer has no job to improve it with. Improve agent works on agents made here.`,
    );
  }
  const active = must(
    agent.activeVersion === null ? null : store.versions.get(graduateId, agent.activeVersion),
    `${agent.name} has no active version to improve.`,
  );
  const { jobId } = origin.run;
  if (improvementRuns(store, jobId, graduateId).some((record) => !isTerminal(record.run.status))) {
    throw new Error(`${agent.name} is already being improved. Wait for it, or stop it first.`);
  }
  const queued = store.corrections.list(graduateId, ['queued']);
  if (queued.length === 0) {
    throw new Error(`${agent.name} has no queued lessons. Queue one with Teach this first.`);
  }
  const adapter = versionAdapter(paths, active, agent.name);
  return {
    graduateId,
    name: agent.name,
    jobId,
    version: active.version,
    corrections: queued.map((correction) => correction.id),
    ...(adapter === undefined ? {} : { adapter }),
  };
}

/** What the person reads once Improve agent is asked to start. */
export function improvementNote(
  plan: ImprovementPlan,
  options: ImproveOptions,
  started: boolean,
): string {
  const lessons = plan.corrections.length === 1 ? '1 lesson' : `${plan.corrections.length} lessons`;
  const budget = `at most ${options.maxRounds} ${options.maxRounds === 1 ? 'round' : 'rounds'} and ${formatUsd(options.maxMentorUsd)} of mentor spend`;
  const meanwhile = `${plan.name} keeps answering on version ${plan.version} meanwhile, and what this makes is a candidate you can accept and promote.`;
  return started
    ? `Improving ${plan.name} from version ${plan.version} with ${lessons}, within ${budget}. ${meanwhile}`
    : `Another run is using the student on this computer, so this improvement waits for it and starts on its own, within ${budget}. ${meanwhile}`;
}

/** The harness an improvement starts from: its starting version's, read from the package. */
export async function improvementHarness(state: RunState): Promise<Harness> {
  const improves = must(state.record.improves, 'The improvement');
  const { store, paths, deps } = state.ctx;
  const version = must(
    store.versions.get(improves.graduateId, improves.version),
    `Version ${improves.version} of the agent`,
  );
  return deps.harness.readPackaged(paths.fromStored(version.path), version.manifest);
}

/**
 * The lessons an improvement holds, as the mentor reads them beside the round's evidence: those
 * it took that are still queued under it. One discarded or applied meanwhile isn't taught.
 */
export function improvementLessons(state: RunState): Correction[] {
  const improves = state.record.improves;
  if (improves === undefined) return [];
  return improves.corrections.flatMap((id) => {
    const correction = state.ctx.store.corrections.get(id);
    return correction?.status === 'queued' && correction.runId === state.ctx.runId
      ? [correction]
      : [];
  });
}

/**
 * Puts the lessons an improvement took back in the teaching queue, as they were before it took
 * them, with why when `notes` says: only those still queued under it and not in `keep`. Joins
 * the caller's transaction.
 */
export function returnLessons(
  store: EngineStore,
  improves: RunImprovement,
  runId: string,
  at: string,
  notes: ReadonlyMap<string, string> = new Map(),
): void {
  for (const id of improves.corrections) {
    const lesson = store.corrections.get(id);
    if (lesson?.status !== 'queued' || lesson.runId !== runId) continue;
    const { runId: _taken, note: _before, ...rest } = lesson;
    const note = notes.get(id);
    store.corrections.put({ ...rest, ...(note === undefined ? {} : { note }), updatedAt: at });
  }
}

/** A task type in the job's words. */
function typeLabel(job: Job, type: string): string {
  return job.taskTypes.find((item) => item.id === type)?.label ?? type;
}

/**
 * What each lesson came to (decision 066), from the student's checks the run's experiments
 * recorded: learned when it passed every task of the lesson's type it had failed in a round whose
 * change was kept; not learned when a round checked it and it didn't; not verified when nothing
 * could check it, as for a lesson that names no task type.
 */
export function lessonOutcomes(
  experiments: readonly Experiment[],
  lessons: readonly Correction[],
  job: Job,
): LessonOutcome[] {
  return lessons.map((lesson): LessonOutcome => {
    const type = lesson.proposal.taskType;
    const correctionId = lesson.id;
    if (type === undefined) {
      return {
        correctionId,
        verdict: 'not_verified',
        reason: 'It names no task type, so no task could check it.',
      };
    }
    const checks = experiments.flatMap((experiment) => {
      const tasks = (experiment.learned ?? []).filter((task) => task.type === type);
      if (tasks.length === 0) return [];
      const passed = tasks.filter((task) => task.pass).length;
      const what = `${passed} of ${tasks.length} ${typeLabel(job, type)} ${tasks.length === 1 ? 'task' : 'tasks'}`;
      return [{ experiment, what, all: passed === tasks.length }];
    });
    const learned = checks.find(({ experiment }) => experiment.disposition === 'kept');
    if (learned !== undefined) {
      return {
        correctionId,
        verdict: 'learned',
        reason: `Passed ${learned.what} it had failed, in round ${learned.experiment.round}, and the change was kept.`,
      };
    }
    const last = checks.at(-1);
    if (last === undefined) {
      return {
        correctionId,
        verdict: 'not_verified',
        reason: `It failed no ${typeLabel(job, type)} task while it was improved, so no task could check it.`,
      };
    }
    return {
      correctionId,
      verdict: 'not_learned',
      reason: last.all
        ? `Passed ${last.what} it had failed, in round ${last.experiment.round}, but the change wasn't kept.`
        : `Passed ${last.what} it had failed, in round ${last.experiment.round}.`,
    };
  });
}

/** Why each lesson the student didn't learn goes back to the queue, by its id. */
function notesOf(outcomes: readonly LessonOutcome[]): Map<string, string> {
  return new Map(
    outcomes
      .filter(({ verdict }) => verdict !== 'learned')
      .map(({ correctionId, verdict, reason }) => [
        correctionId,
        `${verdict === 'not_learned' ? 'Not learned' : 'Not verified'}: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
      ]),
  );
}

/**
 * Ends an improvement: a candidate version of the same agent from its last kept change, the
 * lessons the student learned marked used, the run finished, in one transaction once the folder
 * is written. The active version is never touched. Lessons it didn't learn, or that nothing
 * could check, go back to the queue with why; with no change kept there is no candidate, and
 * every lesson goes back.
 */
export async function proposeVersion(state: RunState): Promise<void> {
  const { store, runId } = state.ctx;
  const improves = must(state.record.improves, 'The improvement');
  const kept = state.rounds().filter(({ round }) => round.decision === 'kept').length;
  if (kept === 0) {
    const at = state.now();
    const notes = notesOf(
      lessonOutcomes(store.experiments.list(runId), improvementLessons(state), state.job),
    );
    const ended = store.transaction(() => {
      returnLessons(store, improves, runId, at, notes);
      return state.writeRun({ status: 'finished', phase: 'done', endedAt: at });
    });
    state.emit({ type: 'run.updated', run: ended });
    state.log(
      'info',
      'No change was kept, so there is no candidate version. The lessons are back in the queue.',
    );
    return;
  }
  await state.ctx.libraryLock.run(improves.graduateId, () => writeCandidate(state, kept));
}

/** Writes and records the improvement's candidate version, holding the agent's version lock. */
async function writeCandidate(state: RunState, kept: number): Promise<void> {
  const { store, paths, deps, runId } = state.ctx;
  const improves = must(state.record.improves, 'The improvement');
  const frozen = must(state.record.freeze, 'The frozen candidate');
  const lessons = improvementLessons(state);
  const outcomes = lessonOutcomes(store.experiments.list(runId), lessons, state.job);
  const learned = new Set(
    outcomes.filter(({ verdict }) => verdict === 'learned').map(({ correctionId }) => correctionId),
  );
  const at = state.now();
  const agent = must(store.graduates.get(improves.graduateId), 'The agent');
  const installation = must(store.installations.get(agent.id), "The agent's installation");
  const harness = await state.resources.harness(frozen.harnessVersion);
  const version = nextVersion(store, agent.id);
  const parent = must(store.versions.get(agent.id, improves.version), 'The starting version');
  const contract = new ContractBook(store, state.ctx.clock).ensure(state.job);
  const facts: VersionFacts = {
    agentId: agent.id,
    name: agent.name,
    version,
    parent: { agentId: agent.id, version: parent.version, digest: parent.digest },
    createdAt: at,
    method: state.run.method,
    contract,
    modelLabel: state.job.student.label,
    base: {
      name: frozen.student.model,
      ...(frozen.student.digest === undefined ? {} : { digest: frozen.student.digest }),
      ...(frozen.student.quantization === undefined
        ? {}
        : { quantization: frozen.student.quantization }),
      ...(frozen.student.sizeBytes === undefined ? {} : { sizeBytes: frozen.student.sizeBytes }),
    },
    contextLength: state.job.student.local.contextLength,
    runtime: state.job.student.local.runtime,
    ...(frozen.configuration?.adapter ? { adapter: adapterFile(paths, frozen) } : {}),
    harness: { meta: harness.meta, files: deps.harness.harnessToFiles(harness) },
    report: null,
    lineage: await state.lineage.read(),
    columns: await tableColumns(paths.dataDir(state.job.id), contract),
    rounds: state.rounds().length,
    keptChanges: kept,
    testMachine: null,
  };
  const written = await writeVersionFolder(store, paths, facts);
  const finished = store.transaction(() => {
    registerVersion(store, paths, {
      graduateId: agent.id,
      name: agent.name,
      version,
      written,
      parent: improves.version,
      runId,
      state: 'candidate',
      installation,
      at,
    });
    for (const lesson of lessons.filter(({ id }) => learned.has(id))) {
      const { note: _before, ...rest } = lesson;
      store.corrections.put({ ...rest, status: 'used', candidateVersion: version, updatedAt: at });
    }
    returnLessons(store, improves, runId, at, notesOf(outcomes));
    return state.writeRun({ status: 'finished', phase: 'done', endedAt: at, graduateId: agent.id });
  });
  state.emit({ type: 'run.updated', run: finished });
  state.log(
    'info',
    `Made version ${version} of ${agent.name} as a candidate. Version ${improves.version} stays active until you accept and promote it.`,
  );
  state.emit({ type: 'graduate.ready', graduateId: agent.id });
}

/**
 * What each improvement of an agent changed and what it didn't, newest first: dev before and
 * after, per task type, from its own measurements; and whether its candidate may be promoted.
 */
export async function improvementsOf(
  store: EngineStore,
  jobs: JobLibrary,
  graduateId: string,
): Promise<Improvement[]> {
  const agent = must(store.graduates.get(graduateId), `There is no graduate "${graduateId}".`);
  const origin = agent.runId === null ? null : store.runs.get(agent.runId);
  if (!origin) return [];
  const records = improvementRuns(store, origin.run.jobId, graduateId);
  return Promise.all(
    records.map(async (record): Promise<Improvement> => {
      const improves = must(record.improves, 'The improvement');
      const { run } = record;
      const job = await jobs.forRun(record);
      const { budget } = job;
      const experiments = store.experiments.list(run.id);
      // A harness round measures `incumbent` and `candidate`; a weights round H0/A0 and H1/A1.
      const first = experiments[0]?.measurements.find((item) =>
        ['incumbent', 'H0/A0'].includes(item.label),
      );
      const lastKept = experiments
        .filter((experiment) => experiment.disposition === 'kept')
        .at(-1)
        ?.measurements.find((item) => ['candidate', 'H1/A1'].includes(item.label));
      const candidate = store.versions.forRun(run.id);
      const after = candidate === null ? null : (lastKept ?? null);
      return {
        runId: run.id,
        graduateId,
        fromVersion: improves.version,
        status: run.status,
        corrections: improves.corrections,
        budget: { maxRounds: budget.maxRounds, maxMentorUsd: budget.maxMentorUsd },
        spentUsd: run.totals.mentorUsd,
        // Each side from an experiment's own measurement, so both count the same repeats.
        dev: { before: first?.score ?? run.devBaseline, after: after?.score ?? null },
        perType: (first?.perType ?? []).map((before) => ({
          type: before.type,
          before,
          after: after?.perType.find((score) => score.type === before.type) ?? null,
        })),
        ...(candidate === null ? {} : { candidateVersion: candidate.version }),
        promotion: promotionOf(record, candidate, agent.activeVersion),
        lessons: isTerminal(run.status)
          ? lessonOutcomes(
              experiments,
              improves.corrections.flatMap((id) => store.corrections.get(id) ?? []),
              job,
            )
          : [],
      };
    }),
  );
}

function promotionOf(
  record: StoredRun,
  candidate: StoredVersion | null,
  active: number | null,
): Improvement['promotion'] {
  if (!isTerminal(record.run.status)) {
    return { allowed: false, reason: 'It is still running.' };
  }
  if (candidate === null && record.run.stopReason === 'nothing_to_try') {
    return { allowed: false, reason: record.run.error ?? TRAINING_ENDED.nothing_to_try };
  }
  if (candidate === null) {
    const ended: Partial<Record<Run['status'], string>> = {
      stopped: 'It was stopped before it made a version',
      failed: 'It ended on an error before it made a version',
    };
    return {
      allowed: false,
      reason: `${ended[record.run.status] ?? 'No change was kept'}, so there is nothing to promote.`,
    };
  }
  const measured = 'Its gain was measured on dev; no locked test measured it.';
  if (candidate.version === active) {
    return { allowed: false, reason: `Version ${candidate.version} is already active.` };
  }
  if (candidate.state === 'rejected') {
    return { allowed: false, reason: `Version ${candidate.version} was rejected.` };
  }
  return candidate.state === 'accepted'
    ? {
        allowed: true,
        reason: `Promote version ${candidate.version} when you're ready. ${measured}`,
      }
    : {
        allowed: true,
        reason: `Accept version ${candidate.version}, then promote it when you're ready. ${measured}`,
      };
}
