import { z } from 'zod';
import { CheckerConfigSchema } from './checker';
import { DataFileSchema } from './data';
import { AllowedInterventionsSchema } from './interventions';
import { loopbackEndpointIssue } from './net';
import {
  DEFAULT_MENTOR_PRESET,
  DEFAULT_STUDENT,
  mentorPreset,
  PROVIDER_IDS,
  TokenPricingSchema,
} from './models';

export const JOB_FORMAT = 1;

export const BudgetSchema = z.object({
  maxRounds: z.number().int().min(1).max(100),
  maxMentorUsd: z.number().min(0).max(1000),
  maxWallMinutes: z.number().int().min(1).max(10_080),
  /**
   * Dollars of training compute a run may spend on adapters. Absent means none: only the
   * stand-in backend, which costs nothing and trains nothing, can take a weights intervention.
   */
  maxComputeUsd: z.number().min(0).max(1000).optional(),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const RequirementsSchema = z.object({
  /** Share of locked-test tasks the graduate must pass, 0 to 1. */
  passRate: z.number().min(0).max(1),
  /** Optional ceiling on the 95th-percentile answer time. */
  p95LatencyMs: z.number().int().positive().optional(),
});
export type Requirements = z.infer<typeof RequirementsSchema>;

export const ReasoningEffortSchema = z.enum(['low', 'medium', 'high']);
export type ReasoningEffort = z.infer<typeof ReasoningEffortSchema>;

export const ProviderIdSchema = z.enum(PROVIDER_IDS);

export const MentorConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('model'),
    provider: ProviderIdSchema,
    label: z.string().min(1),
    baseUrl: z.url(),
    model: z.string().min(1),
    reasoningEffort: ReasoningEffortSchema.default('medium'),
    /** Name of the key in the app's secret store. Never the key itself. None for a local model. */
    secretRef: z.string().min(1).optional(),
    /**
     * The price the cap is kept with, when no preset knows it: OpenRouter's listed price when the
     * model was chosen, or what the user entered for an endpoint they added.
     */
    pricing: TokenPricingSchema.optional(),
  }),
  z.object({
    kind: z.literal('coding_agent'),
    agent: z.literal('claude_code'),
    label: z.string().min(1),
  }),
]);
export type MentorConfig = z.infer<typeof MentorConfigSchema>;

export const StudentEndpointSchema = z.object({
  runtime: z.enum(['ollama', 'openai_compatible']),
  baseUrl: z.url(),
  model: z.string().min(1),
  secretRef: z.string().min(1).optional(),
  /** Context window to request from the runtime (Ollama `num_ctx`). */
  contextLength: z.number().int().min(2048).max(262_144).default(16_384),
  /** A hosted copy's price, when no preset knows it (OpenRouter lists one). */
  pricing: TokenPricingSchema.optional(),
  /**
   * On OpenRouter, the providers a request may go to, in order, with no fallback to any other,
   * so every attempt of a comparison runs on one provider's serving of the model (decision 045):
   * providers serve Glimmer at different precisions. Any provider when absent.
   */
  providers: z.array(z.string().min(1)).min(1).optional(),
});
export type StudentEndpoint = z.infer<typeof StudentEndpointSchema>;

/** One of the job's student endpoints: the local one, or its hosted copy of the same weights. */
export const StudentTargetSchema = z.enum(['local', 'hosted']);
export type StudentTarget = z.infer<typeof StudentTargetSchema>;

export const StudentConfigSchema = z.object({
  label: z.string().min(1),
  /**
   * Where the graduate runs, and where its locked test runs unless the run picks the hosted copy.
   * A graduate makes no call off this computer (invariant 3), so the address must be this
   * computer's: an OpenAI-compatible server here counts only when it is bound to loopback.
   */
  local: StudentEndpointSchema.superRefine((endpoint, context) => {
    const issue = loopbackEndpointIssue(endpoint.baseUrl);
    if (issue !== null) context.addIssue({ code: 'custom', path: ['baseUrl'], message: issue });
  }),
  /** Where training attempts run. `hosted` uses the same weights on a remote endpoint. */
  trainOn: StudentTargetSchema.default('local'),
  hosted: StudentEndpointSchema.optional(),
});
export type StudentConfig = z.infer<typeof StudentConfigSchema>;

export const StartingHarnessSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('blank') }),
  z.object({ kind: z.literal('template'), template: z.string().min(1) }),
  z.object({ kind: z.literal('import'), path: z.string().min(1) }),
]);
export type StartingHarness = z.infer<typeof StartingHarnessSchema>;

