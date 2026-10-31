import {
  ATTEMPT_PAGE_SIZE,
  AttemptSchema,
  browsedSplit,
  CodedError,
  GraduateSettingsSchema,
  JobSchema,
  TraceSchema,
  trainOrganizations,
  type AttemptPage,
  type AttemptQuery,
  type ClarificationReply,
  type ComparisonReport,
  type ErrorCode,
  type FileDiff,
  type Harness,
  type HarnessFile,
  type ListedAttempt,
  type ListedLesson,
  type PublishProgress,
  type ReportCard,
  type Retest,
  type RunDetail,
  type StudentTarget,
  type TaskListing,
  type Trace,
  type VersionPick,
} from '@architect/shared';
import { reportBeside } from '../comparisons/records';
import { buildFieldExport, exportField, fieldSource, fieldView } from '../field';
import { exportPackage, exportPart, reviewExport } from '../graduates/exporter';
import { installFromHub } from '../graduates/hub-install';
import { importPackage, inspectPackage, previewImport } from '../graduates/importer';
import { listPublications, publishVersion, reviewPublication } from '../graduates/publish';
import { prepareSampleAgent, sampleAgentAvailable } from '../graduates/sample';
import type { HubClient } from '../hub';
import type { GraduateLibrary } from '../graduates/library';
import { improvementsOf } from '../improve/improvement';
import { certificationView, discardCertification, planCertification } from '../loop/posthoc';
import { qualificationView } from '../loop/qualify';
import { TeachThis } from '../improve/teach-this';
import { isReferenceAttempt } from '../loop/configuration';
import { JobDrafting } from '../drafting/drafter';
import { JobRecordings } from '../drafting/recordings';
import { JobStudy } from '../drafting/studying';
import type { ExperimentService } from '../experiments/service';
import { bundleFromRequest, planFromRequest, readModelConfig } from '../training-plan/requests';
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

/**
 * A lookup the caller asked for; the message says what wasn't there, and a code lets a screen
 * say so in its own words.
 */
function found<T>(value: T | null | undefined, message: string, code?: ErrorCode): T {
  if (value === null || value === undefined) {
    throw code === undefined ? new Error(message) : new CodedError(code, message);
  }
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
  experiments: ExperimentService;
  /** The repository's trainer folder, whose pins and experimental script a bundle carries. */
  trainerDir?: string;
}

