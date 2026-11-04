import { z } from 'zod';
import { ReasoningEffortSchema } from './job';

/*
 * Architect WSP: weight-space programming experiments (decision 109). A mentor (GPT-6 Astra)
 * reads a base model's tensors through programs it writes, proposes a targeted edit, and the
 * runner measures each candidate the edit makes. It is its own adaptation method, beside the
 * LoRA adapters of the ordinary weights intervention: a candidate is a set of whole replacement
 * tensors over a pinned, read-only base checkpoint, never an adapter.
 */

export const WSP_EXPERIMENT_FORMAT = 'architect.wsp-experiment/1';
export const WSP_CANDIDATE_FORMAT = 'architect.wsp-candidate/1';

/** How a model is adapted: a LoRA trained on verified lessons, or a weight program. */
export const AdaptationMethodSchema = z.enum(['qlora', 'weight_program']);
export type AdaptationMethod = z.infer<typeof AdaptationMethodSchema>;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const gitCommit = z.string().regex(/^[0-9a-f]{40}$/);
export const WspExperimentIdSchema = z.string().regex(/^wsp-[0-9a-z]{6,40}$/);
/** `wspc-` and the first 20 hex digits of the candidate's digest. */
export const WspCandidateIdSchema = z.string().regex(/^wspc-[0-9a-f]{20}$/);

/* Base models */

/** One file of a base checkpoint, as hashed when the experiment starts. */
export const WspBaseFileSchema = z.strictObject({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  sha256: sha256Hex,
});
export type WspBaseFile = z.infer<typeof WspBaseFileSchema>;

/** Whether this method can work on a model, and why not. */
export const WspCompatibilitySchema = z.strictObject({
  supported: z.boolean(),
  /** Each reason it can't, in plain words; empty when it can. */
  reasons: z.array(z.string().min(1)),
});
export type WspCompatibility = z.infer<typeof WspCompatibilitySchema>;

/** A model found on this computer that an experiment could start from. */
export const WspModelSchema = z.strictObject({
  /** The repository it came from, when it is in the Hugging Face cache. */
  repo: z.string().min(1).optional(),
  /** The cache snapshot's commit, when it is in the Hugging Face cache. */
  revision: gitCommit.optional(),
  /** Its folder. Read only: nothing is ever written there. */
  path: z.string().min(1),
  name: z.string().min(1),
  architecture: z.string().min(1).nullable(),
  /** Counted from the checkpoint's tensor shapes, not from the config's claims. */
  parameters: z.number().int().nonnegative(),
  dtype: z.string().min(1).nullable(),
  layers: z.number().int().nonnegative().nullable(),
  bytes: z.number().int().nonnegative(),
  compatibility: WspCompatibilitySchema,
  /** Estimated peak memory on this computer, kernel and evaluator together, in GB. */
  memoryGb: z.number().nonnegative(),
});
export type WspModel = z.infer<typeof WspModelSchema>;

/** The base an experiment is pinned to: its folder and every file's hash, from the start. */
export const WspBaseSchema = z.strictObject({
  repo: z.string().min(1).optional(),
  revision: gitCommit.optional(),
  path: z.string().min(1),
  name: z.string().min(1),
  architecture: z.string().min(1).nullable(),
  parameters: z.number().int().nonnegative(),
  files: z.array(WspBaseFileSchema).min(1),
  /** SHA-256 over the sorted file names and hashes: the base's identity. */
  digest: sha256Hex,
});
export type WspBase = z.infer<typeof WspBaseSchema>;

/* The goal */

/** How the runner checks one output; deterministic, never a model's judgment. */
export const WspCheckSchema = z.strictObject({
  kind: z.enum(['contains', 'exact', 'regex', 'number']),
  value: z.string().min(1).max(2_000),
});
export type WspCheck = z.infer<typeof WspCheckSchema>;

