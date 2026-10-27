import { z } from 'zod';
import { CheckerConfigSchema } from './checker';
import { DataFileSchema } from './data';

export const JOB_FORMAT = 1;

export const BudgetSchema = z.object({
  maxRounds: z.number().int().min(1).max(100),
  maxMentorUsd: z.number().min(0).max(1000),
  maxWallMinutes: z.number().int().min(1).max(10_080),
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

export const MentorConfigSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('model'),
    provider: z.enum(['meta', 'baseten', 'modal', 'other']),
    label: z.string().min(1),
    baseUrl: z.url(),
    model: z.string().min(1),
    reasoningEffort: ReasoningEffortSchema.default('medium'),
    /** Name of the key in the app's secret store. Never the key itself. */
    secretRef: z.string().min(1),
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
});
export type StudentEndpoint = z.infer<typeof StudentEndpointSchema>;

export const StudentConfigSchema = z.object({
  label: z.string().min(1),
  /** Where the graduate runs, and where the locked test always runs. */
  local: StudentEndpointSchema,
  /** Where training attempts run. `hosted` uses the same weights on a remote endpoint. */
  trainOn: z.enum(['local', 'hosted']).default('local'),
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

export const EvaluationConfigSchema = z.object({
  /** Train tasks the student attempts each round before the mentor diagnoses. */
  trainBatch: z.number().int().min(1),
  /** A change is kept only if net dev passes rise by at least this many tasks. */
  minDevGain: z.number().int().min(1),
  /** ...and no task type loses more than this many dev passes. */
  maxTypeRegression: z.number().int().min(0),
  /**
   * Changes in a row that dev measured and reverted before the run stops early. Rounds whose
   * reply or change set was rejected before dev saw it don't count.
   */
  patience: z.number().int().min(1).default(3),
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

export const TaskTypeInfoSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label: z.string().min(1),
  description: z.string().optional(),
});
export type TaskTypeInfo = z.infer<typeof TaskTypeInfoSchema>;

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
  data: z.object({ files: z.array(DataFileSchema) }),
  permissions: PermissionsSchema,
  checker: CheckerConfigSchema,
  requirements: RequirementsSchema,
  budget: BudgetSchema,
  mentor: MentorConfigSchema,
  student: StudentConfigSchema,
  startingHarness: StartingHarnessSchema,
  splits: SplitConfigSchema,
  evaluation: EvaluationConfigSchema,
});
export type Job = z.infer<typeof JobSchema>;
