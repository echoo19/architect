import { z } from 'zod';
import { ArmReportSchema, ComparisonReportSchema, FundingPauseSchema } from './comparisons';
import {
  ExperimentDetailSchema,
  ExperimentRecordSchema,
  type ExperimentInput,
} from './experiments';
import { FieldViewSchema, type FieldView } from './field-export';
import { ScoreSchema, type Score } from './lineage';
import type { OrgTypeResult, ReportCard } from './report';
import { StudyBriefSchema } from './study';

/**
 * The JSON `architect field` and `architect experiment` print (docs/CLI.md). Their keys are the
 * ones the app's own records use, so the same schemas read them; each document names its format.
 */
export const FIELD_LIST_FORMAT = 'architect.field-list/1';
export const FIELD_STATUS_FORMAT = 'architect.field-status/1';
export const EXPERIMENT_PLAN_FORMAT = 'architect.experiment-plan/1';
export const EXPERIMENT_FORMAT = 'architect.experiment/1';
export const EXPERIMENT_LIST_FORMAT = 'architect.experiment-list/1';
export const EXPERIMENT_STATUS_FORMAT = 'architect.experiment-status/1';
export const EXPERIMENT_REPORT_FORMAT = 'architect.experiment-report/1';

/**
 * What a new experiment's plan starts with when the person sets nothing else: the app's own
 * defaults, so a plan made in a terminal and one made in the app begin alike.
 */
export function defaultExperimentSettings(): Pick<ExperimentInput, 'seeds' | 'rounds' | 'caps'> {
  return {
    seeds: { mentoring: 1, lockedTest: [101] },
    rounds: 4,
    caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, wallMinutes: 720 },
  };
}

/** A kind of organization not tested is null, never zero. */
const kindScores = {
  /** Organizations it trained on. */
  seen: ScoreSchema.nullable(),
  /** Generated organizations it never saw. */
  unseen: ScoreSchema.nullable(),
  /** Real organizations it never saw. */
  real: ScoreSchema.nullable(),
};

export const FieldCandidateSchema = z.object({
  runId: z.string(),
  createdAt: z.iso.datetime(),
  best: z.boolean(),
  ...kindScores,
  /** Null when the job asked for none. */
  certificate: z.enum(['issued', 'not_issued']).nullable(),
});
export type FieldCandidate = z.infer<typeof FieldCandidateSchema>;

/** One field in the list: what it is made of and how its best candidate did. */
export const FieldRowSchema = z.object({
  jobId: z.string(),
  name: z.string(),
  organizations: z.object({
    taughtOn: z.number().int().nonnegative(),
    neverSeen: z.number().int().nonnegative(),
    /** Null when the job doesn't say whether an organization is real. */
    real: z.number().int().nonnegative().nullable(),
  }),
  /** Frozen versions that took the final test, each a finished run with a report card. */
  versions: z.number().int().nonnegative(),
  /** The best candidate's scores: the highest on the organizations it trained on. */
  best: z.object(kindScores).nullable(),
  /** Candidates holding an issued certificate. */
  certificates: z.number().int().nonnegative(),
});
export type FieldRow = z.infer<typeof FieldRowSchema>;

export const FieldListSchema = z.object({
  format: z.literal(FIELD_LIST_FORMAT),
  fields: z.array(FieldRowSchema),
});
export type FieldList = z.infer<typeof FieldListSchema>;

export const FieldStatusSchema = z.object({
  format: z.literal(FIELD_STATUS_FORMAT),
  ...FieldRowSchema.shape,
  /** What the field is made of, as its page shows it to its owner. */
  field: FieldViewSchema,
  /** Newest first. */
  candidates: z.array(FieldCandidateSchema),
});
export type FieldStatus = z.infer<typeof FieldStatusSchema>;

export const ExperimentPlanDocSchema = ExperimentDetailSchema.extend({
  format: z.literal(EXPERIMENT_PLAN_FORMAT),
});

