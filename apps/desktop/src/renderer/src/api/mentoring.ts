import { useEffect } from 'react';
import {
  CapabilityBreakdownSchema,
  CategorySchema,
  ExperimentSchema,
  InterventionSchema,
  ListedLessonSchema,
  ListedAttemptSchema,
  MentoringProgressSchema,
  ReferenceRecordSchema,
  RunEventSchema,
  TraceSchema,
  type Category,
  type Experiment,
  type Intervention,
  type ListedLesson,
  type MentoringProgress,
} from '@architect/shared';
import { z } from 'zod';
import { architect, read } from './client';
import { useQuery } from './query';

/**
 * The records of failure-specific mentoring, as the engine stores them. Every number the
 * evidence screens show comes from these, never from anything worked out on a screen.
 */
export const mentoringApi = {
  lessons: (runId: string) =>
    read('mentoring.lessons', z.array(ListedLessonSchema), architect().mentoring.lessons(runId)),
  lessonTrace: (lessonId: string) =>
    read(
      'mentoring.lessonTrace',
      TraceSchema.nullable(),
      architect().mentoring.lessonTrace(lessonId),
    ),
  interventions: (runId: string) =>
    read(
      'mentoring.interventions',
      z.array(InterventionSchema),
      architect().mentoring.interventions(runId),
    ),
  experiments: (runId: string) =>
    read(
      'mentoring.experiments',
      z.array(ExperimentSchema),
      architect().mentoring.experiments(runId),
    ),
  progress: (runId: string) =>
    read('mentoring.progress', MentoringProgressSchema, architect().mentoring.progress(runId)),
  capabilities: (runId: string) =>
    read(
      'mentoring.capabilities',
      CapabilityBreakdownSchema,
      architect().mentoring.capabilities(runId),
    ),
  references: (runId: string) =>
    read(
      'mentoring.references',
      z.array(ReferenceRecordSchema),
      architect().mentoring.references(runId),
    ),
  attempt: (attemptId: string) =>
    read('runs.attempt', ListedAttemptSchema, architect().runs.attempt(attemptId)),
  categories: (jobId: string) =>
    read('mentoring.categories', z.array(CategorySchema), architect().mentoring.categories(jobId)),
};

/** A run's lessons, interventions, experiments and progress, and its job's categories. */
export interface MentoringRecords {
  lessons: ListedLesson[];
  interventions: Intervention[];
  experiments: Experiment[];
  progress: MentoringProgress;
  categories: Category[];
}

async function loadRecords(runId: string, jobId: string): Promise<MentoringRecords> {
  const [lessons, interventions, experiments, progress, categories] = await Promise.all([
    mentoringApi.lessons(runId),
    mentoringApi.interventions(runId),
    mentoringApi.experiments(runId),
    mentoringApi.progress(runId),
    mentoringApi.categories(jobId),
  ]);
  return { lessons, interventions, experiments, progress, categories };
}

export const mentoringKeys = {
  records: (runId: string) => `mentoring:${runId}`,
  lessonTrace: (lessonId: string) => `lesson-trace:${lessonId}`,
  attempt: (attemptId: string) => `attempt:${attemptId}`,
};

/** Records a round stores together are announced together; one read follows them all. */
const SETTLE_MS = 200;

/**
 * A run's mentoring records, read again whenever the engine says one of them changed, so a
 * screen open during training shows each lesson and experiment as it is stored.
 */
export function useMentoringRecords(runId: string, jobId: string) {
  const records = useQuery(mentoringKeys.records(runId), () => loadRecords(runId, jobId));
  const { reload } = records;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = architect().runs.onEvent((payload) => {
      const event = RunEventSchema.safeParse(payload);
      if (!event.success || event.data.runId !== runId) return;
      if (event.data.type !== 'mentoring.updated') return;
      clearTimeout(timer);
      timer = setTimeout(reload, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [runId, reload]);
  return records;
}