/** A prompt, and how its output is checked. One with no check is measured on behavior only. */
export const WspExampleSchema = z.strictObject({
  prompt: z.string().min(1).max(8_000),
  check: WspCheckSchema.optional(),
});
export type WspExample = z.infer<typeof WspExampleSchema>;

export const WspGoalSchema = z.strictObject({
  /** The task or the behavior to reach, in the person's words. */
  task: z.string().trim().min(1).max(4_000),
  /** What must not change. */
  constraints: z.string().max(4_000).optional(),
  examples: z.array(WspExampleSchema).max(2_000),
});
export type WspGoal = z.infer<typeof WspGoalSchema>;

/** The fewest examples a run accepts: enough for practice, dev and a sealed qualification. */
export const WSP_MIN_EXAMPLES = 12;

/* Compute and limits */

export const WspComputeIdSchema = z.enum(['local-cpu', 'hf-jobs', 'slurm', 'kubernetes', 'skypilot']);
export type WspComputeId = z.infer<typeof WspComputeIdSchema>;

/**
 * Where an experiment can run. Only `local-cpu` runs today: the kernel and the evaluator answer
 * the runner turn by turn, which a batch job on a scheduler can't. The others say why.
 */
export const WspComputeTargetSchema = z.strictObject({
  id: WspComputeIdSchema,
  label: z.string().min(1),
  status: z.enum(['ready', 'needs-setup', 'unsupported']),
  /** Why it isn't ready, in plain words. */
  reason: z.string().min(1).optional(),
  /** CPU threads, for this computer. */
  threads: z.number().int().positive().optional(),
  memoryGb: z.number().positive().optional(),
});
export type WspComputeTarget = z.infer<typeof WspComputeTargetSchema>;

/** Decoding for the evaluator; the decoding control changes only these. */
export const WspDecodingSchema = z.strictObject({
  temperature: z.number().min(0).max(2),
  topP: z.number().gt(0).max(1),
  repetitionPenalty: z.number().min(1).max(2),
  maxNewTokens: z.number().int().min(8).max(4_096),
});
export type WspDecoding = z.infer<typeof WspDecodingSchema>;

export const WSP_DEFAULT_DECODING: WspDecoding = {
  temperature: 0,
  topP: 1,
  repetitionPenalty: 1,
  maxNewTokens: 192,
};

/** Hard caps. The runner stops at the first one reached and keeps what it measured. */
export const WspLimitsSchema = z.strictObject({
  /** Programs Astra may run against the weights. */
  programs: z.number().int().min(1).max(60),
  /** Evaluations of a candidate on practice and dev, and activation reads, together. */
  forwardPasses: z.number().int().min(2).max(400),
  wallMinutes: z.number().positive().max(24 * 60),
  mentorUsd: z.number().nonnegative().max(500),
  /** Compute dollars; zero on this computer. */
  computeUsd: z.number().nonnegative().max(500),
  /** Seconds one program may run. */
  programSeconds: z.number().int().min(5).max(3_600),
  /** The share of the model's weights a candidate may change, in all. */
  maxChangedFraction: z.number().gt(0).max(0.1),
  /** Memory a worker process may hold, in GB; it is stopped past it. */
  memoryGb: z.number().positive().max(512),
});
export type WspLimits = z.infer<typeof WspLimitsSchema>;

export const WSP_DEFAULT_LIMITS: WspLimits = {
  programs: 8,
  forwardPasses: 24,
  wallMinutes: 120,
  mentorUsd: 5,
  computeUsd: 0,
  programSeconds: 300,
  maxChangedFraction: 0.01,
  memoryGb: 12,
};

/* The brief */

/** What success means, decided before any edit: a metric, its direction and the least gain. */
export const WspTargetSchema = z.strictObject({
  metric: z.enum(['pass_rate', 'loop_rate']),
  /** Points on the dev split the candidate must gain (pass rate) or cut (loop rate). */
  minPoints: z.number().min(0).max(100),
});
export type WspTarget = z.infer<typeof WspTargetSchema>;

