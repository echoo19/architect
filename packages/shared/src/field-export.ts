import { z } from 'zod';
import { CheckOutcomeSchema } from './checker';
import { JsonValueSchema } from './json';

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
