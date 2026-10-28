import {
  TrainedAdapterSchema,
  AttemptSchema,
  DecodingSchema,
  EvaluationStatusSchema,
  GrantsSchema,
  GraduateManifestSchema,
  GraduateSettingsSchema,
  HypothesisSchema,
  InstallCheckSchema,
  InterventionTypeSchema,
  InstallStatusSchema,
  JobContractSchema,
  JsonValueSchema,
  MachineSchema,
  ModelBindingSchema,
  PackageManifestSchema,
  PublicationSchema,
  RoundSchema,
  RunImprovementSchema,
  RunSchema,
  StopReasonSchema,
  StudentTargetSchema,
  UsageSchema,
  VersionEventSchema,
  VersionRefSchema,
  VersionSourceSchema,
  VersionStateSchema,
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
  adapter: TrainedAdapterSchema.extend({
    scale: z.number(),
    /** The base's GGUF digest as the runtime serving the adapter reported it at freezing. */
    baseDigest: z.string().optional(),
  }).nullable(),
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

/**
 * What a comparison holds a run to beyond its job (decision 045). Absent for runs started from
 * the app, which keep every default.
 */
export const RunProtocolSchema = z.object({
  /** The comparison arm the run measures, by its id in the plan; the runner finds it again by it. */
  arm: z.string().min(1).optional(),
  /**
   * Once frozen, the run parks until it is released, so every arm of a comparison is frozen
   * before any arm's locked result exists to be read.
   */
  holdTest: z.literal(true).optional(),
  /** The hold was lifted: the locked test may run. */
  released: z.literal(true).optional(),
  /**
   * Every locked-test evaluation runs only the first declared seed; the others run when a repeat
   * is asked for, so a repeat can be dropped when money runs short. They are declared at freezing
   * all the same, so no result chooses them.
   */
  deferRepeats: z.literal(true).optional(),
  /** The intervention types the mentor may choose from; the whole menu when absent. */
  interventions: z.array(InterventionTypeSchema).min(1).optional(),
  /**
   * A harness folder, relative to the data folder (another run's frozen version, say), that the
   * run's first round adopts as its kept draft, so later rounds measure their adapters on both
   * the run's starting harness (H0) and this one (H1).
   */
  adopt: z.string().min(1).optional(),
  /**
   * One adapter trained once on verified demonstrations of this many train tasks of each type,
   * chosen by seed and never from the student's failures, and kept as measured unless a hard
   * gate fails: decision 037's one-shot verified-data adapter.
   */
  oneShotAdapter: z.object({ perType: z.number().int().min(1).max(20) }).optional(),
  /** The longest one training job may run; the compute cap alone limits it when absent. */
  maxJobMinutes: z.number().int().min(35).max(600).optional(),
});
export type RunProtocol = z.infer<typeof RunProtocolSchema>;

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
  /**
   * The agent this run improves from its queued lessons (decision 042): it starts from that
   * version and ends in a candidate version of the same agent, never in a new one.
   */
  improves: RunImprovementSchema.optional(),
  protocol: RunProtocolSchema.optional(),
});
export type StoredRun = z.infer<typeof StoredRunSchema>;

/**
 * A frozen graduate's locked test taken again under the declared seeds it hasn't run yet, on a
 * target that already has its first seed (a protocol with `deferRepeats`). One per run and
 * target; `testing` until done, resumed after a restart; `paused` by an error until asked again.
 */
export const StoredRepeatSchema = z.object({
  runId: z.string(),
  target: StudentTargetSchema,
  status: z.enum(['testing', 'paused', 'finished']),
  error: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
});
export type StoredRepeat = z.infer<typeof StoredRepeatSchema>;

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

/** An agent: the graduate whose versions live under `path`. */
export const GraduateRecordSchema = z.object({
  id: z.string(),
  /** The run that made its first version; null for graduates imported from elsewhere. */
  runId: z.string().nullable(),
  name: z.string(),
  /** The agent's folder, relative to the data folder; its versions are under `versions/`. */
  path: z.string(),
  /**
   * The format 1 `graduate.yaml` of a graduate made before versions, kept until its folder is
   * converted and as a record of it after; null for agents made since.
   */
  manifest: GraduateManifestSchema.nullable(),
  /** A format 1 graduate's write mode, before installations held it. */
  settings: GraduateSettingsSchema.nullable(),
  /** The version chats run on, or null while it has none that can. */
  activeVersion: z.number().int().positive().nullable(),
  createdAt: z.iso.datetime(),
});
export type GraduateRecord = z.infer<typeof GraduateRecordSchema>;

/** One immutable version of an agent, as the database indexes its package folder. */
export const StoredVersionSchema = z.object({
  graduateId: z.string(),
  version: z.number().int().positive(),
  parent: z.number().int().positive().optional(),
  origin: VersionRefSchema.optional(),
  /** The package folder, relative to the data folder. */
  path: z.string(),
  manifest: PackageManifestSchema,
  /** sha256 of `graduate.json` when the version was recorded; opening checks it again. */
  digest: z.string(),
  contractVersion: z.number().int().positive(),
  state: VersionStateSchema,
  evaluation: EvaluationStatusSchema,
  runId: z.string().optional(),
  /** The hub repository and commit it was installed from, when it came from one. */
  source: VersionSourceSchema.optional(),
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().optional(),
});
export type StoredVersion = z.infer<typeof StoredVersionSchema>;

export const StoredVersionEventSchema = VersionEventSchema;
export type StoredVersionEvent = z.infer<typeof StoredVersionEventSchema>;

/**
 * A graduate on this computer. Bindings inside the data folder are stored relative to it, so
 * the folder can move, and anything the user chose elsewhere is stored as an absolute path.
 */
export const StoredInstallationSchema = z.object({
  graduateId: z.string(),
  model: ModelBindingSchema,
  bindings: z.record(z.string(), z.string()),
  grants: GrantsSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type StoredInstallation = z.infer<typeof StoredInstallationSchema>;

/** The last installation checks of one version on this computer. */
export const StoredChecksSchema = z.object({
  graduateId: z.string(),
  version: z.number().int().positive(),
  status: InstallStatusSchema,
  reasons: z.array(z.string()),
  checks: z.array(InstallCheckSchema),
  machine: MachineSchema.optional(),
  measurements: z.object({ firstReplyMs: z.number().int().nonnegative().optional() }),
  checkedAt: z.iso.datetime(),
});
export type StoredChecks = z.infer<typeof StoredChecksSchema>;

export const StoredPublicationSchema = PublicationSchema;
export type StoredPublication = z.infer<typeof StoredPublicationSchema>;

/** One version of a job's contract. */
export const StoredContractSchema = z.object({
  jobId: z.string(),
  version: z.number().int().positive(),
  contract: JobContractSchema,
  createdAt: z.iso.datetime(),
});
export type StoredContract = z.infer<typeof StoredContractSchema>;