/** A command that changed an experiment prints where it stands. */
export const ExperimentDocSchema = z.object({
  format: z.literal(EXPERIMENT_FORMAT),
  experiment: ExperimentRecordSchema,
});

export const ExperimentListDocSchema = z.object({
  format: z.literal(EXPERIMENT_LIST_FORMAT),
  experiments: z.array(ExperimentRecordSchema),
});

/**
 * Where an experiment stands: its record, each arm's status and the totals spent. Nothing of the
 * final test or of a sealed organization is in it before the runner released the tests.
 */
export const ExperimentStatusDocSchema = z.object({
  format: z.literal(EXPERIMENT_STATUS_FORMAT),
  experiment: ExperimentRecordSchema,
  released: z.boolean(),
  funding: FundingPauseSchema.nullable(),
  /** Spark's brief of the organizations, with the token that confirms it, when it made one. */
  study: z
    .object({ brief: StudyBriefSchema, token: z.string(), confirmed: z.boolean() })
    .nullable(),
  arms: z.array(ArmReportSchema.pick({ arm: true, label: true, status: true })),
  totals: ComparisonReportSchema.shape.totals.nullable(),
});

/** An experiment's report, once the runner released its tests. */
export const ExperimentReportDocSchema = z.object({
  format: z.literal(EXPERIMENT_REPORT_FORMAT),
  experimentId: z.string(),
  report: ComparisonReportSchema,
});

export interface OrgScores {
  /** Organizations it trained on. */
  seen: Score | null;
  /** Generated organizations it never saw. */
  unseen: Score | null;
  /** Real organizations it never saw. */
  real: Score | null;
}

function add(total: Score | null, result: OrgTypeResult): Score {
  return { pass: (total?.pass ?? 0) + result.pass, total: (total?.total ?? 0) + result.total };
}

/**
 * A final test's results by kind of organization: the ones it trained on, generated ones it
 * never saw, and real ones it never saw. A kind with no tasks is null: not measured. An
 * organization added to the field later is left out, so candidates compare on the same ones.
 */
export function orgScores(perOrg: readonly OrgTypeResult[]): OrgScores {
  const scores: OrgScores = { seen: null, unseen: null, real: null };
  for (const result of perOrg) {
    if (result.total === 0 || result.addedLater === true) continue;
    const kind = result.seen ? 'seen' : result.synthetic ? 'unseen' : 'real';
    scores[kind] = add(scores[kind], result);
  }
  return scores;
}

/**
 * A report card's scores by kind of organization. Seen is the card's own score, which for a job
 * with organizations counts only those it trained on (decision 070).
 */
export function reportScores(report: Pick<ReportCard, 'test'>): OrgScores {
  const { unseen, real } = orgScores(report.test.perOrg ?? []);
  return { seen: report.test.score.total === 0 ? null : report.test.score, unseen, real };
}

const rateOf = (score: Score): number => (score.total === 0 ? 0 : (score.pass * 100) / score.total);

/**
 * The candidate that did best on the organizations it trained on; on a tie, the newest, so
 * candidates come newest first. Null before any took its final test.
 */
export function bestCandidate<T extends { scores: OrgScores }>(candidates: readonly T[]): T | null {
  let best: T | null = null;
  for (const candidate of candidates) {
    const seen = candidate.scores.seen;
    if (seen === null) continue;
    if (!best?.scores.seen || rateOf(seen) > rateOf(best.scores.seen)) best = candidate;
  }
  return best;
}

/** How many organizations a field trains on, how many are sealed, and how many of all are real. */
export function orgCounts(view: FieldView): {
  taughtOn: number;
  sealed: number;
  real: number | null;
} {
  const kinds = [
    ...view.organizations.map((org) => org.synthetic),
    ...view.sealed.map((org) => org.synthetic),
  ];
  return {
    taughtOn: view.organizations.length,
    sealed: view.sealed.length,
    real: kinds.includes(null) ? null : kinds.filter((synthetic) => synthetic === false).length,
  };
}
