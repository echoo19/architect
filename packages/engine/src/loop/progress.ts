import type {
  CapabilityBreakdown,
  Experiment,
  ExperimentBudget,
  Job,
  MentoringProgress,
  ReportCard,
  Score,
  TypeScore,
} from '@architect/shared';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun } from '../store/records';
import { resultOf } from './attempts';
import { isReferenceAttempt } from './configuration';
import { stoppedFromRecords } from './teach';

const EMPTY_BUDGET: ExperimentBudget = {
  mentorUsd: 0,
  mentorInputTokens: 0,
  mentorOutputTokens: 0,
  studentUsd: 0,
  studentInputTokens: 0,
  studentOutputTokens: 0,
  computeUsd: 0,
  computeMinutes: 0,
  examples: 0,
  trainedTokens: 0,
  attempts: 0,
  minutes: 0,
};

function addBudgets(a: ExperimentBudget, b: ExperimentBudget): ExperimentBudget {
  return {
    mentorUsd: a.mentorUsd + b.mentorUsd,
    mentorInputTokens: a.mentorInputTokens + b.mentorInputTokens,
    mentorOutputTokens: a.mentorOutputTokens + b.mentorOutputTokens,
    studentUsd: a.studentUsd === null || b.studentUsd === null ? null : a.studentUsd + b.studentUsd,
    studentInputTokens: a.studentInputTokens + b.studentInputTokens,
    studentOutputTokens: a.studentOutputTokens + b.studentOutputTokens,
    computeUsd: a.computeUsd + b.computeUsd,
    computeMinutes: a.computeMinutes + b.computeMinutes,
    // A sum that holds a job's whole authorization is an upper bound too.
    ...(a.computeSettled === false || b.computeSettled === false
      ? { computeSettled: false as const }
      : {}),
    examples: a.examples + b.examples,
    trainedTokens: a.trainedTokens + b.trainedTokens,
    attempts: a.attempts + b.attempts,
    minutes: a.minutes + b.minutes,
  };
}

/**
 * A run's progress from its stored experiments, lessons and interventions alone, so a screen's
 * numbers always add up to the records it can open: every experiment counts by its disposition,
 * rejected and stopped ones included; dev's current score is the last kept experiment's measured
 * candidate; and what was spent is the sum of the experiments' own budgets.
 */
export function mentoringProgress(
  store: EngineStore,
  record: StoredRun,
  job: Job,
): MentoringProgress {
  const runId = record.run.id;
  const experiments = store.experiments.list(runId);
  const count = (disposition: Experiment['disposition']) =>
    experiments.filter((experiment) => experiment.disposition === disposition).length;
  const kept = experiments.filter((experiment) => experiment.disposition === 'kept');
  const lessons = store.lessons.list({ runId });
  const verified = lessons.filter((lesson) => lesson.status === 'verified');
  const byKind: Record<string, number> = {};
  for (const lesson of verified) byKind[lesson.kind] = (byKind[lesson.kind] ?? 0) + 1;
  return {
    runId,
    experiments: {
      total: experiments.length,
      kept: count('kept'),
      reverted: count('reverted'),
      rejected: count('rejected'),
      invalid: count('invalid'),
      stopped: count('stopped'),
    },
    dev: {
      baseline: record.run.devBaseline,
      current: kept.at(-1)?.devAfter ?? record.run.devBaseline,
    },
    lessons: { verified: verified.length, rejected: lessons.length - verified.length, byKind },
    clarifications: store.interventions
      .list(runId)
      .filter((intervention) => intervention.type === 'clarification').length,
    spent: experiments.reduce(
      (sum, experiment) => addBudgets(sum, experiment.budget),
      EMPTY_BUDGET,
    ),
    budget: {
      maxRounds: job.budget.maxRounds,
      maxMentorUsd: job.budget.maxMentorUsd,
      maxComputeUsd: job.budget.maxComputeUsd ?? 0,
      maxWallMinutes: job.budget.maxWallMinutes,
    },
  };
}

function scoreOf(perType: readonly TypeScore[], type: string): Score | null {
  const score = perType.find((item) => item.type === type);
  return score === undefined ? null : { pass: score.pass, total: score.total };
}

/** The incumbent's dev results per type, from the latest experiment that measured it. */
function incumbentPerType(experiments: readonly Experiment[]): TypeScore[] | null {
  for (const experiment of [...experiments].reverse()) {
    const label =
      experiment.disposition === 'kept'
        ? (['candidate', 'H1/A1'] as const)
        : (['incumbent', 'H1/A0'] as const);
    const measured = experiment.measurements.find((item) =>
      (label as readonly string[]).includes(item.label),
    );
    if (measured) return measured.perType;
  }
  return null;
}

/**
 * The capability breakdown (spec section 9): one row per task type of the job, with practice
 * (train attempts in the latest round that tried the type), check (dev, for the incumbent as the
 * latest experiment measured it, or the baseline before any), the final test from the run's own
 * report card, and the failure categories taught for the type. Each kind of evidence comes from
 * its own records and is never mixed with another. Install checks belong to installations.
 */
export function capabilityBreakdown(
  store: EngineStore,
  record: StoredRun,
  job: Job,
  report: ReportCard | null,
): CapabilityBreakdown {
  const runId = record.run.id;
  const experiments = store.experiments.list(runId);
  const train = store.attempts.list({ runId, split: 'train' });
  const baseline = resultOf(
    store.attempts
      .list({ runId, split: 'dev', round: null })
      .filter((attempt) => !isReferenceAttempt(attempt)),
    job,
  ).perType;
  const check = incumbentPerType(experiments) ?? baseline;
  const verified = store.lessons.list({ runId, status: 'verified' });
  const stopped = stoppedFromRecords(store, runId);
  const categories = store.categories.list(job.id);
  return {
    runId,
    capabilities: job.taskTypes.map((type) => {
      const ofType = train.filter((attempt) => attempt.taskType === type.id);
      const latest = Math.max(-1, ...ofType.map((attempt) => attempt.round ?? -1));
      const practiced = ofType.filter((attempt) => attempt.round === latest);
      const final = report?.test.perType.find((item) => item.type === type.id);
      return {
        type: type.id,
        label: type.label,
        practice:
          practiced.length === 0
            ? null
            : {
                pass: practiced.filter((attempt) => attempt.check.pass).length,
                total: practiced.length,
              },
        check: scoreOf(check, type.id),
        finalTest: final === undefined ? null : { pass: final.pass, total: final.total },
        installCheck: null,
        categories: categories
          .filter((category) => category.taskType === type.id)
          .map((category) => ({
            id: category.id,
            slug: category.slug,
            label: category.label,
            verifiedLessons: verified.filter((lesson) => lesson.categoryId === category.id).length,
            stopped: stopped.categories.has(category.id) || stopped.types.has(type.id),
          })),
      };
    }),
  };
}
