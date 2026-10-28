import { z } from 'zod';
import { ChatMessageSchema } from './chat';
import { CheckResultSchema } from './checker';
import { DecodingSchema } from './harness';
import { ScoreSchema } from './lineage';
import {
  CostEstimateSchema,
  EvidenceSchema,
  FileEditSchema,
  InterventionTypeSchema,
  PredictionSchema,
  TypeScoreSchema,
  type InterventionType,
} from './mentor';
import { EpisodeKindSchema, VerifiedEpisodeSchema } from './training';

/*
 * Failure-specific mentoring (decision 042): what the mentor finds in failed train attempts, the
 * one intervention it picks from the bounded menu, the lessons a verified correction becomes, and
 * the experiment every round that tries a change ends in. The engine stores these records and every number the
 * evidence screens show is computed from them.
 */

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** The types that change only the harness and go through the authoring path. */
export const HARNESS_INTERVENTIONS: readonly InterventionType[] = [
  'procedure',
  'retrieval',
  'helper',
];

/**
 * A failure category in a job's own vocabulary. Its id never changes once it is made, and a
 * slug that normalizes to an existing one reuses that id, so renaming a category can't reset
 * the caps kept against it.
 */
export const CategorySchema = z.object({
  id: z.string().regex(/^cat_[a-z0-9]+$/),
  jobId: z.string().min(1),
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  label: z.string().min(1).max(80),
  /** The task type the category belongs to; its caps also count against this type. */
  taskType: z.string().min(1),
  createdAt: z.iso.datetime(),
});
export type Category = z.infer<typeof CategorySchema>;

/**
 * One failed train attempt as the mentor diagnosed it, after the runner checked it against the
 * attempt. The failure turn is a suspicion, not proven causality: a checkpoint resumes after the
 * last whole tool batch before it, which is the start of that turn.
 */
export const FindingSchema = z.object({
  attemptId: z.string().min(1),
  taskId: z.string().min(1),
  taskType: z.string().min(1),
  failureTurn: z.number().int().positive(),
  evidence: z.array(EvidenceSchema).min(1),
  cause: z.string().min(1),
  categoryId: z.string().min(1),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A trained adapter, as the training job that made it left it. */
export const TrainedAdapterSchema = z.object({
  /** The training job's id. */
  id: z.string().min(1),
  /** The GGUF LoRA, relative to the data folder. */
  path: z.string().min(1),
  sha256: sha256Hex,
  /** True for the stand-in backend: no model was trained, and the adapter changes nothing. */
  standIn: z.boolean(),
  /** What the training backend is called, e.g. `Hugging Face Jobs`. */
  label: z.string().min(1),
});
export type TrainedAdapter = z.infer<typeof TrainedAdapterSchema>;

/** The person's answer to a clarification, recorded before any label is made. */
export const ClarificationAnswerSchema = z.object({
  text: z.string().min(1),
  /** The answer changes what counts as success, which only a new job contract can. */
  changesCriteria: z.boolean(),
  at: z.iso.datetime(),
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;

/** One unit of teaching the runner planned for a round, fixed before the first one runs. */
export const TeachingItemSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('repair'),
    /** The finding, by its place in the intervention's findings. */
    finding: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('practice'),
    finding: z.number().int().nonnegative(),
    /** Another train task of the finding's category, demonstrated from the start. */
    taskId: z.string().min(1),
  }),
  z.object({
    /**
     * A train task chosen by seed, not from any failure, demonstrated from the start: what a
     * one-shot adapter trains on (decision 045).
     */
    kind: z.literal('demonstration'),
    taskId: z.string().min(1),
  }),
]);
export type TeachingItem = z.infer<typeof TeachingItemSchema>;

/** A round's teaching: what it will try, and what it set aside before trying. */
export const TeachingPlanSchema = z.object({
  items: z.array(TeachingItemSchema),
  skipped: z.array(z.object({ what: z.string(), reason: z.string() })),
});
export type TeachingPlan = z.infer<typeof TeachingPlanSchema>;

