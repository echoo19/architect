import {
  AttemptSchema,
  GraduateSettingsSchema,
  JobSchema,
  TraceSchema,
  type ClarificationReply,
  type FileDiff,
  type ReportCard,
  type RunDetail,
  type StudentTarget,
  type Trace,
} from '@architect/shared';
import { exportPackage, exportPart, reviewExport } from '../graduates/exporter';
import { installFromHub } from '../graduates/hub-install';
import { importPackage, inspectPackage, previewImport } from '../graduates/importer';
import { listPublications, publishVersion, reviewPublication } from '../graduates/publish';
import type { HubClient } from '../hub';
import type { GraduateLibrary } from '../graduates/library';
import { improvementsOf } from '../improve/improvement';
import { TeachThis } from '../improve/teach-this';
import { isReferenceAttempt } from '../loop/configuration';
import type { Clock, EngineHostDeps, JobDrafter } from '../loop/deps';
import { readJsonFile } from '../loop/files';
import type { JobLibrary } from '../loop/jobs';
import { LineageLog } from '../loop/lineage';
import type { DataPaths } from '../loop/paths';
import { capabilityBreakdown, mentoringProgress } from '../loop/progress';
import { isoNow } from '../loop/time';
import type { RunController } from '../loop/controller';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun } from '../store/records';
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
  graduates: GraduateLibrary;
  deps: EngineHostDeps;
  clock: Clock;
  /** Hugging Face, for publishing and installing versions. */
  hub: HubClient;
}

