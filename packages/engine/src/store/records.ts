import {
  AdapterRefSchema,
  AttemptSchema,
  DecodingSchema,
  GraduateManifestSchema,
  GraduateSettingsSchema,
  HypothesisSchema,
  JsonValueSchema,
  RoundSchema,
  RunSchema,
  StopReasonSchema,
  StudentTargetSchema,
  UsageSchema,
} from '@architect/shared';
import { z } from 'zod';

/** The independent sub-seeds a run's seed fans out into (decision 007). */
export const RunSeedsSchema = z.object({
  trainBatch: z.number().int().nonnegative(),
  trainStudent: z.number().int().nonnegative(),
  devPanel: z.number().int().nonnegative(),
  test: z.number().int().nonnegative(),
  /** Best effort: model mentors may ignore it; the student author in self-reflection uses it. */
  mentor: z.number().int().nonnegative(),
});
export type RunSeeds = z.infer<typeof RunSeedsSchema>;

export const StudentPinSchema = z.object({
  model: z.string(),
  quantization: z.string().optional(),
  digest: z.string().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  contextLength: z.number().int().positive().optional(),
});
export type StudentPin = z.infer<typeof StudentPinSchema>;

/**
 * How the frozen graduate runs, beside its harness: the backend that serves the student, its
 * adapter with the GGUF's hash and the scale, and the decoding. The locked test runs exactly this.
 */
export const FrozenConfigurationSchema = z.object({
  /** `ollama` or `openai_compatible` for the job's student, `llama.cpp` with an adapter. */
  backend: z.string().min(1),
  adapter: AdapterRefSchema.extend({ scale: z.number() }).nullable(),
  decoding: DecodingSchema,
});
export type FrozenConfiguration = z.infer<typeof FrozenConfigurationSchema>;

/** The graduate as frozen before its locked test. Nothing after this changes what ships. */
export const GraduateFreezeSchema = z.object({
  graduateId: z.string(),
  harnessVersion: z.number().int().nonnegative(),
  harnessHash: z.string(),
  student: StudentPinSchema,
  frozenAt: z.iso.datetime(),
  /** Absent for graduates frozen before it was recorded: the student with no adapter. */
  configuration: FrozenConfigurationSchema.optional(),
  /**
   * The locked test's decoding seeds, fixed at freezing. Absent for graduates frozen before:
   * one repeat, under the run's test seed.
   */
  testSeeds: z.array(z.number().int().nonnegative()).min(1).optional(),
});
export type GraduateFreeze = z.infer<typeof GraduateFreezeSchema>;

export const StoredRunSchema = z.object({
  run: RunSchema,
  seeds: RunSeedsSchema,
  /** The date the job's tasks are evaluated against, fixed for the whole run. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lockedTestOn: StudentTargetSchema,
  stopRequested: z.boolean(),
  freeze: GraduateFreezeSchema.nullable(),
  /** Someone can answer a clarifying question; runs from scripts can't. Absent: no one. */
  interactive: z.boolean().optional(),
});
export type StoredRun = z.infer<typeof StoredRunSchema>;

/**
 * A finished run's locked test taken again on its other student endpoint. `testing` until its
 * card is filed, resumed after a restart; `paused` by an error until it is asked for again.
 */
export const StoredRetestSchema = z.object({
  runId: z.string(),
  target: StudentTargetSchema,
  status: z.enum(['testing', 'paused', 'finished']),
  /** Why it paused. */
  error: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type StoredRetest = z.infer<typeof StoredRetestSchema>;
export type RetestStatus = StoredRetest['status'];

/** The author's raw reply, saved before it is parsed so a restart never pays for it twice. */
export const AuthorReplySchema = z.object({
  text: z.string(),
  json: JsonValueSchema.optional(),
  usage: UsageSchema,
  /** What the call was charged against the budget. */
  costUsd: z.number().nonnegative(),
  model: z.string(),
  latencyMs: z.number().nonnegative(),
  /** 0 for the author's answer, 1 for its fix after the runner couldn't use that answer. */
  fix: z.number().int().nonnegative().default(0),
});
export type AuthorReply = z.infer<typeof AuthorReplySchema>;

export const StoredRoundSchema = z.object({
  round: RoundSchema,
  /** The incumbent the round's train attempts used and its candidate derives from. */
  baseVersion: z.number().int().nonnegative(),
  reply: AuthorReplySchema.nullable(),
  hypothesis: HypothesisSchema.nullable(),
  /**
   * The runner rejected the author's reply or change set, so the round ended before dev saw
   * it. The round's error says why; the author is shown that reason next round.
   */
  rejected: z.boolean(),
});
export type StoredRound = z.infer<typeof StoredRoundSchema>;

export const StoredAttemptSchema = AttemptSchema.extend({
  target: StudentTargetSchema,
  /**
   * Who attempted and how, beside the harness version: absent or `student` for the job's student
   * with no adapter, else a key from `configurationKey`. Attempts under different keys are never
   * reused for each other.
   */
  config: z.string().min(1).optional(),
  /** The evaluation seed handed to the runtime. */
  seed: z.number().int(),
  stopReason: StopReasonSchema,
  /** Relative to the data folder. Null for locked-test attempts, whose traces aren't kept. */
  tracePath: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type StoredAttempt = z.infer<typeof StoredAttemptSchema>;

export const JobRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string().optional(),
  /** The job folder, relative to the data folder. */
  path: z.string(),
  taskCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type JobRecord = z.infer<typeof JobRecordSchema>;

/** An index row for one lineage entry; the run's `lineage.jsonl` holds the full record. */
export const LineageIndexSchema = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number().int().positive(),
  title: z.string(),
  decision: z.enum(['kept', 'reverted']),
  delta: z.number().int(),
  versionFrom: z.number().int().nonnegative(),
  versionTo: z.number().int().nonnegative(),
  at: z.iso.datetime(),
});
export type LineageIndex = z.infer<typeof LineageIndexSchema>;

/** One mentor or student call, or a call of Spark run as a reference. */
export const CostEntrySchema = z.object({
  runId: z.string().nullable(),
  role: z.enum(['mentor', 'student', 'reference']),
  model: z.string(),
  round: z.number().int().nonnegative().nullable(),
  attemptId: z.string().nullable(),
  usage: UsageSchema,
  /** Null when the endpoint's price isn't known. */
  usd: z.number().nonnegative().nullable(),
  at: z.iso.datetime(),
});
export type CostEntry = z.infer<typeof CostEntrySchema>;

export const GraduateRecordSchema = z.object({
  id: z.string(),
  /** Null for graduates imported from another installation. */
  runId: z.string().nullable(),
  name: z.string(),
  /** The graduate folder, relative to the data folder. */
  path: z.string(),
  manifest: GraduateManifestSchema,
  /** The user's choices for this graduate; null until they change one. */
  settings: GraduateSettingsSchema.nullable(),
  createdAt: z.iso.datetime(),
});
export type GraduateRecord = z.infer<typeof GraduateRecordSchema>;