export const SplitConfigSchema = z.object({
  seed: z.number().int(),
  calibration: z.number().int().min(0),
  train: z.number().int().min(1),
  dev: z.number().int().min(1),
  test: z.number().int().min(1),
});
export type SplitConfig = z.infer<typeof SplitConfigSchema>;

export const CertifySettingsSchema = z.object({
  /** Attempts per request; their agreement decides whether to answer. 1 turns agreement off. */
  k: z.number().int().min(1).max(9).default(5),
  /** The selective error the certificate must bound: wrong answers among those given. */
  epsilon: z.number().gt(0).lt(1).default(0.1),
  /** One minus the confidence the bound holds with. */
  delta: z.number().gt(0).max(0.5).default(0.05),
  /**
   * Tasks of the organizations the job trains on sealed for calibration. Absent: 15% of them,
   * at least 30 when there are that many to spare.
   */
  calibration: z.number().int().min(1).optional(),
});
export type CertifySettings = z.infer<typeof CertifySettingsSchema>;

export const EvaluationConfigSchema = z.object({
  /** Train tasks the student attempts each round before the mentor diagnoses. */
  trainBatch: z.number().int().min(1),
  /** A change is kept only if net dev passes rise by at least this many tasks per repeat. */
  minDevGain: z.number().int().min(1),
  /** ...and no task type loses more than this many dev passes per repeat. */
  maxTypeRegression: z.number().int().min(0),
  /**
   * How many seeds each dev evaluation runs every task under, 1 to 3. Passes add up across
   * them, and the two limits above scale with the count, so a lucky draw is less likely kept.
   */
  devRepeats: z.number().int().min(1).max(3).default(1),
  /**
   * Changes in a row that dev measured and reverted before the run stops early. Rounds whose
   * reply or change set was rejected before dev saw it don't count.
   */
  patience: z.number().int().min(1).default(3),
  /**
   * The locked test's decoding seeds, declared before any run: every test task is attempted once
   * under each, and each repeat is recorded apart. Repeats are never counted as more scenarios.
   * Absent: one repeat, under the seed the run derives from its own.
   */
  lockedTestSeeds: z
    .array(z.number().int().nonnegative())
    .min(1)
    .max(4)
    .refine(
      (seeds) => new Set(seeds).size === seeds.length,
      'Each locked-test seed may appear once.',
    )
    .optional(),
  /**
   * Certified answers (decision 077): after freezing, the graduate makes k attempts at each task
   * of a sealed calibration split and of the locked test, answers when enough of them agree and
   * hands the request to a person otherwise, and the report states a bound on how often an
   * answer it gives is wrong. Absent: no calibration split and no certificate, as before.
   */
  certify: CertifySettingsSchema.optional(),
});
export type EvaluationConfig = z.infer<typeof EvaluationConfigSchema>;

export const PermissionModeSchema = z.enum(['ask', 'allow', 'never']);
export type PermissionMode = z.infer<typeof PermissionModeSchema>;

export const PermissionsSchema = z.object({
  /** Writes in the workspace: ask every time, allow, or never. Training writes go to a scratch copy. */
  writes: PermissionModeSchema,
  /** Opening files that the job didn't declare. */
  unseenFiles: PermissionModeSchema,
});
export type Permissions = z.infer<typeof PermissionsSchema>;

/**
 * What of a job's content may leave this computer besides the mentor's view of train attempts,
 * which training always sends. Absent means neither.
 */
export const DataSharingSchema = z.object({
  /** Verified lessons may go to remote compute to train an adapter. */
  remoteTraining: z.boolean(),
  /**
   * A workspace correction may go to the mentor, once the person confirms that one correction.
   * Corrections never leave this computer otherwise.
   */
  corrections: z.boolean(),
  /**
   * The taught organizations' recordings may go to Meta to be transcribed for the study (decision
   * 087). Absent means no.
   */
  recordings: z.boolean().optional(),
});
export type DataSharing = z.infer<typeof DataSharingSchema>;

export const TaskTypeInfoSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type TaskTypeInfo = z.infer<typeof TaskTypeInfoSchema>;

/** An organization id becomes a folder name (`orgs/<id>/data/`), so only plain ones are taken. */
export const ORG_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * One organization a job serves (decision 068). Its files sit at `orgs/<id>/data/` in the job
 * folder, under the names the job's data declares. A `train` organization is practiced on; a
 * `transfer` one is never seen in training: its files and tasks are sealed apart and opened only
 * for the locked test.
 */
export const OrganizationSchema = z.object({
  id: z.string().regex(ORG_ID),
  name: z.string().min(1),
  /** Generated from seeds, or a real organization's records. */
  synthetic: z.boolean(),
  role: z.enum(['train', 'transfer']),
});
export type Organization = z.infer<typeof OrganizationSchema>;

