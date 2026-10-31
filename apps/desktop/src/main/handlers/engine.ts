import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { EngineApi } from '@architect/engine';
import {
  AddOrganizationRequestSchema,
  MoveToModelRequestSchema,
  DraftOrganizationSchema,
  type DraftTurn,
  type Job,
} from '@architect/shared';
import { z } from 'zod';
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';
import { applyChoices, type JobChoices } from '../jobs/choices';
import { withFieldExport } from '../settings/schema';
import type { SettingsStore } from '../settings/store';

/** Sends one request to the engine process. */
export type EngineCall = <T>(request: (api: EngineApi) => Promise<T>) => Promise<T>;

const text = z.string().min(1);

/**
 * The jobs, runs and reports domains, forwarded to the engine process, which checks every
 * argument it gets. A path from the renderer must be one the user picked in a file dialog. The
 * conversation that drafts a job talks to the teacher the person chose in Settings, which only
 * this process reads, so each of its calls carries it to the engine. A job that is new, whether
 * the sample job, a job file or a drafted job, starts from the teacher and model the person chose
 * (`choices`); a job that already exists keeps what it has. A field export written is recorded
 * in settings, so Compute can offer it after a restart; its folder is still opened only once the
 * person chooses it again.
 */
export function registerEngineHandlers(
  router: IpcRouter,
  call: EngineCall,
  picked: PickedPaths,
  settings: Pick<SettingsStore, 'get' | 'update'>,
  choices: () => Promise<JobChoices>,
): void {
  /** A job just made, saved again with the person's choices unless it already has them. */
  const chosenFor = async (job: Job): Promise<Job> => {
    const chosen = applyChoices(job, await choices());
    return isDeepStrictEqual(chosen, job) ? job : call((api) => api.jobs.save(chosen));
  };
  /**
   * A job about to be saved. A checker chosen by its full path must be a file the user picked: the
   * engine copies it into the job's folder, so a page may not name any other file to read.
   */
  const checkedJob = (job: Job): Job => {
    const checker = (job as Partial<Job>).checker;
    if (checker?.kind !== 'module' || !isAbsolute(String(checker.path))) return job;
    return { ...job, checker: { kind: 'module', path: picked.check(checker.path) } };
  };
  /**
   * A conversation's turn, with the job it drafted, which the engine has already made from the
   * shipped models, put through the person's choices like any other new job.
   */
  const draftedWith = async (turn: DraftTurn): Promise<DraftTurn> =>
    turn.draft === undefined ? turn : { ...turn, draft: await chosenFor(turn.draft) };

  router.registerHandlers(
    'jobs',
    {
      list: () => call((api) => api.jobs.list()),
      get: (jobId) => call((api) => api.jobs.get(jobId)),
      save: (job) => call((api) => api.jobs.save(checkedJob(job))),
      createSample: async (sample) => {
        // A sample job is made once; asking again opens it as it is.
        const known = new Set((await call((api) => api.jobs.list())).map(({ id }) => id));
        const job = await call((api) => api.jobs.createSample(sample));
        return known.has(job.id) ? job : chosenFor(job);
      },
      importFile: async (file) => {
        const chosen = picked.check(file);
        return chosenFor(await call((api) => api.jobs.importFile(chosen)));
      },
      exportFile: (jobId, file) => {
        const chosen = picked.check(file);
        return call((api) => api.jobs.exportFile(jobId, chosen));
      },
      draftStart: async (description, files) => {
        const chosen = files.map((file) => picked.check(file));
        return draftedWith(
          await call((api) =>
            api.jobs.draftStart(description, chosen, settings.get().defaultMentor),
          ),
        );
      },
      draftField: async (description, organizations) => {
        const chosen = organizations.map((org) => ({ ...org, folder: picked.check(org.folder) }));
        return draftedWith(
          await call((api) =>
            api.jobs.draftField(description, chosen, settings.get().defaultMentor),
          ),
        );
      },
      draftReply: async (sessionId, reply) =>
        draftedWith(
          await call((api) => api.jobs.draftReply(sessionId, reply, settings.get().defaultMentor)),
        ),
      taskPlan: (jobId) => call((api) => api.jobs.taskPlan(jobId)),
      confirmRules: (jobId, token) => call((api) => api.jobs.confirmRules(jobId, token)),
      study: (jobId) => call((api) => api.jobs.study(jobId)),
      confirmStudy: (jobId, token) => call((api) => api.jobs.confirmStudy(jobId, token)),
      quoteRecordings: (jobId, org, files) => {
        const chosen = files.map((file) => picked.check(file));
        return call((api) => api.jobs.quoteRecordings(jobId, org, chosen));
      },
      shareRecordings: (jobId, allowed) => call((api) => api.jobs.shareRecordings(jobId, allowed)),
      transcribe: (jobId, request) => {
        const chosen = request.paths.map((file) => picked.check(file));
        return call((api) => api.jobs.transcribe(jobId, { ...request, paths: chosen }));
      },
      field: (jobId) => call((api) => api.jobs.field(jobId)),
      addOrganization: (jobId, request) => {
        const chosen = { ...request, folder: picked.check(request.folder) };
        return call((api) => api.jobs.addOrganization(jobId, chosen));
      },
      teachOn: (jobId, org) => call((api) => api.jobs.teachOn(jobId, org)),
      moveToModel: (jobId, request) => call((api) => api.jobs.moveToModel(jobId, request)),
      fieldAssets: (jobId) => call((api) => api.jobs.fieldAssets(jobId)),
      tasks: (jobId, split) => call((api) => api.jobs.tasks(jobId, split)),
      exportField: async (jobId, directory) => {
        const chosen = picked.check(directory);
        const manifest = await call((api) => api.jobs.exportField(jobId, chosen));
        const record = {
          jobId,
          name: manifest.job.name,
          dir: chosen,
          at: new Date().toISOString(),
        };
        await settings.update({
          fieldExports: withFieldExport(settings.get().fieldExports ?? [], record),
        });
        return manifest;
      },
    },
    {
      importFile: z.tuple([text]),
      exportFile: z.tuple([text, text]),
      exportField: z.tuple([text, text]),
      addOrganization: z.tuple([text, AddOrganizationRequestSchema]),
      teachOn: z.tuple([text, text]),
      moveToModel: z.tuple([text, MoveToModelRequestSchema]),
      draftStart: z.tuple([text, z.array(text)]),
      draftField: z.tuple([text, z.array(DraftOrganizationSchema).min(1)]),
    },
  );

  router.registerHandlers('runs', {
    start: (jobId, options) => call((api) => api.runs.start(jobId, options)),
    pause: (runId) => call((api) => api.runs.pause(runId)),
    resume: (runId) => call((api) => api.runs.resume(runId)),
    stop: (runId) => call((api) => api.runs.stop(runId)),
    retest: (runId, target) => call((api) => api.runs.retest(runId, target)),
    qualifyAdded: (runId, org) => call((api) => api.runs.qualifyAdded(runId, org)),
    qualify: (request) => call((api) => api.runs.qualify(request)),
    qualifications: (jobId) => call((api) => api.runs.qualifications(jobId)),
    get: (runId) => call((api) => api.runs.get(runId)),
    list: (jobId) => call((api) => api.runs.list(jobId)),
    attempt: (attemptId) => call((api) => api.runs.attempt(attemptId)),
    trace: (attemptId) => call((api) => api.runs.trace(attemptId)),
    roundDiff: (runId, round) => call((api) => api.runs.roundDiff(runId, round)),
    attempts: (runId, query) => call((api) => api.runs.attempts(runId, query)),
    harnessFiles: (runId, version) => call((api) => api.runs.harnessFiles(runId, version)),
    runtimeMeasurements: (runId) => call((api) => api.runs.runtimeMeasurements(runId)),
  });

  router.registerHandlers('teach', {
    propose: (chatId, messageId, request) =>
      call((api) => api.teach.propose(chatId, messageId, request)),
    queue: (correctionId) => call((api) => api.teach.queue(correctionId)),
    discard: (correctionId) => call((api) => api.teach.discard(correctionId)),
    list: (graduateId) => call((api) => api.teach.list(graduateId)),
    improve: (graduateId, options) => call((api) => api.teach.improve(graduateId, options)),
    improvements: (graduateId) => call((api) => api.teach.improvements(graduateId)),
    overview: (graduateId) => call((api) => api.teach.overview(graduateId)),
    shareCorrections: (graduateId, allowed) =>
      call((api) => api.teach.shareCorrections(graduateId, allowed)),
  });

  // An experiment runs on a field in the library, or on a job folder the person chose in a dialog.
  const chosenJob = <T extends { jobDir?: string | undefined }>(input: T): T =>
    input.jobDir === undefined ? input : { ...input, jobDir: picked.check(input.jobDir) };
  router.registerHandlers('experiments', {
    plan: (input) => call((api) => api.experiments.plan(chosenJob(input))),
    revise: (experimentId, input) =>
      call((api) => api.experiments.revise(experimentId, chosenJob(input))),
    calibrate: (experimentId) => call((api) => api.experiments.calibrate(experimentId)),
    preregister: (experimentId) => call((api) => api.experiments.preregister(experimentId)),
    start: (experimentId, options) => call((api) => api.experiments.start(experimentId, options)),
    pause: (experimentId) => call((api) => api.experiments.pause(experimentId)),
    resume: (experimentId, options) => call((api) => api.experiments.resume(experimentId, options)),
    stop: (experimentId) => call((api) => api.experiments.stop(experimentId)),
    list: () => call((api) => api.experiments.list()),
    get: (experimentId) => call((api) => api.experiments.get(experimentId)),
  });

  // A config.json, a field export and the folder a bundle goes in are ones the person chose.
  router.registerHandlers('compute', {
    readConfig: (source) =>
      call((api) =>
        api.compute.readConfig(
          source.kind === 'file' ? { ...source, path: picked.check(source.path) } : source,
        ),
      ),
    plan: (request) => call((api) => api.compute.plan(request)),
    bundle: (request) =>
      call((api) =>
        api.compute.bundle({
          ...request,
          exportDir: picked.check(request.exportDir),
          parentDir: picked.check(request.parentDir),
        }),
      ),
  });

  router.registerHandlers('reports', {
    get: (runId, target) => call((api) => api.reports.get(runId, target)),
    list: (runId) => call((api) => api.reports.list(runId)),
    comparisons: (runId) => call((api) => api.reports.comparisons(runId)),
  });

  router.registerHandlers('mentoring', {
    lessons: (runId) => call((api) => api.mentoring.lessons(runId)),
    lessonTrace: (lessonId) => call((api) => api.mentoring.lessonTrace(lessonId)),
    interventions: (runId) => call((api) => api.mentoring.interventions(runId)),
    experiments: (runId) => call((api) => api.mentoring.experiments(runId)),
    progress: (runId) => call((api) => api.mentoring.progress(runId)),
    capabilities: (runId) => call((api) => api.mentoring.capabilities(runId)),
    categories: (jobId) => call((api) => api.mentoring.categories(jobId)),
    counterexamples: (runId) => call((api) => api.mentoring.counterexamples(runId)),
    fieldCounterexamples: (jobId) => call((api) => api.mentoring.fieldCounterexamples(jobId)),
    answer: (runId, round, reply) => call((api) => api.mentoring.answer(runId, round, reply)),
    reference: (runId, options) => call((api) => api.mentoring.reference(runId, options)),
    references: (runId) => call((api) => api.mentoring.references(runId)),
  });
}
