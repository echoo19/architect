import { z } from 'zod';

export const ScoreSchema = z.object({
  pass: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
export type Score = z.infer<typeof ScoreSchema>;

/** One line of lineage.jsonl: a hypothesis, what it changed, and what it did to dev. */
export const LineageEntrySchema = z.object({
  id: z.string(),
  runId: z.string(),
  round: z.number().int().positive(),
  title: z.string(),
  diagnosis: z.string(),
  files: z.array(z.string()),
  causeTaskIds: z.array(z.string()),
  predicted: z.object({
    devDeltaMin: z.number().int(),
    devDeltaMax: z.number().int(),
    rationale: z.string(),
  }),
  /** Over every dev run the decision used; `delta` and `perType` count passes the same way. */
  measured: z.object({
    devBefore: ScoreSchema,
    devAfter: ScoreSchema,
    delta: z.number().int(),
    perType: z.array(
      z.object({ type: z.string(), before: z.number().int(), after: z.number().int() }),
    ),
    /**
     * The first measurement alone, present when it cleared the keep limits and both versions
     * were measured again under new seeds; the scores above then add up both measurements.
     */
    firstMeasurement: z.object({ devBefore: ScoreSchema, devAfter: ScoreSchema }).optional(),
  }),
  decision: z.enum(['kept', 'reverted']),
  decisionReason: z.string(),
  versionFrom: z.number().int().nonnegative(),
  versionTo: z.number().int().nonnegative(),
  mentor: z.object({
    model: z.string(),
    costUsd: z.number().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
  }),
  at: z.iso.datetime(),
});
export type LineageEntry = z.infer<typeof LineageEntrySchema>;