/** Astra's proposal, which the person edits and approves with Start experiment. */
export const WspBriefSchema = z.strictObject({
  objective: z.string().trim().min(1).max(1_200),
  baseline: z.string().trim().min(1).max(1_200),
  investigation: z.string().trim().min(1).max(2_400),
  successCriteria: z.array(z.string().trim().min(1).max(400)).min(1).max(8),
  regressionChecks: z.array(z.string().trim().min(1).max(400)).max(8),
  expectedOutput: z.string().trim().min(1).max(1_200),
  target: WspTargetSchema,
  /** The simpler interventions every candidate is compared with. */
  controls: z.strictObject({
    decoding: WspDecodingSchema,
    /** A system instruction: the simplest harness change. Null when none is tried. */
    instructions: z.string().trim().min(1).max(2_000).nullable(),
  }),
});
export type WspBrief = z.infer<typeof WspBriefSchema>;

/* Mentor */

export const WspMentorSchema = z.strictObject({
  label: z.string().min(1),
  provider: z.literal('openai'),
  model: z.string().min(1),
  /** Low, medium or high: what the mentor adapter sends as `reasoning_effort`. */
  reasoningEffort: ReasoningEffortSchema,
  /** A scripted mentor for tests and unbilled demonstrations; never reported as Astra's work. */
  standIn: z.boolean(),
});
export type WspMentor = z.infer<typeof WspMentorSchema>;

/** Whether the mentor can be reached, and what to do if not. */
export const WspMentorStatusSchema = z.strictObject({
  mentor: WspMentorSchema,
  status: z.enum(['ready', 'missing-key']),
  reason: z.string().min(1).optional(),
});
export type WspMentorStatus = z.infer<typeof WspMentorStatusSchema>;

/* Candidates */

/** One replaced tensor, checked by the runner, not taken from the program's word. */
export const WspTensorEditSchema = z.strictObject({
  tensor: z.string().min(1),
  shape: z.array(z.number().int().nonnegative()),
  dtype: z.string().min(1),
  /** SHA-256 of the new tensor's bytes. */
  sha256: sha256Hex,
  /** Elements that differ from the base. */
  changed: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  /** Frobenius norm of the change over the base tensor's. */
  relativeChange: z.number().nonnegative(),
});
export type WspTensorEdit = z.infer<typeof WspTensorEditSchema>;

/** A candidate: immutable, named by the hash of its manifest. */
export const WspCandidateSchema = z.strictObject({
  format: z.literal(WSP_CANDIDATE_FORMAT),
  id: WspCandidateIdSchema,
  digest: sha256Hex,
  method: z.literal('weight_program'),
  baseDigest: sha256Hex,
  /** The candidate it was made from; null for one made from the base. */
  parent: WspCandidateIdSchema.nullable(),
  /** The program that made it, by hash. */
  programSha256: sha256Hex,
  edits: z.array(WspTensorEditSchema).min(1),
  /** Elements changed over the base, in all. */
  changed: z.number().int().nonnegative(),
  /** SHA-256 of `tensors.safetensors`, which holds every edited tensor whole. */
  tensorsSha256: sha256Hex,
});
export type WspCandidate = z.infer<typeof WspCandidateSchema>;

/* Measurements */

export const WspArmSchema = z.enum(['base', 'decoding', 'instructions', 'candidate']);
export type WspArm = z.infer<typeof WspArmSchema>;
export const WspSplitSchema = z.enum(['practice', 'dev', 'qualification']);
export type WspSplit = z.infer<typeof WspSplitSchema>;