/** The engine API for callers in the host's own process; `serve` exposes it over a port. */
export function createEngineApi(ctx: EngineApiContext): EngineApi {
  const { store, paths, jobs, controller, graduates, deps, experiments } = ctx;

  const run = (runId: string): StoredRun =>
    found(store.runs.get(runId), `There is no run "${runId}".`, 'run_not_found');
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
  const drafter: JobDrafter = new JobDrafting({ jobs, deps, clock: ctx.clock });
  const studying = new JobStudy({ jobs, paths, deps, clock: ctx.clock });
  const recordings = new JobRecordings({ jobs, paths, deps, clock: ctx.clock });
  const packages = { library: graduates, secrets: deps.secrets, hub: ctx.hub };
  /** Who hears a publication move. Listeners only pass it on, so none of them throws. */
  const publishListeners = new Set<(progress: PublishProgress) => void>();
  const publishUpdate = (progress: PublishProgress) => {
    for (const listener of publishListeners) listener(progress);
  };
  /** The agent's summary once its active version has install checks. */
  const checked = async (graduateId: string) => {
    await graduates.ensureChecked(graduateId);
    return graduates.summary(graduateId);
  };
  const teachThis = new TeachThis({ store, jobs, deps, clock: ctx.clock });
  const certifying = { store, paths, jobs, deps, clock: ctx.clock };

  /** The final tests the run has been put through again, local first. */
  function retestsOf(runId: string): Retest[] {
    return (['local', 'hosted'] as const).flatMap((target) => {
      const retest = store.retests.get(runId, target);
      if (retest === null) return [];
      const { status, error, startedAt, endedAt } = retest;
      return [
        {
          target,
          status,
          ...(error === undefined ? {} : { error }),
          startedAt,
          ...(endedAt === undefined ? {} : { endedAt }),
        },
      ];
    });
  }

  async function runDetail(runId: string): Promise<RunDetail> {
    const record = run(runId);
    const { jobId } = record.run;
    const visible = [...(await jobs.tasks(jobId, 'train')), ...(await jobs.tasks(jobId, 'dev'))];
    const prompts = new Map(visible.map((task) => [task.id, task.prompt]));
    const retests = retestsOf(runId);
    return {
      run: record.run,
      job: await jobs.forRun(record),
      lockedTestOn: record.lockedTestOn,
      rounds: store.rounds.list(runId).map(({ round }) => round),
      recentAttempts: store.attempts
        .recent(runId, ['train', 'dev'], RECENT_ATTEMPTS)
        .filter((attempt) => !isReferenceAttempt(attempt))
        .map((attempt) => ({
          ...AttemptSchema.parse(attempt),
          prompt: prompts.get(attempt.taskId),
        })),
      lineage: await lineageOf(record),
      ...(retests.length === 0 ? {} : { retests }),
      ...(record.improves === undefined ? {} : { improves: record.improves }),
    };
  }

  /** A run's lessons, each with its train task's request. */
  async function lessons(runId: string): Promise<ListedLesson[]> {
    const record = run(runId);
    const train = await jobs.tasks(record.run.jobId, 'train');
    const prompts = new Map(train.map((task) => [task.id, task.prompt]));
    return store.lessons.list({ runId: record.run.id }).map((lesson) => ({
      ...lesson,
      prompt: lesson.source.kind === 'correction' ? undefined : prompts.get(lesson.source.taskId),
    }));
  }

  async function attempt(attemptId: string): Promise<ListedAttempt> {
    const stored = found(
      store.attempts.get(attemptId),
      `There is no attempt "${attemptId}".`,
      'record_not_found',
    );
    if (stored.split === 'test' || stored.split === 'certify') {
      throw new Error("A final-test attempt isn't shown on its own; the report card counts it.");
    }
    const record = run(stored.runId);
    const tasks = await jobs.tasks(record.run.jobId, stored.split);
    return {
      ...AttemptSchema.parse(stored),
      prompt: tasks.find((task) => task.id === stored.taskId)?.prompt,
    };
  }

  async function trace(attemptId: string): Promise<Trace> {
    const attempt = found(
      store.attempts.get(attemptId),
      `There is no attempt "${attemptId}".`,
      'record_not_found',
    );
    if (attempt.tracePath === null) {
      throw new Error('Locked-test traces are not kept, so test prompts never leave the vault.');
    }
    return TraceSchema.parse(await readJsonFile(paths.fromStored(attempt.tracePath)));
  }

  /**
   * What the mentor did as the agent in one correction, step by step. Null when the try never
   * ran (its replay didn't hold, or a guard refused it) or was made before traces were kept.
   */
  async function lessonTrace(lessonId: string): Promise<Trace | null> {
    const lesson = found(
      store.lessons.get(lessonId),
      `There is no lesson "${lessonId}".`,
      'record_not_found',
    );
    if (lesson.runId === null) return null;
    let stored: unknown;
    try {
      stored = await readJsonFile(paths.traceFile(lesson.jobId, lesson.runId, lesson.id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    return TraceSchema.parse(stored);
  }

  /**
   * The comparisons runner's report the run is an arm of. The runner keeps a comparison's data
   * in `<out>/data` and its report in `<out>/report.json` (decision 045), so the app shows one
   * when it runs on such a `data` folder.
   */
  async function comparisons(runId: string): Promise<ComparisonReport | null> {
    const id = run(runId).run.id;
    const report = await reportBeside(paths.root);
    return report?.arms.some((arm) => arm.runId === id) ? report : null;
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
    const stored = found(
      store.rounds.get(runId, index),
      `This run has no round ${index}.`,
      'record_not_found',
    );
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
    const stored = found(
      store.rounds.get(runId, index),
      `This run has no round ${index}.`,
      'record_not_found',
    );
    const candidate = stored.round.candidateVersion;
    if (candidate === undefined) return [];
    const versions = versionsOf(record);
    return deps.harness.diffHarness(
      await versions.load(stored.baseVersion),
      await versions.load(candidate),
    );
  }

  /**
   * A split's tasks for the person to browse: practice and check tasks in full, without any of
   * a sealed organization's, and the calibration and test splits by count alone (decision 084).
   */
  async function taskListing(jobId: string, asked: unknown): Promise<TaskListing> {
    const split = browsedSplit(asked);
    const job = await jobs.get(jobId);
    if (split === 'calibration') {
      return { split, count: (await jobs.tasks(jobId, 'calibration')).length };
    }
    if (split === 'test') {
      const counts = (await deps.vault.isSealed(jobId)) ? await deps.vault.typeCounts(jobId) : {};
      return { split, count: Object.values(counts).reduce((sum, count) => sum + count, 0) };
    }
    const taught = new Set(trainOrganizations(job).map((org) => org.id));
    const tasks = (await jobs.tasks(jobId, split)).filter(
      (task) => task.org === undefined || taught.has(task.org),
    );
    return { split, count: tasks.length, tasks };
  }

  /**
   * A page of the run's practice and check attempts, newest first. Only those two splits are
   * read, so a locked-test, certificate or calibration attempt is never among them.
   */
  async function attemptPage(runId: string, query: AttemptQuery = {}): Promise<AttemptPage> {
    const record = run(runId);
    const { jobId } = record.run;
    const visible = [...(await jobs.tasks(jobId, 'train')), ...(await jobs.tasks(jobId, 'dev'))];
    const tasks = new Map(visible.map((task) => [task.id, task]));
    const matching = store.attempts
      .recent(runId, ['train', 'dev'], Number.MAX_SAFE_INTEGER)
      .filter(
        (attempt) =>
          !isReferenceAttempt(attempt) &&
          (query.round === undefined || attempt.round === query.round) &&
          (query.type === undefined || attempt.taskType === query.type) &&
          (query.org === undefined || tasks.get(attempt.taskId)?.org === query.org) &&
          (query.passed === undefined || attempt.check.pass === query.passed),
      );
    const start = Number(query.cursor ?? 0);
    const end = start + ATTEMPT_PAGE_SIZE;
    return {
      attempts: matching.slice(start, end).map((attempt) => {
        const task = tasks.get(attempt.taskId);
        return {
          ...AttemptSchema.parse(attempt),
          prompt: task?.prompt,
          ...(task?.org === undefined ? {} : { org: task.org }),
        };
      }),
      total: matching.length,
      next: end < matching.length ? String(end) : null,
    };
  }

  /** A harness as the files its folder holds, by path. */
  const filesOf = (harness: Harness): HarnessFile[] =>
    Object.entries(deps.harness.harnessToFiles(harness))
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([path, content]) => ({ path, content }));

  /** A version's harness from its own folder, held to the hash its manifest records. */
  const packagedHarness = ({ graduateId, version }: VersionPick) => {
    const stored = graduates.version(graduateId, version);
    return deps.harness.readPackaged(paths.fromStored(stored.path), stored.manifest);
  };

  return {
    jobs: {
      list: async () => jobs.summaries(),
      get: (jobId) => jobs.get(jobId),
      save: (job) => jobs.save(job),
      createSample: async (sample = 'home-services') => {
        const file = found(
          sample === 'academy' ? deps.academyJobFile : deps.sampleJobFile,
          "The sample job isn't available in this build.",
        );
        const { id } = JobSchema.parse(await readJsonFile(file));
        return store.jobs.get(id) ? jobs.get(id) : jobs.importFile(file);
      },
      importFile: (file) => jobs.importFile(file),
      exportFile: (jobId, file) => jobs.exportFile(jobId, file),
      draftStart: (description, files, teacher) => drafter.start(description, files, teacher),
      draftField: (description, organizations, teacher) =>
        drafter.startField(description, organizations, teacher),
      draftReply: (sessionId, text, teacher) => drafter.reply(sessionId, text, teacher),
      taskPlan: (jobId) => jobs.taskPlan(jobId),
      confirmRules: (jobId, token) => jobs.confirmRules(jobId, token),
      study: (jobId) => studying.study(jobId),
      confirmStudy: (jobId, token) => jobs.confirmStudy(jobId, token),
      quoteRecordings: (jobId, org, files) => recordings.quote(jobId, org, files),
      shareRecordings: (jobId, allowed) => recordings.share(jobId, allowed),
      transcribe: (jobId, request) => recordings.transcribe(jobId, request),
      field: async (jobId) => fieldView(await jobs.get(jobId), paths),
      fieldAssets: async (jobId) => {
        await jobs.get(jobId);
        return buildFieldExport(await fieldSource(store, paths, jobId)).manifest;
      },
      exportField: async (jobId, directory) => {
        await jobs.get(jobId);
        return exportField(await fieldSource(store, paths, jobId), directory);
      },
      tasks: taskListing,
    },
    runs: {
      start: (jobId, { method, seed, lockedTestOn, interactive }) =>
        controller.start(jobId, method, seed, { lockedTestOn, interactive }),
      pause: (runId) => controller.pause(runId),
      resume: (runId) => controller.resume(runId),
      stop: (runId) => controller.stop(runId),
      retest: (runId, target) => controller.retest(runId, target),
      qualify: async (request) => controller.qualify(request),
      qualifications: async (jobId) =>
        store.qualifications.ofJob(jobId).map((item) => qualificationView(item)),
      get: runDetail,
      list: async (jobId) => store.runs.list(jobId).map(({ run: listed }) => listed),
      attempt,
      trace,
      roundDiff,
      attempts: attemptPage,
      harnessFiles: async (runId, version) => filesOf(await versionsOf(run(runId)).load(version)),
      runtimeMeasurements: async (runId) => store.runtimeMeasurements.list(run(runId).run.id),
      onEvent: (listener) => controller.onEvent(listener),
    },
    mentoring: {
      lessons,
      lessonTrace,
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
        found(store.jobs.get(jobId), `There is no job "${jobId}".`, 'job_not_found');
        return store.categories.list(jobId);
      },
      counterexamples: async (runId) => store.counterexamples.list({ runId: run(runId).run.id }),
      fieldCounterexamples: async (jobId) => {
        found(store.jobs.get(jobId), `There is no job "${jobId}".`, 'job_not_found');
        return store.counterexamples.list({ jobId });
      },
      answer: (runId, round, reply) => answerClarification(runId, round, reply),
      reference: (runId, { split, maxUsd }) => controller.reference(runId, split, maxUsd),
      references: async (runId) => store.references.list(run(runId).run.id),
    },
    teach: {
      propose: (chatId, messageId, request) => teachThis.propose(chatId, messageId, request),
      queue: async (correctionId) => teachThis.queue(correctionId),
      discard: async (correctionId) => teachThis.discard(correctionId),
      list: async (graduateId) => teachThis.list(graduateId),
      improve: (graduateId, options) => controller.improve(graduateId, options),
      improvements: (graduateId) => improvementsOf(store, jobs, graduateId),
      overview: (graduateId) => teachThis.overview(graduateId, controller.studentBusy()),
      shareCorrections: async (graduateId, allowed) => {
        await teachThis.shareCorrections(graduateId, allowed);
        return teachThis.overview(graduateId, controller.studentBusy());
      },
    },
    experiments: {
      plan: (input) => experiments.plan(input),
      revise: (experimentId, input) => experiments.revise(experimentId, input),
      calibrate: (experimentId) => experiments.calibrate(experimentId),
      preregister: (experimentId) => experiments.preregister(experimentId),
      start: (experimentId, options) => experiments.start(experimentId, options),
      pause: (experimentId) => experiments.pause(experimentId),
      resume: (experimentId, options) => experiments.resume(experimentId, options),
      stop: (experimentId) => experiments.stop(experimentId),
      list: () => experiments.list(),
      get: (experimentId) => experiments.get(experimentId),
      onEvent: (listener) => experiments.onEvent(listener),
    },
    compute: {
      readConfig: (source) => readModelConfig(ctx.hub, source),
      plan: async (request) => planFromRequest(request),
      bundle: async (request) => bundleFromRequest(request, ctx.trainerDir),
    },
    reports: {
      get: async (runId, target) => reportOf(run(runId), target),
      list: async (runId) => store.reports.targets(run(runId).run.id),
      comparisons,
    },
    graduates: {
      // A graduate never shows as unchecked: its active version is checked the first time it is
      // listed, accepted, promoted or rolled back to.
      list: () => graduates.listChecked(),
      accept: async (runId) => checked(graduates.acceptRun(runId).id),
      versions: async (graduateId) => graduates.versions(graduateId),
      history: async (graduateId) => graduates.history(graduateId),
      report: (graduateId, version) => graduates.report(graduateId, version),
      harnessDiff: async (from, to) =>
        deps.harness.diffHarness(await packagedHarness(from), await packagedHarness(to)),
      harnessFiles: async (graduateId, version) =>
        filesOf(await packagedHarness({ graduateId, version })),
      planCertification: async (request) =>
        certificationView(store, await planCertification(certifying, request)),
      startCertification: async (certificationId) => {
        controller.certify(certificationId);
        return certificationView(
          store,
          found(store.certifications.get(certificationId), 'There is no such certification.'),
        );
      },
      discardCertification: (certificationId) => discardCertification(certifying, certificationId),
      certifications: async (graduateId, version) =>
        store.certifications
          .list(graduateId, version)
          .map((item) => certificationView(store, item)),
      acceptVersion: async (graduateId, version) => graduates.acceptVersion(graduateId, version),
      rejectVersion: async (graduateId, version) => graduates.rejectVersion(graduateId, version),
      promote: async (graduateId, version) => checked(graduates.promote(graduateId, version).id),
      rollback: async (graduateId, version) => checked(graduates.rollback(graduateId, version).id),
      installation: async (graduateId) => graduates.installation(graduateId),
      bind: (graduateId, request) => graduates.bind(graduateId, request),
      checkFolder: (graduateId, resource, folder) =>
        graduates.checkFolder(graduateId, resource, folder),
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
      hasSampleAgent: () => sampleAgentAvailable(deps.sampleAgent),
      prepareSampleAgent: () => prepareSampleAgent(paths, deps.sampleAgent),
      reviewPublication: (graduateId, request) => reviewPublication(packages, graduateId, request),
      publish: (graduateId, request) =>
        publishVersion(packages, graduateId, request, { onUpdate: publishUpdate }),
      publications: async (graduateId) => listPublications(packages, graduateId),
      onPublishProgress(listener) {
        publishListeners.add(listener);
        return () => {
          publishListeners.delete(listener);
        };
      },
      remove: (graduateId) => graduates.remove(graduateId),
      settings: async (graduateId) => graduates.settings(graduateId),
      updateSettings: async (graduateId, patch) =>
        graduates.updateSettings(graduateId, GraduateSettingsSchema.partial().parse(patch)),
    },
  };
}
