import type { EngineApi } from '@architect/engine';
import { z } from 'zod';
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';

/** Sends one request to the engine process. */
export type EngineCall = <T>(request: (api: EngineApi) => Promise<T>) => Promise<T>;

const text = z.string().min(1);

/**
 * The jobs, runs and reports domains, forwarded to the engine process, which checks every
 * argument it gets. A path from the renderer must be one the user picked in a file dialog.
 */
export function registerEngineHandlers(
  router: IpcRouter,
  call: EngineCall,
  picked: PickedPaths,
): void {
  router.registerHandlers(
    'jobs',
    {
      list: () => call((api) => api.jobs.list()),
      get: (jobId) => call((api) => api.jobs.get(jobId)),
      save: (job) => call((api) => api.jobs.save(job)),
      createSample: () => call((api) => api.jobs.createSample()),
      importFile: (file) => {
        const chosen = picked.check(file);
        return call((api) => api.jobs.importFile(chosen));
      },
      exportFile: (jobId, file) => {
        const chosen = picked.check(file);
        return call((api) => api.jobs.exportFile(jobId, chosen));
      },
      draftStart: (description, files) => {
        const chosen = files.map((file) => picked.check(file));
        return call((api) => api.jobs.draftStart(description, chosen));
      },
      draftReply: (sessionId, reply) => call((api) => api.jobs.draftReply(sessionId, reply)),
    },
    {
      importFile: z.tuple([text]),
      exportFile: z.tuple([text, text]),
      draftStart: z.tuple([text, z.array(text)]),
    },
  );

  router.registerHandlers('runs', {
    start: (jobId, options) => call((api) => api.runs.start(jobId, options)),
    pause: (runId) => call((api) => api.runs.pause(runId)),
    resume: (runId) => call((api) => api.runs.resume(runId)),
    stop: (runId) => call((api) => api.runs.stop(runId)),
    retest: (runId, target) => call((api) => api.runs.retest(runId, target)),
    get: (runId) => call((api) => api.runs.get(runId)),
    list: (jobId) => call((api) => api.runs.list(jobId)),
    attempt: (attemptId) => call((api) => api.runs.attempt(attemptId)),
    trace: (attemptId) => call((api) => api.runs.trace(attemptId)),
    roundDiff: (runId, round) => call((api) => api.runs.roundDiff(runId, round)),
    runtimeMeasurements: (runId) => call((api) => api.runs.runtimeMeasurements(runId)),
  });

  router.registerHandlers('teach', {
    propose: (chatId, messageId, request) =>
      call((api) => api.teach.propose(chatId, messageId, request)),
    queue: (correctionId) => call((api) => api.teach.queue(correctionId)),
    discard: (correctionId) => call((api) => api.teach.discard(correctionId)),
    apply: (correctionId) => call((api) => api.teach.apply(correctionId)),
    list: (graduateId) => call((api) => api.teach.list(graduateId)),
    improve: (graduateId, options) => call((api) => api.teach.improve(graduateId, options)),
    improvements: (graduateId) => call((api) => api.teach.improvements(graduateId)),
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
    answer: (runId, round, reply) => call((api) => api.mentoring.answer(runId, round, reply)),
    reference: (runId, options) => call((api) => api.mentoring.reference(runId, options)),
    references: (runId) => call((api) => api.mentoring.references(runId)),
  });
}