/** The round's one intervention, as the runner accepted or refused it. */
export const InterventionSchema = z.object({
  id: z.string().min(1),
  runId: z.string().min(1),
  round: z.number().int().positive(),
  type: InterventionTypeSchema,
  title: z.string(),
  hypothesis: z.string(),
  findings: z.array(FindingSchema),
  /** Findings the runner set aside, and why: a passed task, a turn past the attempt's end. */
  setAside: z.array(z.object({ taskId: z.string(), reason: z.string() })),
  /** The harness change set, for procedure, retrieval and helper interventions. */
  edits: z.array(FileEditSchema),
  /** Words that load the round's verified lessons as worked examples; none adds no examples. */
  workedExamples: z.array(z.string()),
  /** Related practice tasks per finding. */
  practicePerFinding: z.number().int().nonnegative(),
  question: z.string().optional(),
  answer: ClarificationAnswerSchema.optional(),
  predicted: PredictionSchema,
  estimatedCost: CostEstimateSchema,
  verificationPlan: z.string(),
  /** What the candidate derives from: the incumbent harness and adapter. */
  parent: z.object({
    harnessVersion: z.number().int().nonnegative(),
    adapter: TrainedAdapterSchema.nullable(),
  }),
  status: z.enum(['accepted', 'invalid']),
  /** Why the runner refused it. */
  invalidReason: z.string().optional(),
  teaching: TeachingPlanSchema.optional(),
  /** The training job a weights intervention made, once it is made. */
  trainingJobId: z.string().optional(),
  createdAt: z.iso.datetime(),
});
export type Intervention = z.infer<typeof InterventionSchema>;

/** Where a lesson's request came from. */
export const LessonSourceSchema = z.discriminatedUnion('kind', [
  /** A failed train attempt the mentor diagnosed. */
  z.object({
    kind: z.literal('attempt'),
    attemptId: z.string().min(1),
    taskId: z.string().min(1),
  }),
  /** Another train task of the same category, demonstrated from the start. */
  z.object({ kind: z.literal('practice'), taskId: z.string().min(1) }),
  /** A correction the person made in the workspace with Teach this. */
  z.object({ kind: z.literal('correction'), correctionId: z.string().min(1) }),
]);
export type LessonSource = z.infer<typeof LessonSourceSchema>;

/** How the continuation's starting state was made. */
export const CheckpointRecordSchema = z.object({
  /** The model turn the continuation took first; 1 is the start of the task. */
  turn: z.number().int().positive(),
  /** Recorded tool calls replayed to rebuild the state. */
  replayedCalls: z.number().int().nonnegative(),
  /**
   * `earlier`: the try from the suspected turn didn't verify (its replay didn't hold, or the
   * continuation failed the checker or the audit) and one turn before it was used; `full_task`:
   * the task was demonstrated from the start.
   */
  fallback: z.enum(['none', 'earlier', 'full_task']),
});
export type CheckpointRecord = z.infer<typeof CheckpointRecordSchema>;

/** What the mutation audit found in a continuation's writes, intermediate ones included. */
export const MutationAuditSchema = z.object({
  ok: z.boolean(),
  problems: z.array(z.string()),
  /** Files the episode changed, by path. */
  changed: z.array(z.string()),
});
export type MutationAudit = z.infer<typeof MutationAuditSchema>;

/** What a lesson cost in mentor calls. */
export const LessonCostSchema = z.object({
  usd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  calls: z.number().int().nonnegative(),
});
export type LessonCost = z.infer<typeof LessonCostSchema>;

/**
 * A correction the runner tried to verify. A verified one carries the episode the dataset
 * builder takes, where only the mentor's own turns are targets and the student's prefix is
 * context. A rejected one is kept with the reason, never trained on.
 */
export const LessonSchema = z.object({
  id: z.string().regex(/^lsn_[a-z0-9]+$/),
  jobId: z.string().min(1),
  runId: z.string().nullable(),
  round: z.number().int().positive().nullable(),
  interventionId: z.string().nullable(),
  status: z.enum(['verified', 'rejected']),
  /** Why it was rejected, or the checker's reason for a verified one. */
  reason: z.string().min(1),
  kind: EpisodeKindSchema,
  categoryId: z.string().nullable(),
  taskType: z.string().min(1),
  source: LessonSourceSchema,
  /** For a repair: what the mentor suspected went wrong. */
  diagnosis: z
    .object({
      failureTurn: z.number().int().positive(),
      cause: z.string(),
      evidence: z.array(EvidenceSchema),
    })
    .optional(),
  checkpoint: CheckpointRecordSchema.nullable(),
  check: CheckResultSchema.nullable(),
  audit: MutationAuditSchema.nullable(),
  /** The mentor's own turns in the continuation, kept for review when it was rejected too. */
  turns: z.array(ChatMessageSchema),
  episode: VerifiedEpisodeSchema.nullable(),
  actorModel: z.string(),
  cost: LessonCostSchema,
  createdAt: z.iso.datetime(),
});
export type Lesson = z.infer<typeof LessonSchema>;

