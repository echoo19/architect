import { cp, rm } from 'node:fs/promises';
import {
  AttemptSchema,
  GraduateManifestSchema,
  JobSchema,
  TraceSchema,
  type FileDiff,
  type GraduateSummary,
  type RunDetail,
  type Trace,
} from '@architect/shared';
import type { Clock, EngineHostDeps, JobDrafter } from '../loop/deps';
import { must } from '../loop/errors';
import { readJsonFile } from '../loop/files';
import type { JobLibrary } from '../loop/jobs';
import { LineageLog } from '../loop/lineage';
import { isSafeId, type DataPaths } from '../loop/paths';
import type { RunController } from '../loop/controller';
import { isoNow } from '../loop/time';
import type { EngineStore } from '../store/engine-store';
import type { GraduateRecord, StoredRun } from '../store/records';
import type { EngineApi } from './protocol';

/** Train and dev attempts shown on the training view, newest first. */
const RECENT_ATTEMPTS = 200;

/** A lookup the caller asked for; the message says what wasn't there. */
function found<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new Error(message);
  return value;
}

export interface EngineApiContext {
  store: EngineStore;
  paths: DataPaths;
  jobs: JobLibrary;
  controller: RunController;
  deps: EngineHostDeps;
  clock: Clock;
}

/** The engine API for callers in the host's own process; `serve` exposes it over a port. */
export function createEngineApi(ctx: EngineApiContext): EngineApi {
  const { store, paths, jobs, controller, deps } = ctx;

  const run = (runId: string): StoredRun =>
    found(store.runs.get(runId), `There is no run "${runId}".`);
  const lineageOf = (record: StoredRun) =>
    new LineageLog(paths.lineageFile(record.run.jobId, record.run.id)).read();
  const versionsOf = (record: StoredRun) =>
    deps.harness.versions(paths.harnessDir(record.run.jobId, record.run.id));
  const drafter = (): JobDrafter =>
    found(deps.drafts, "Drafting a job with the mentor isn't available in this build.");
  const summary = (graduate: GraduateRecord): GraduateSummary => ({
    id: graduate.id,
    name: graduate.name,
    manifest: graduate.manifest,
    path: paths.fromStored(graduate.path),
  });

  async function runDetail(runId: string): Promise<RunDetail> {
    const record = run(runId);
    const { jobId } = record.run;
    const visible = [...(await jobs.tasks(jobId, 'train')), ...(await jobs.tasks(jobId, 'dev'))];
    const prompts = new Map(visible.map((task) => [task.id, task.prompt]));
    return {
      run: record.run,
      job: await jobs.forRun(record),
      rounds: store.rounds.list(runId).map(({ round }) => round),
      recentAttempts: store.attempts
        .recent(runId, ['train', 'dev'], RECENT_ATTEMPTS)
        .map((attempt) => ({
          ...AttemptSchema.parse(attempt),
          prompt: prompts.get(attempt.taskId),
        })),
      lineage: await lineageOf(record),
    };
  }

  async function trace(attemptId: string): Promise<Trace> {
    const attempt = found(store.attempts.get(attemptId), `There is no attempt "${attemptId}".`);
    if (attempt.tracePath === null) {
      throw new Error('Locked-test traces are not kept, so test prompts never leave the vault.');
    }
    return TraceSchema.parse(await readJsonFile(paths.fromStored(attempt.tracePath)));
  }

  async function roundDiff(runId: string, index: number): Promise<FileDiff[]> {
    const record = run(runId);
    const stored = found(store.rounds.get(runId, index), `This run has no round ${index}.`);
    const candidate = stored.round.candidateVersion;
    if (candidate === undefined) return [];
    const versions = versionsOf(record);
    return deps.harness.diffHarness(
      await versions.load(stored.baseVersion),
      await versions.load(candidate),
    );
  }

  /** Marks the run's graduate accepted and rewrites its folder with the new manifest. */
  async function accept(runId: string): Promise<GraduateSummary> {
    const record = run(runId);
    const graduate = found(store.graduates.forRun(runId), 'This run has no graduate yet.');
    if (graduate.manifest.acceptedAt) return summary(graduate);
    const freeze = must(record.freeze, 'The frozen graduate');
    const manifest = GraduateManifestSchema.parse({
      ...graduate.manifest,
      acceptedAt: isoNow(ctx.clock),
    });
    await deps.harness.writeGraduate(paths.fromStored(graduate.path), {
      harness: await versionsOf(record).load(freeze.harnessVersion),
      manifest,
      report: found(store.reports.get(runId), 'This run has no report card yet.'),
      lineage: await lineageOf(record),
    });
    const accepted = { ...graduate, manifest };
    store.graduates.update(accepted);
    return summary(accepted);
  }

  async function importFolder(folder: string): Promise<GraduateSummary> {
    const manifest = GraduateManifestSchema.parse(await deps.harness.readGraduateManifest(folder));
    if (!isSafeId(manifest.id)) throw new Error(`"${manifest.id}" isn't a valid graduate id.`);
    if (store.graduates.get(manifest.id))
      throw new Error(`"${manifest.name}" is already in Architect.`);
    const dir = paths.graduateDir(manifest.id);
    await cp(folder, dir, { recursive: true, force: false, errorOnExist: true });
    const record: GraduateRecord = {
      id: manifest.id,
      runId: store.runs.get(manifest.runId) ? manifest.runId : null,
      name: manifest.name,
      path: paths.toStored(dir),
      manifest,
      createdAt: manifest.createdAt,
    };
    store.graduates.insert(record);
    return summary(record);
  }

  return {
    jobs: {
      list: async () => jobs.summaries(),
      get: (jobId) => jobs.get(jobId),
      save: (job) => jobs.save(job),
      createSample: async () => {
        const file = found(deps.sampleJobFile, "The sample job isn't available in this build.");
        const { id } = JobSchema.parse(await readJsonFile(file));
        return store.jobs.get(id) ? jobs.get(id) : jobs.importFile(file);
      },
      importFile: (file) => jobs.importFile(file),
      exportFile: (jobId, file) => jobs.exportFile(jobId, file),
      draftStart: (description, files) => drafter().start(description, files),
      draftReply: (sessionId, text) => drafter().reply(sessionId, text),
    },
    runs: {
      start: (jobId, options) => controller.start(jobId, options.method, options.seed),
      pause: (runId) => controller.pause(runId),
      resume: (runId) => controller.resume(runId),
      stop: (runId) => controller.stop(runId),
      get: runDetail,
      list: async (jobId) => store.runs.list(jobId).map(({ run: listed }) => listed),
      trace,
      roundDiff,
      onEvent: (listener) => controller.onEvent(listener),
    },
    reports: {
      get: async (runId) => found(store.reports.get(runId), 'This run has no report card yet.'),
    },
    graduates: {
      list: async () => store.graduates.list().map(summary),
      accept,
      exportFolder: async (graduateId, folder) => {
        const graduate = found(
          store.graduates.get(graduateId),
          `There is no graduate "${graduateId}".`,
        );
        await cp(paths.fromStored(graduate.path), folder, {
          recursive: true,
          force: false,
          errorOnExist: true,
        });
      },
      importFolder,
      remove: async (graduateId) => {
        const graduate = found(
          store.graduates.get(graduateId),
          `There is no graduate "${graduateId}".`,
        );
        store.graduates.remove(graduate.id);
        await rm(paths.fromStored(graduate.path), { recursive: true, force: true });
      },
    },
  };
}