/** A lowercase, singular word for one organization: "academy", "clinic", "branch office". */
export const OrganizationNounSchema = z
  .string()
  .min(1)
  .max(30)
  .regex(/^[a-z][a-z -]*[a-z]$|^[a-z]$/, 'is not a lowercase word');

/** The word for one of a job's organizations, as the app writes it. */
export function organizationNoun(job: { organizationNoun?: string | undefined }): string {
  return job.organizationNoun ?? 'organization';
}

export const JobSchema = z.object({
  format: z.literal(JOB_FORMAT),
  id: z.string().min(1),
  /** The agent's name as the user sees it, e.g. "Service desk". */
  name: z.string().min(1).max(60),
  description: z.string().min(1),
  /** One line under the name on the Define screen. */
  summary: z.string().optional(),
  /** Plain-language capabilities and limits shown on the Define screen. */
  does: z.array(z.string()).default([]),
  doesNot: z.array(z.string()).default([]),
  createdAt: z.iso.datetime(),
  /**
   * The date the job's records are current as of (YYYY-MM-DD). When set, the agent treats it as
   * today, in training and in the workspace, so a snapshot like the sample data stays coherent.
   */
  businessDate: z.iso.date().optional(),
  taskTypes: z.array(TaskTypeInfoSchema).min(1),
  data: z.object({
    files: z.array(DataFileSchema),
    /**
     * An `output/` folder the agent may create and change files in, such as reports, through the
     * same write permissions as the data. Absent when the job allows none.
     */
    output: z.object({ description: z.string().optional() }).optional(),
  }),
  permissions: PermissionsSchema,
  checker: CheckerConfigSchema,
  requirements: RequirementsSchema,
  budget: BudgetSchema,
  mentor: MentorConfigSchema,
  student: StudentConfigSchema,
  startingHarness: StartingHarnessSchema,
  splits: SplitConfigSchema,
  evaluation: EvaluationConfigSchema,
  sharing: DataSharingSchema.optional(),
  /**
   * The kinds of change the mentor may choose from each round (decision 063). Absent means all
   * five, which is how every job from before this setting reads. It is a training setting like
   * the mentor and the budget, so a graduate's contract and package don't carry it.
   */
  interventions: AllowedInterventionsSchema.optional(),
  /**
   * The organizations the job serves, each with its own files (decision 068). Absent: one
   * organization, whose files are the job's `data/`. A job in the library lists only the ones it
   * trains on; a transfer organization is taken out when the job is made and kept sealed.
   */
  organizations: z
    .array(OrganizationSchema)
    .min(1)
    .refine(
      (orgs) => new Set(orgs.map((org) => org.id)).size === orgs.length,
      'Each organization needs its own id.',
    )
    .optional(),
  /**
   * The word the app uses for one of the job's organizations, such as "academy" or "clinic",
   * lowercase and singular. Absent: "organization".
   */
  organizationNoun: OrganizationNounSchema.optional(),
});
export type Job = z.infer<typeof JobSchema>;

/**
 * The sample jobs shipped with the app: the service desk, and Academy desk, a staff-facing agent for
 * test-prep academies, taught at three of them and tested at one it never sees.
 */
export const SampleJobSchema = z.enum(['home-services', 'academy']);
export type SampleJob = z.infer<typeof SampleJobSchema>;

/** The organizations a job trains on: every listed one whose role is `train`. */
export function trainOrganizations(job: Pick<Job, 'organizations'>): Organization[] {
  return (job.organizations ?? []).filter((org) => org.role === 'train');
}

/**
 * The teacher and the agent's model a new job starts with, as the sample jobs ship them: Muse
 * Spark through Meta, and Muse Glimmer on this computer through Ollama. The app puts the models
 * the person chose in Settings on a job when it arrives.
 */
export function shippedModels(): Pick<Job, 'mentor' | 'student'> {
  const preset = mentorPreset(DEFAULT_MENTOR_PRESET);
  return {
    mentor: {
      kind: 'model',
      provider: preset.provider,
      label: preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
      reasoningEffort: 'medium',
      secretRef: preset.secretRef,
    },
    student: {
      label: DEFAULT_STUDENT.label,
      local: {
        runtime: DEFAULT_STUDENT.runtime,
        baseUrl: DEFAULT_STUDENT.baseUrl,
        model: DEFAULT_STUDENT.model,
        contextLength: DEFAULT_STUDENT.contextLength,
      },
      trainOn: 'local',
    },
  };
}
