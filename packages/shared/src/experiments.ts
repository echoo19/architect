import { z } from 'zod';
import {
  ArmIdSchema,
  CapAmendmentSchema,
  ComparisonReportSchema,
  FundingPauseSchema,
  PinnedInputsSchema,
  ProjectionSchema,
} from './comparisons';
import { ModelMentorSchema, StudentEndpointSchema } from './job';
import { StudyBriefSchema } from './study';

/*
 * Experiments: comparisons the app plans, preregisters, runs and reads through the comparisons
 * runner (decisions 045, 051 and 074). Not the per-round experiments of mentoring (`Experiment`).
 */

/** One arm asked for, with its own caps where the person set them; the runner's otherwise. */
export const ExperimentArmSchema = z
  .object({
    arm: ArmIdSchema,
    /** Spark dollars this arm may spend; the runner's cap for the arm when absent. */
    sparkUsd: z.number().nonnegative().optional(),
    /** Hosted student dollars this arm may spend; its projection times the headroom when absent. */
    studentUsd: z.number().nonnegative().optional(),
  })
  .strict();
export type ExperimentArm = z.infer<typeof ExperimentArmSchema>;

/** The totals an experiment may spend, each a hard cap. */
export const ExperimentCapsSchema = z
  .object({
    studentUsd: z.number().nonnegative(),
    sparkUsd: z.number().nonnegative(),
    computeUsd: z.number().nonnegative(),
    /** Minutes it may run, counted while it runs; it stops when they are up. */
    wallMinutes: z.number().positive(),
  })
  .strict();
export type ExperimentCaps = z.infer<typeof ExperimentCapsSchema>;

/**
 * The seeds a person sets. The split seed is the job's own, pinned with its files, and shown on
 * the experiment; it can't be set here.
 */
export const ExperimentSeedsSchema = z
  .object({
    mentoring: z.number().int(),
    /** The locked test's decoding seeds: the first for every arm, the rest for the repeat. */
    lockedTest: z.array(z.number().int()).min(1),
  })
  .strict();
export type ExperimentSeeds = z.infer<typeof ExperimentSeedsSchema>;

/**
 * The part of the final test a primary comparison reads: all of it, the organizations the arms
 * are taught on, or every organization they never see, together.
 */
export const ExperimentGroupSchema = z.enum(['all', 'seen', 'unseen']);
export type ExperimentGroup = z.infer<typeof ExperimentGroupSchema>;

/** The one comparison an experiment is run to answer: arm `a`'s pass rate less arm `b`'s. */
export const PrimaryComparisonSchema = z
  .object({ a: ArmIdSchema, b: ArmIdSchema, group: ExperimentGroupSchema })
  .strict()
  .refine((comparison) => comparison.a !== comparison.b, {
    message: 'A primary comparison sets two different arms against each other.',
    path: ['b'],
  });
export type PrimaryComparison = z.infer<typeof PrimaryComparisonSchema>;

export const ExperimentInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /**
     * A field in the library, by its job id: the runner reads its stored job and tasks, and its
     * sealed organizations from the vault (decision 074, amended Oct 30). Set this or `jobDir`.
     */
    jobId: z.string().min(1).optional(),
    /** The job's folder: job.json, tasks.jsonl, data/ (or orgs/<id>/data/) and its checker. */
    jobDir: z.string().min(1).optional(),
    /** What the person expects and why, in their words; required before it is preregistered. */
    hypothesis: z.string().max(2000).optional(),
    /** The comparison the hypothesis is about; required before it is preregistered. */
    primaryComparison: PrimaryComparisonSchema.optional(),
    arms: z.array(ExperimentArmSchema).min(1),
    seeds: ExperimentSeedsSchema,
    /** Refinement rounds for the arms whose rounds decide their size, at most. */
    rounds: z.number().int().min(1).max(10),
    caps: ExperimentCapsSchema,
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.jobId === undefined) === (input.jobDir === undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['jobId'],
        message: 'An experiment runs on a field in the library or on a folder, one of the two.',
      });
    }
    const arms = input.arms.map((item) => item.arm);
    if (new Set(arms).size !== arms.length) {
      context.addIssue({ code: 'custom', path: ['arms'], message: 'Each arm is asked for once.' });
    }
    const weights = input.arms.filter((item) => item.arm.startsWith('weights-'));
    if (new Set(weights.map((item) => item.sparkUsd)).size > 1) {
      context.addIssue({
        code: 'custom',
        path: ['arms'],
        message: 'The two weights arms share one Spark cap.',
      });
    }
  });
export type ExperimentInput = z.infer<typeof ExperimentInputSchema>;

export const ExperimentStatusSchema = z.enum([
  /** Planned; arms, seeds and caps may still change. */
  'draft',
  /** The bare student prices an attempt on the calibration tasks, and Spark studies a field. */
  'calibrating',
  /** Frozen: nothing about its arms, seeds or caps can change. */
  'preregistered',
  'running',
  'paused',
  /** Waiting for the person: Spark's brief to confirm, or a plan the caps cut down. */
  'waiting',
  /**
   * Waiting for the person before any final test is released: an arm can't be paid for at what
   * an attempt has really cost. They raise the student cap or drop the arm (decision 081).
   */
  'needs_funding',
  /** Stopped short of finishing on its own: a measurement paused, a test held, or a guard hit. */
  'incomplete',
  'finished',
  /** Stopped by the person or by its wall clock; it doesn't start again. */
  'stopped',
  'failed',
]);
export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;