/** One evaluation of one arm on one split. */
export const WspMeasurementSchema = z.strictObject({
  arm: WspArmSchema,
  split: WspSplitSchema,
  /** The candidate measured, for the candidate arm. */
  candidateId: WspCandidateIdSchema.optional(),
  n: z.number().int().nonnegative(),
  /** Outputs the check passed; null when no example on this split has a check. */
  passed: z.number().int().nonnegative().nullable(),
  checked: z.number().int().nonnegative(),
  /** Outputs that repeat themselves. */
  looped: z.number().int().nonnegative(),
  /** Outputs cut off at the token limit. */
  cutOff: z.number().int().nonnegative(),
  meanTokens: z.number().nonnegative(),
  seconds: z.number().nonnegative(),
  /** Per example, in split order, for paired comparisons: passed, looped. */
  outcomes: z.array(z.strictObject({ passed: z.boolean().nullable(), looped: z.boolean() })),
});
export type WspMeasurement = z.infer<typeof WspMeasurementSchema>;

/* Iterations */

export const WspStageSchema = z.enum(['baseline', 'investigation', 'edit', 'evaluation', 'results']);
export type WspStage = z.infer<typeof WspStageSchema>;

/** One program Astra wrote, what it did, and what the runner made of it. */
export const WspIterationSchema = z.strictObject({
  n: z.number().int().positive(),
  hypothesis: z.string(),
  expected: z.string(),
  programSha256: sha256Hex,
  /** How the program ended. */
  outcome: z.enum(['edit', 'read', 'inspected', 'error', 'timeout', 'refused']),
  /** The end of what it printed, as Astra is shown it. */
  output: z.string(),
  /** Why its edit was refused, or how it failed. */
  reason: z.string().optional(),
  candidateId: WspCandidateIdSchema.optional(),
  /** Whether the candidate became the one later programs build on. */
  decision: z.enum(['kept', 'discarded']).optional(),
  dev: WspMeasurementSchema.optional(),
  mentorUsd: z.number().nonnegative(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type WspIteration = z.infer<typeof WspIterationSchema>;

/* Results */

/** A paired difference between the candidate and another arm, with its 95% interval. */
export const WspComparisonSchema = z.strictObject({
  against: WspArmSchema,
  metric: z.enum(['pass_rate', 'loop_rate']),
  split: WspSplitSchema,
  /** Candidate minus the other arm, in points. */
  points: z.number(),
  low: z.number(),
  high: z.number(),
  n: z.number().int().nonnegative(),
});
export type WspComparison = z.infer<typeof WspComparisonSchema>;

export const WspVerdictSchema = z.enum(['improved', 'not-established', 'regressed', 'no-candidate']);
export type WspVerdict = z.infer<typeof WspVerdictSchema>;

export const WspResultSchema = z.strictObject({
  verdict: WspVerdictSchema,
  /** One plain sentence on what the measurements show. */
  summary: z.string().min(1),
  candidateId: WspCandidateIdSchema.nullable(),
  comparisons: z.array(WspComparisonSchema),
  regressions: z.array(z.string()),
  /** What was not compared, and why. */
  notRun: z.array(z.strictObject({ arm: z.string().min(1), reason: z.string().min(1) })),
  /** A candidate measured on the evaluator is not a local graduate until its runtime is checked. */
  deployment: z.strictObject({
    status: z.enum(['not-verified', 'verified']),
    reason: z.string().min(1),
  }),
});
export type WspResult = z.infer<typeof WspResultSchema>;

/* The experiment */

export const WspStatusSchema = z.enum([
  /** Briefing: Astra is drafting the brief. */
  'briefing',
  /** The brief waits for the person. */
  'brief',
  'running',
  'cancelling',
  /** Stopped by the app closing or a worker ending; it resumes from its last finished program. */
  'interrupted',
  /** Dev evaluation done and the candidate frozen; the sealed qualification can run. */
  'evaluated',
  'qualifying',
  'qualified',
  'cancelled',
  'failed',
]);
export type WspStatus = z.infer<typeof WspStatusSchema>;

export const WspCostsSchema = z.strictObject({
  mentorUsd: z.number().nonnegative(),
  mentorCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  computeUsd: z.number().nonnegative(),
  /** Seconds the workers ran. */
  computeSeconds: z.number().nonnegative(),
  forwardPasses: z.number().int().nonnegative(),
  programs: z.number().int().nonnegative(),
  /** Seconds the experiment has run, across resumes. */
  wallSeconds: z.number().nonnegative(),
});
export type WspCosts = z.infer<typeof WspCostsSchema>;

export const WSP_ZERO_COSTS: WspCosts = {
  mentorUsd: 0,
  mentorCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  computeUsd: 0,
  computeSeconds: 0,
  forwardPasses: 0,
  programs: 0,
  wallSeconds: 0,
};

/** The pinned worker the experiment ran on. */
export const WspWorkerInfoSchema = z.strictObject({
  version: z.string().min(1),
  python: z.string().min(1),
  packages: z.array(z.string().min(1)),
  /** SHA-256 over the worker's source files. */
  sourceSha256: sha256Hex,
});
export type WspWorkerInfo = z.infer<typeof WspWorkerInfoSchema>;

export const WspExperimentSchema = z.strictObject({
  format: z.literal(WSP_EXPERIMENT_FORMAT),
  id: WspExperimentIdSchema,
  title: z.string().min(1).max(120),
  createdAt: z.iso.datetime(),
  status: WspStatusSchema,
  stage: WspStageSchema,
  /** What the run is doing now, in a few words. */
  activity: z.string(),
  base: WspBaseSchema,
  goal: WspGoalSchema,
  compute: WspComputeIdSchema,
  limits: WspLimitsSchema,
  mentor: WspMentorSchema,
  brief: WspBriefSchema.nullable(),
  /** Set by Start experiment: the brief's hash and when it was approved. */
  approval: z.strictObject({ briefSha256: sha256Hex, at: z.iso.datetime() }).nullable(),
  /** How the examples were split, by count; the sealed ones are only in the vault. */
  split: z.strictObject({
    seed: z.number().int(),
    practice: z.number().int().nonnegative(),
    dev: z.number().int().nonnegative(),
    qualification: z.number().int().nonnegative(),
  }),
  /** What Astra believes now, from its latest program. */
  hypothesis: z.string(),
  iterations: z.array(WspIterationSchema),
  measurements: z.array(WspMeasurementSchema),
  /** The candidate later programs build on; null while none was kept. */
  incumbent: WspCandidateIdSchema.nullable(),
  /** The candidate frozen for qualification, by digest, once dev evaluation ends. */
  frozen: z.strictObject({ candidateId: WspCandidateIdSchema, digest: sha256Hex, at: z.iso.datetime() }).nullable(),
  costs: WspCostsSchema,
  worker: WspWorkerInfoSchema.nullable(),
  result: WspResultSchema.nullable(),
  /** Why it failed or stopped, in plain words. */
  error: z.string().optional(),
  endedAt: z.iso.datetime().optional(),
});
export type WspExperiment = z.infer<typeof WspExperimentSchema>;

/** What the person fills in before Astra drafts a brief. */
export const WspDraftInputSchema = z.strictObject({
  modelPath: z.string().min(1),
  goal: WspGoalSchema,
  compute: WspComputeIdSchema,
  limits: WspLimitsSchema,
  reasoningEffort: WspMentorSchema.shape.reasoningEffort,
});
export type WspDraftInput = z.infer<typeof WspDraftInputSchema>;

export const WspEventSchema = z.strictObject({ experimentId: WspExperimentIdSchema });
export type WspEvent = z.infer<typeof WspEventSchema>;

/** What a candidate export wrote: the whole checkpoint, with the provenance beside it. */
export const WspExportSchema = z.strictObject({
  folder: z.string().min(1),
  files: z.array(WspBaseFileSchema),
});
export type WspExport = z.infer<typeof WspExportSchema>;

/** The worker's environment on this computer. */
export const WspWorkerStatusSchema = z.strictObject({
  status: z.enum(['ready', 'needs-setup', 'setting-up', 'unavailable']),
  reason: z.string().optional(),
  python: z.string().optional(),
});
export type WspWorkerStatus = z.infer<typeof WspWorkerStatusSchema>;
