import { z } from 'zod';
import { CheckOutcomeSchema } from './checker';
import { JsonValueSchema } from './json';
import { ScoreSchema } from './lineage';

/** The format of a field export's `MANIFEST.json` (docs/SCALE.md, the contract). */
export const FIELD_EXPORT_FORMAT = 'architect.field-export/1';
/** The format of a field export's `eval/manifest.json`. */
export const SEALED_EVAL_FORMAT = 'architect.sealed-eval/1';

const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What the sealed part of a job is, by hash only: the locked test file and each organization the
 * job never trains on, hashed over its files' names and hashes. Nothing names them.
 */
export const SealedHashesSchema = z.object({
  lockedTest: z.object({ sha256, tasks: z.number().int().nonnegative() }),
  organizations: z.array(z.object({ sha256, files: z.number().int().nonnegative() })),
});
export type SealedHashes = z.infer<typeof SealedHashesSchema>;

export const FieldExportManifestSchema = z.object({
  format: z.literal(FIELD_EXPORT_FORMAT),
  created_at: z.string(),
  job: z.object({
    id: z.string(),
    name: z.string(),
    format: z.number().int(),
    created_at: z.string(),
    /** sha256 of `env/job.json`, the job as the export carries it. */
    sha256,
  }),
  counts: z.object({
    demonstrations: z.number().int().nonnegative(),
    trained_turns: z.number().int().nonnegative(),
    train_tasks: z.number().int().nonnegative(),
    train_organizations: z.number().int().nonnegative(),
    sealed_organizations: z.number().int().nonnegative(),
    locked_test_tasks: z.number().int().nonnegative(),
  }),
  /** Every file in the export but this one, by its path, with its sha256. */
  files: z.record(z.string(), sha256),
  permitted_uses: z.object({
    sft: z.array(z.string()),
    env: z.array(z.string()),
    eval: z.array(z.string()),
  }),
  left_out: z.array(z.object({ what: z.string(), why: z.string() })),
});
export type FieldExportManifest = z.infer<typeof FieldExportManifestSchema>;

/**
 * One request to the outcome scorer (`architect reward score`): an attempt at a train task as an
 * outside rollout system ran it. `changes` hold each changed file's whole new text by its path in
 * the agent's folder (`data/assignments.csv`, `output/report.md`), applied in order.
 */
export const RewardRequestSchema = z.object({
  /** Echoed in the score, so a caller can match them up. */
  id: z.union([z.string(), z.number()]).optional(),
  task_id: z.string().min(1),
  final_text: z.string(),
  changes: z.array(z.object({ path: z.string().min(1), text: z.string() })).default([]),
  tool_calls: z
    .array(z.object({ name: z.string(), arguments: z.record(z.string(), JsonValueSchema) }))
    .default([]),
  stop_reason: CheckOutcomeSchema.shape.stopReason.default('answer'),
});
export type RewardRequest = z.infer<typeof RewardRequestSchema>;

/**
 * One score. A line with `error` is not a judgment of the attempt: the request couldn't be read
 * or the scorer itself failed, and the caller should leave the sample out rather than count it.
 */
export const RewardScoreSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  reward: z.union([z.literal(0), z.literal(1)]),
  reason: z.string(),
  error: z
    .object({
      code: z.enum(['bad_request', 'unknown_task', 'checker', 'internal']),
      message: z.string(),
    })
    .optional(),
});
export type RewardScore = z.infer<typeof RewardScoreSchema>;

/**
 * One file of an organization the job trains on, as the field's page lists it: its name, its
 * size, and for a table the rows under its header. Null rows: not a table.
 */
export const FieldFileSchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  rows: z.number().int().nonnegative().nullable(),
});
export type FieldFile = z.infer<typeof FieldFileSchema>;

/**
 * A frozen version's locked test on an organization sealed after its job was made (decision
 * 085): queued or running, paused with the reason, or finished with its score there.
 */
export const AddedQualificationSchema = z.object({
  runId: z.string(),
  /** The organization, by the name the person gave it. */
  org: z.string(),
  status: z.enum(['testing', 'paused', 'finished']),
  error: z.string().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** Every task there, all skills together, once finished. */
  score: ScoreSchema.optional(),
});
export type AddedQualification = z.infer<typeof AddedQualificationSchema>;

/**
 * What a field is made of, for the person's own page (the app, never a mentor): the
 * organizations it trains on with their files, and the sealed ones by name and kind with how
 * many files each holds, never which. A job without organizations has one entry, its `data/`,
 * with a null id and name.
 */
export const FieldViewSchema = z.object({
  jobId: z.string(),
  organizations: z.array(
    z.object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      /** Generated from seeds or real; null where the job doesn't say. */
      synthetic: z.boolean().nullable(),
      files: z.array(FieldFileSchema),
    }),
  ),
  sealed: z.array(
    z.object({
      name: z.string(),
      synthetic: z.boolean(),
      files: z.number().int().nonnegative(),
      /** Sealed after the job was made, beside its seal (decision 085). */
      addedLater: z.literal(true).optional(),
      /**
       * Taught on since in a later version of the job (decision 089). It stays sealed here, so
       * what this version measured on it stays as it was.
       */
      taughtIn: z.object({ jobId: z.string(), name: z.string() }).optional(),
      /** A fresh cohort of the taught organization of this name, not one of its own (089). */
      cohortOf: z.string().optional(),
    }),
  ),
  /**
   * Set on a later version of a field, made by teaching on one of its never-seen organizations
   * (decision 089): the field it came from, this one's version number and the organization moved.
   */
  versionOf: z
    .object({
      jobId: z.string(),
      name: z.string(),
      version: z.number().int().min(2),
      org: z.string(),
    })
    .optional(),
  /** Tasks in the locked test; null before the job's test split is sealed. */
  lockedTestTasks: z.number().int().nonnegative().nullable(),
  /** Each frozen version's test on an organization added later, by run and organization name. */
  qualifications: z.array(AddedQualificationSchema).optional(),
});
export type FieldView = z.infer<typeof FieldViewSchema>;

/**
 * A never-seen organization added to a field after it was made (decision 085): the folder that
 * holds its records (and its tasks, as `tasks.jsonl`, unless the job was drafted), its name, and
 * whether its records were generated.
 */
export const AddOrganizationRequestSchema = z
  .object({
    folder: z.string().min(1),
    name: z.string().trim().min(1).max(60),
    synthetic: z.boolean(),
    /** A fresh cohort: new work of the taught organization of this name (decision 089). */
    cohortOf: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export type AddOrganizationRequest = z.infer<typeof AddOrganizationRequestSchema>;
