import { z } from 'zod';
import { JsonValueSchema } from './json';
import { RequirementsSchema, TaskTypeInfoSchema } from './job';

export const FileEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('write'), path: z.string().min(1), content: z.string() }),
  z.object({ op: z.literal('delete'), path: z.string().min(1) }),
]);
export type FileEdit = z.infer<typeof FileEditSchema>;

export const PredictionSchema = z.object({
  /** Expected change in dev passes (net tasks), as a range. */
  devDeltaMin: z.number().int(),
  devDeltaMax: z.number().int(),
  rationale: z.string().min(1),
});
export type Prediction = z.infer<typeof PredictionSchema>;

/** One round's proposal: a single diagnosis and the change set that tests it. */
export const HypothesisSchema = z.object({
  title: z.string().min(1).max(80),
  diagnosis: z.string().min(1),
  edits: z.array(FileEditSchema).min(1).max(16),
  /** Train task ids whose failures this addresses. */
  causeTaskIds: z.array(z.string()).default([]),
  predicted: PredictionSchema,
  /** The mentor's own claim that the student is ready. Logged to measure overclaiming. */
  readyClaim: z.boolean().default(false),
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

export const TypeScoreSchema = z.object({
  type: z.string(),
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type TypeScore = z.infer<typeof TypeScoreSchema>;

/** What the mentor learns about earlier hypotheses: the decision and the overall dev change. */
export const MentorLineageItemSchema = z.object({
  round: z.number().int().positive(),
  title: z.string(),
  diagnosis: z.string(),
  files: z.array(z.string()),
  decision: z.enum(['kept', 'reverted']),
  devDelta: z.number().int(),
});
export type MentorLineageItem = z.infer<typeof MentorLineageItemSchema>;

/**
 * Everything the mentor is allowed to see in a round. The runner builds it from an allowlist;
 * nothing from the test split, and no dev task content, ever appears here.
 */
export const MentorViewSchema = z.object({
  job: z.object({
    name: z.string(),
    description: z.string(),
    taskTypes: z.array(TaskTypeInfoSchema),
    requirements: RequirementsSchema,
    dataFiles: z.array(
      z.object({
        name: z.string(),
        kind: z.enum(['table', 'text']),
        access: z.enum(['read', 'write']),
        columns: z.array(z.string()).optional(),
        rowCount: z.number().int().optional(),
        sampleRows: z.array(z.record(z.string(), JsonValueSchema)).optional(),
        text: z.string().optional(),
      }),
    ),
  }),
  harnessFiles: z.record(z.string(), z.string()),
  round: z.number().int().positive(),
  budgetLeft: z.object({
    rounds: z.number().int().nonnegative(),
    usd: z.number().nonnegative(),
    minutes: z.number().nonnegative(),
  }),
  train: z.object({
    results: z.array(
      z.object({
        taskId: z.string(),
        taskType: z.string(),
        prompt: z.string(),
        expected: JsonValueSchema,
        pass: z.boolean(),
        reason: z.string(),
        /** Compact text rendering of the attempt: model turns, tool calls, truncated results. */
        trace: z.string(),
      }),
    ),
    perType: z.array(TypeScoreSchema),
  }),
  /** Overall dev score only: per-type dev counts would be an extra channel for tuning to dev. */
  dev: z.object({
    pass: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  lineage: z.array(MentorLineageItemSchema),
});
export type MentorView = z.infer<typeof MentorViewSchema>;