/** Who attempts a task: the student, or the mentor's model run as a reference. */
export const ActorSchema = z.enum(['student', 'reference']);
export type Actor = z.infer<typeof ActorSchema>;

/**
 * What an attempt ran as, beside its harness version: who acted, on which backend, with which
 * adapter at which scale. Attempts under different configurations are never reused for each other.
 */
export const ConfigurationSchema = z.object({
  harnessVersion: z.number().int().nonnegative(),
  actor: ActorSchema,
  /** `ollama`, `openai_compatible`, `llama.cpp`, or a reference model's provider. */
  backend: z.string().min(1),
  adapter: z.object({ id: z.string().min(1), scale: z.number() }).nullable(),
});
export type Configuration = z.infer<typeof ConfigurationSchema>;

/** The configuration every attempt before this record had: the job's student, no adapter. */
export const DEFAULT_CONFIG_KEY = 'student';

/** One configuration measured on dev under a round's seeds. */
export const MeasurementSchema = z.object({
  /** `incumbent`, `candidate`, or for an adapter round `H0/A0`, `H1/A0`, `H0/A1`, `H1/A1`. */
  label: z.string().min(1),
  configuration: ConfigurationSchema,
  seeds: z.array(z.number().int()),
  score: ScoreSchema,
  perType: z.array(TypeScoreSchema),
  latencyMs: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }),
  /** Where the numbers come from: measured for this experiment, or reused and from where. */
  provenance: z.string().min(1),
  /** The tasks it ran on: dev when absent, or train for a smoke check (decision 051). */
  split: z.enum(['dev', 'train']).optional(),
});
export type Measurement = z.infer<typeof MeasurementSchema>;

export const ExperimentDispositionSchema = z.enum([
  /** Cleared the keep rule and every hard gate. */
  'kept',
  /** Measured; no harm past the limits, but short of the margin. */
  'reverted',
  /** Measured; harmful, or it failed a hard gate. The prior version stays. */
  'rejected',
  /** Never measured: the runner refused it or couldn't build it. */
  'invalid',
  /** Cut short by a stop, the wall clock or a spent budget before it was decided. */
  'stopped',
]);
export type ExperimentDisposition = z.infer<typeof ExperimentDispositionSchema>;

export const ExperimentKindSchema = z.enum(['draft', 'harness', 'weights']);
export type ExperimentKind = z.infer<typeof ExperimentKindSchema>;

export const GateResultSchema = z.object({
  gate: z.enum(['permission', 'device', 'stand_in', 'smoke']),
  passed: z.boolean(),
  detail: z.string(),
});
export type GateResult = z.infer<typeof GateResultSchema>;

/**
 * What an experiment actually spent, from the cost ledger, the attempts and the training job.
 * Each line stays apart, as decision 037's reporting asks: Spark's tokens and dollars, the
 * student's, compute dollars and minutes, and what was trained on.
 */
export const ExperimentBudgetSchema = z.object({
  mentorUsd: z.number().nonnegative(),
  mentorInputTokens: z.number().int().nonnegative(),
  mentorOutputTokens: z.number().int().nonnegative(),
  /** Null when some student call's price isn't known. */
  studentUsd: z.number().nonnegative().nullable(),
  studentInputTokens: z.number().int().nonnegative(),
  studentOutputTokens: z.number().int().nonnegative(),
  computeUsd: z.number().nonnegative(),
  computeMinutes: z.number().nonnegative(),
  /**
   * False while the round's training job hadn't stopped when the round ended, as when a stop
   * came during training: compute is then the job's whole authorization, the most it can cost,
   * until the job ends and its own time replaces it (decision 045). Absent once settled.
   */
  computeSettled: z.literal(false).optional(),
  /** Training examples sent, and the tokens trained on, for an adapter round. */
  examples: z.number().int().nonnegative(),
  trainedTokens: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  /** Wall-clock minutes from the round's start to its decision. */
  minutes: z.number().nonnegative(),
});
export type ExperimentBudget = z.infer<typeof ExperimentBudgetSchema>;