/** The engine API for callers in the host's own process; `serve` exposes it over a port. */
export function createEngineApi(ctx: EngineApiContext): EngineApi {
  const { store, paths, jobs, controller, graduates, deps } = ctx;

  const run = (runId: string): StoredRun =>
    found(store.runs.get(runId), `There is no run "${runId}".`);
  /** The run's card from one student endpoint; from its own locked test when none is named. */
  const reportOf = (record: StoredRun, target: StudentTarget = record.lockedTestOn): ReportCard =>
    found(
      store.reports.get(record.run.id, target),
      target === record.lockedTestOn
        ? 'This run has no report card yet.'
        : `This run's graduate hasn't been tested on the ${target} student.`,
    );
  const lineageOf = (record: StoredRun) =>
    new LineageLog(paths.lineageFile(record.run.jobId, record.run.id)).read();
  const versionsOf = (record: StoredRun) =>
    deps.harness.versions(paths.harnessDir(record.run.jobId, record.run.id));
  const drafter = (): JobDrafter =>
    found(deps.drafts, "Drafting a job with the mentor isn't available in this build.");
  const packages = { library: graduates, secrets: deps.secrets, hub: ctx.hub };
  /** The agent's summary once its active version has install checks. */
  const checked = async (graduateId: string) => {
    await graduates.ensureChecked(graduateId);
    return graduates.summary(graduateId);
  };
  const teachThis = new TeachThis({
    store,
    paths,
    jobs,
    deps,
    clock: ctx.clock,
    libraryLock: graduates.lock,
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
        .filter((attempt) => !isReferenceAttempt(attempt))
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

  /**
   * Records the person's answer to the question a paused run asked, on the round's intervention,
   * before anything else happens in the round, and resumes the run.
   */
  async function answerClarification(
    runId: string,
    index: number,
    reply: ClarificationReply,
  ): Promise<void> {
    run(runId);
    const stored = found(store.rounds.get(runId, index), `This run has no round ${index}.`);
    const intervention = store.interventions.get(runId, index);
    if (
      intervention?.type !== 'clarification' ||
      stored.round.status !== 'clarifying' ||
      intervention.answer !== undefined
    ) {
      throw new Error(`Round ${index} isn't waiting for an answer.`);
    }
    store.interventions.put({
      ...intervention,
      answer: {
        text: reply.text.trim(),
        changesCriteria: reply.changesCriteria,
        at: isoNow(ctx.clock),
      },
    });
    await controller.resume(runId);
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
      start: (jobId, { method, seed, lockedTestOn, interactive }) =>
        controller.start(jobId, method, seed, { lockedTestOn, interactive }),
      pause: (runId) => controller.pause(runId),
      resume: (runId) => controller.resume(runId),
      stop: (runId) => controller.stop(runId),
      retest: (runId, target) => controller.retest(runId, target),
      get: runDetail,
      list: async (jobId) => store.runs.list(jobId).map(({ run: listed }) => listed),
      trace,
      roundDiff,
      onEvent: (listener) => controller.onEvent(listener),
    },
    mentoring: {
      lessons: async (runId) => store.lessons.list({ runId: run(runId).run.id }),
      interventions: async (runId) => store.interventions.list(run(runId).run.id),
      experiments: async (runId) => store.experiments.list(run(runId).run.id),
      progress: async (runId) => {
        const record = run(runId);
        return mentoringProgress(store, record, await jobs.forRun(record));
      },
      capabilities: async (runId) => {
        const record = run(runId);
        return capabilityBreakdown(
          store,
          record,
          await jobs.forRun(record),
          store.reports.get(record.run.id, record.lockedTestOn),
        );
      },
      categories: async (jobId) => {
        found(store.jobs.get(jobId), `There is no job "${jobId}".`);
        return store.categories.list(jobId);
      },
      answer: (runId, round, reply) => answerClarification(runId, round, reply),
      reference: (runId, { split, maxUsd }) => controller.reference(runId, split, maxUsd),
      references: async (runId) => store.references.list(run(runId).run.id),
    },
    teach: {
      propose: (chatId, messageId, request) => teachThis.propose(chatId, messageId, request),
      queue: async (correctionId) => teachThis.queue(correctionId),
      discard: async (correctionId) => teachThis.discard(correctionId),
      apply: (correctionId) => teachThis.apply(correctionId),
      list: async (graduateId) => teachThis.list(graduateId),
      improve: (graduateId, options) => controller.improve(graduateId, options),
      improvements: (graduateId) => improvementsOf(store, jobs, graduateId),
    },
    reports: {
      get: async (runId, target) => reportOf(run(runId), target),
      list: async (runId) => store.reports.targets(run(runId).run.id),
    },
    graduates: {
      // A graduate never shows as unchecked: its active version is checked the first time it is
      // listed, accepted, promoted or rolled back to.
      list: () => graduates.listChecked(),
      accept: async (runId) => checked(graduates.acceptRun(runId).id),
      versions: async (graduateId) => graduates.versions(graduateId),
      history: async (graduateId) => graduates.history(graduateId),
      report: (graduateId, version) => graduates.report(graduateId, version),
      acceptVersion: async (graduateId, version) => graduates.acceptVersion(graduateId, version),
      rejectVersion: async (graduateId, version) => graduates.rejectVersion(graduateId, version),
      promote: async (graduateId, version) => checked(graduates.promote(graduateId, version).id),
      rollback: async (graduateId, version) => checked(graduates.rollback(graduateId, version).id),
      installation: async (graduateId) => graduates.installation(graduateId),
      bind: (graduateId, request) => graduates.bind(graduateId, request),
      verify: (graduateId, options) => graduates.verify(graduateId, options),
      reviewExport: (graduateId, version, include) =>
        reviewExport(packages, graduateId, version, include),
      exportPackage: (graduateId, request) => exportPackage(packages, graduateId, request),
      exportFolder: (graduateId, directory) => exportPackage(packages, graduateId, { directory }),
      exportPart: (graduateId, request) => exportPart(packages, graduateId, request),
      inspectPackage: (path) => inspectPackage(packages, path),
      previewImport: (path) => previewImport(packages, path),
      importPackage: (path, request) => importPackage(packages, path, request),
      importFolder: async (path) => (await importPackage(packages, path)).graduate,
      installFromHub: (source, request) => installFromHub(packages, source, request),
      reviewPublication: (graduateId, request) => reviewPublication(packages, graduateId, request),
      publish: (graduateId, request) => publishVersion(packages, graduateId, request),
      publications: async (graduateId) => listPublications(packages, graduateId),
      remove: (graduateId) => graduates.remove(graduateId),
      settings: async (graduateId) => graduates.settings(graduateId),
      updateSettings: async (graduateId, patch) =>
        graduates.updateSettings(graduateId, GraduateSettingsSchema.partial().parse(patch)),
    },
  };
}
