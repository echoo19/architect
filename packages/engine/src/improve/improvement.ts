import { join } from 'node:path';
import type {
  Correction,
  Harness,
  Improvement,
  ImproveOptions,
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
import type { RunState } from '../loop/run-state';
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
 * Ends an improvement: a candidate version of the same agent from its last kept change, its
 * lessons marked used, the run finished, in one transaction once the folder is written. The
 * active version is never touched. With no change kept there is no candidate, and the lessons
 * go back to the queue.
 */
export async function proposeVersion(state: RunState): Promise<void> {
  const { store, runId } = state.ctx;
  const improves = must(state.record.improves, 'The improvement');
  const kept = state.rounds().filter(({ round }) => round.decision === 'kept').length;
  if (kept === 0) {
    const at = state.now();
    const lessons = improvementLessons(state);
    const ended = store.transaction(() => {
      for (const lesson of lessons) {
        if (lesson.status !== 'queued' || lesson.runId !== runId) continue;
        const { runId: _taken, ...rest } = lesson;
        store.corrections.put({ ...rest, updatedAt: at });
      }
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
    testedHere: false,
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
    for (const lesson of lessons) {
      store.corrections.put({
        ...lesson,
        status: 'used',
        candidateVersion: version,
        updatedAt: at,
      });
    }
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
      const { budget } = await jobs.forRun(record);
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
  if (candidate === null) {
    return { allowed: false, reason: 'No change was kept, so there is nothing to promote.' };
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