/** The record every round that tries a change ends in, whatever happened to it. */
export const ExperimentSchema = z.object({
  id: z.string().regex(/^exp_[a-z0-9]+$/),
  runId: z.string().min(1),
  round: z.number().int().positive(),
  interventionId: z.string().nullable(),
  kind: ExperimentKindSchema,
  title: z.string(),
  inputs: z.object({
    baseVersion: z.number().int().nonnegative(),
    candidateVersion: z.number().int().nonnegative().nullable(),
    incumbentAdapter: TrainedAdapterSchema.nullable(),
    candidateAdapter: TrainedAdapterSchema.nullable(),
    lessonIds: z.array(z.string()),
    datasetSha256: sha256Hex.nullable(),
    trainingJobId: z.string().nullable(),
    trainingBackend: z.string().nullable(),
  }),
  recipe: z
    .object({ name: z.string(), version: z.number().int().positive(), sha256: sha256Hex })
    .nullable(),
  seeds: z.object({ dev: z.array(z.number().int()), train: z.number().int().nullable() }),
  decoding: DecodingSchema.nullable(),
  measurements: z.array(MeasurementSchema),
  devBefore: ScoreSchema.nullable(),
  devAfter: ScoreSchema.nullable(),
  perType: z.array(
    z.object({ type: z.string(), before: z.number().int(), after: z.number().int() }),
  ),
  /** Task types that lost dev passes, with how many. */
  regressions: z.array(
    z.object({ type: z.string(), before: z.number().int(), after: z.number().int() }),
  ),
  gates: z.array(GateResultSchema),
  budget: ExperimentBudgetSchema,
  disposition: ExperimentDispositionSchema,
  reason: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

/**
 * The mentor's model run as the agent, for comparison only (spec 17, comparison 6): it never
 * judges, never mentors, and nothing it does reaches a mentoring request. On dev its requests go
 * through the leak guard like every mentor call; on the locked test it runs only for a frozen
 * run whose mentor was released, the way a re-test does.
 */
export const ReferenceRecordSchema = z.object({
  runId: z.string().min(1),
  split: z.enum(['dev', 'test']),
  harnessVersion: z.number().int().nonnegative(),
  model: z.string().min(1),
  configKey: z.string().min(1),
  status: z.enum(['running', 'paused', 'finished']),
  /** The most it may spend, disclosed before it starts. */
  maxUsd: z.number().nonnegative(),
  spentUsd: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  seed: z.number().int(),
  score: ScoreSchema.nullable(),
  perType: z.array(TypeScoreSchema),
  latencyMs: z.object({ p50: z.number().nonnegative(), p95: z.number().nonnegative() }).nullable(),
  error: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type ReferenceRecord = z.infer<typeof ReferenceRecordSchema>;

/** A run's progress, computed from its stored experiments and lessons alone. */
export const MentoringProgressSchema = z.object({
  runId: z.string(),
  experiments: z.object({
    total: z.number().int().nonnegative(),
    kept: z.number().int().nonnegative(),
    reverted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    invalid: z.number().int().nonnegative(),
    stopped: z.number().int().nonnegative(),
  }),
  dev: z.object({
    baseline: ScoreSchema.nullable(),
    /** The last kept experiment's measured candidate, or the baseline before any. */
    current: ScoreSchema.nullable(),
  }),
  lessons: z.object({
    verified: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    byKind: z.record(z.string(), z.number().int().nonnegative()),
  }),
  clarifications: z.number().int().nonnegative(),
  spent: ExperimentBudgetSchema,
  /** The caps the run was held to, disclosed beside what it spent. */
  budget: z.object({
    maxRounds: z.number().int().positive(),
    maxMentorUsd: z.number().nonnegative(),
    maxComputeUsd: z.number().nonnegative(),
    maxWallMinutes: z.number().positive(),
  }),
});
export type MentoringProgress = z.infer<typeof MentoringProgressSchema>;

/** One task type's evidence, each kind kept apart: practice, check, final test, install check. */
export const CapabilitySchema = z.object({
  type: z.string(),
  label: z.string(),
  /** Train attempts in the latest round that attempted this type. Training evidence only. */
  practice: ScoreSchema.nullable(),
  /** Dev: the incumbent in the latest experiment that measured it. */
  check: ScoreSchema.nullable(),
  /** The locked test, once the graduate has taken it. */
  finalTest: ScoreSchema.nullable(),
  /** Installation checks belong to installations and are reported there. */
  installCheck: ScoreSchema.nullable(),
  categories: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      label: z.string(),
      verifiedLessons: z.number().int().nonnegative(),
      stopped: z.boolean(),
    }),
  ),
});
export type Capability = z.infer<typeof CapabilitySchema>;

export const CapabilityBreakdownSchema = z.object({
  runId: z.string(),
  capabilities: z.array(CapabilitySchema),
});
export type CapabilityBreakdown = z.infer<typeof CapabilityBreakdownSchema>;