/**
 * The models a comparison runs: the field's own teacher and hosted student where it has them,
 * the defaults otherwise (decision 094). A preset goes by its key, any other model by its whole
 * address; a key's value is never here, only the name it is stored under.
 */
export const ExperimentModelsSchema = z.object({
  mentor: z.union([z.string().min(1), ModelMentorSchema]),
  student: z.union([z.string().min(1), StudentEndpointSchema]),
  /** The providers OpenRouter may route the hosted student to, with no fallback; any when absent. */
  providers: z.array(z.string().min(1)).min(1).optional(),
  /** The student on this computer, by its name in Ollama's store, which graduates pin. */
  localModel: z.string().min(1),
});
export type ExperimentModels = z.infer<typeof ExperimentModelsSchema>;

/** The plan frozen before it ran: what was frozen, its hash and when. */
export const PreregistrationSchema = z.object({
  at: z.iso.datetime(),
  /** The sha256 of the input and the pinned job files, as stored. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  pinned: PinnedInputsSchema,
  /** The models it runs, frozen with it; absent on one preregistered before they were kept. */
  models: ExperimentModelsSchema.optional(),
});
export type Preregistration = z.infer<typeof PreregistrationSchema>;

export const ExperimentRecordSchema = z.object({
  id: z.string().min(1),
  input: ExperimentInputSchema,
  job: z.object({ id: z.string(), name: z.string(), splitsSeed: z.number().int() }),
  status: ExperimentStatusSchema,
  /** Why it waits, stopped or failed, in a sentence. */
  reason: z.string().optional(),
  preregistration: PreregistrationSchema.nullable(),
  calibratedAt: z.iso.datetime().nullable(),
  /** Wall clock used so far, in milliseconds, while running. */
  runningMs: z.number().nonnegative(),
  /** When the run going on now began, so a crash still charges its time to the wall clock. */
  runningSince: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ExperimentRecord = z.infer<typeof ExperimentRecordSchema>;

/** What calibration will cost, shown before it runs. */
export const CalibrationCostSchema = z.object({
  tasks: z.number().int().nonnegative(),
  /** Calibration's hosted attempts at the assumed price of one. */
  studentUsdEstimate: z.number().nonnegative(),
  /** The most calibration may spend on the student: the experiment's student cap. */
  studentUsdCap: z.number().nonnegative(),
  /** The most Spark's study of the organizations may cost; null for a job with nothing to study. */
  studySparkUsdCap: z.number().nonnegative().nullable(),
});
export type CalibrationCost = z.infer<typeof CalibrationCostSchema>;

export const ExperimentDetailSchema = z.object({
  experiment: ExperimentRecordSchema,
  /** The teacher and the hosted student it runs, by their labels, for every line that names them. */
  names: z.object({ mentor: z.string().min(1), student: z.string().min(1) }),
  /** Each arm projected: from calibration's measured price once it ran, assumed before. */
  projection: ProjectionSchema,
  calibration: CalibrationCostSchema,
  /** The parts of the final test the job has, for a primary comparison to read. */
  groups: z.array(ExperimentGroupSchema).min(1),
  /** Spark's brief of the organizations, for the person to read and confirm with its token. */
  study: z
    .object({ brief: StudyBriefSchema, token: z.string(), confirmed: z.boolean() })
    .nullable(),
  /** Whether the locked tests were released: every arm frozen or ended first. */
  released: z.boolean(),
  /** Why it waits for money before the release, when it does (decision 081). */
  funding: FundingPauseSchema.nullable(),
  /** The student cap as the person raised it before the release, each raise in order. */
  amendments: z.array(CapAmendmentSchema),
  /**
   * The runner's report from stored records: each arm's status, spend, caps and rounds, and once
   * released, results per arm and organization and the paired comparisons. Its `backends` are
   * empty until then. Null before the runner has records.
   */
  report: ComparisonReportSchema.nullable(),
});
export type ExperimentDetail = z.infer<typeof ExperimentDetailSchema>;

/** Options for starting or resuming an experiment. */
export const ExperimentStartSchema = z
  .object({
    /** Go ahead with a plan the caps cut down, as the runner's `--confirm`. */
    confirm: z.boolean().optional(),
    /** The token of Spark's brief the person read, as the runner's `--confirm-study`. */
    studyToken: z.string().min(1).optional(),
    /** A raised student cap, the answer to `needs_funding`; recorded as an amendment. */
    studentCapUsd: z.number().positive().optional(),
    /** Arms dropped by the person, the other answer to `needs_funding`. */
    dropArms: z.array(ArmIdSchema).min(1).optional(),
  })
  .strict();
export type ExperimentStart = z.infer<typeof ExperimentStartSchema>;

/** Sent whenever an experiment's record or its arms move, so a screen reads it again. */
export const ExperimentEventSchema = z.object({
  type: z.literal('experiment.updated'),
  experimentId: z.string(),
  at: z.iso.datetime(),
  experiment: ExperimentRecordSchema,
});
export type ExperimentEvent = z.infer<typeof ExperimentEventSchema>;
