import { z } from 'zod';
import { ScoreSchema } from './lineage';
import { PredictionSchema } from './mentor';
import { TrainedAdapterSchema } from './mentoring';

export const MethodSchema = z.enum(['architect', 'bare', 'one_shot', 'self_reflection']);
export type Method = z.infer<typeof MethodSchema>;

export const METHOD_LABELS: Record<Method, string> = {
  architect: 'Architect',
  bare: 'Bare student',
  one_shot: 'One-shot guide',
  self_reflection: 'Self-reflection',
};

/**
 * Whether a run is one of the simpler versions a comparison trains beside the agent, to be
 * compared with it. The agent's own runs, and the improvements of it, are not.
 */
export function isBaselineMethod(method: Method): boolean {
  return method !== 'architect';
}

export const RunStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'stopping',
  'stopped',
  'testing',
  'finished',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/** What the run is doing right now, for the training view. */
export const RunPhaseSchema = z.enum([
  'preparing',
  'baseline',
  'attempting',
  'diagnosing',
  /** The mentor works through verified corrections of this round's failures. */
  'teaching',
  /** An adapter is training on the round's lessons. */
  'training',
  /** The run waits for the person's answer to one question. */
  'clarifying',
  'evaluating',
  'testing',
  'done',
]);
export type RunPhase = z.infer<typeof RunPhaseSchema>;

export const StopReasonRunSchema = z.enum([
  'target_met',
  'rounds',
  'usd',
  'wall_clock',
  'patience',
  /** Rounds in a row ended with a reply or change set the runner couldn't use. */
  'rejected',
  /** The leak check refused a mentor payload; the next round would send the same data. */
  'leak',
  'user',
  'error',
  /** An answer changed what counts as success, which needs a new job contract and a new run. */
  'contract',
]);
export type RunStopReason = z.infer<typeof StopReasonRunSchema>;

export const RunTotalsSchema = z.object({
  mentorUsd: z.number().nonnegative(),
  mentorInputTokens: z.number().int().nonnegative(),
  mentorOutputTokens: z.number().int().nonnegative(),
  studentInputTokens: z.number().int().nonnegative(),
  studentOutputTokens: z.number().int().nonnegative(),
  rounds: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  wallMs: z.number().int().nonnegative(),
});
export type RunTotals = z.infer<typeof RunTotalsSchema>;

export const emptyTotals = (): RunTotals => ({
  mentorUsd: 0,
  mentorInputTokens: 0,
  mentorOutputTokens: 0,
  studentInputTokens: 0,
  studentOutputTokens: 0,
  rounds: 0,
  attempts: 0,
  wallMs: 0,
});

export const RunSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  method: MethodSchema,
  seed: z.number().int(),
  status: RunStatusSchema,
  phase: RunPhaseSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  /** Harness version the run currently builds on (the last kept one). */
  currentVersion: z.number().int().nonnegative(),
  devBaseline: ScoreSchema.nullable(),
  devCurrent: ScoreSchema.nullable(),
  totals: RunTotalsSchema,
  stopReason: StopReasonRunSchema.optional(),
  error: z.string().optional(),
  graduateId: z.string().optional(),
  /** The adapter the run kept, served with the current harness version; none until one is kept. */
  currentAdapter: TrainedAdapterSchema.optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const RoundSchema = z.object({
  runId: z.string(),
  index: z.number().int().positive(),
  /**
   * The author wrote a whole harness this round instead of one change: the first round of a
   * blank start, or one-shot's only round. It makes no train attempts and is always kept.
   */
  draft: z.literal(true).optional(),
  status: z.enum([
    'attempting',
    'diagnosing',
    'teaching',
    'training',
    'clarifying',
    'evaluating',
    'decided',
    'failed',
  ]),
  train: ScoreSchema,
  title: z.string().optional(),
  diagnosis: z.string().optional(),
  predicted: PredictionSchema.optional(),
  files: z.array(z.string()).default([]),
  candidateVersion: z.number().int().nonnegative().optional(),
  /** The adapter a weights round trained, served with the incumbent harness. */
  candidateAdapter: TrainedAdapterSchema.optional(),
  devBefore: ScoreSchema.optional(),
  devAfter: ScoreSchema.optional(),
  /** When the change cleared the keep limits once and was measured again: that first measurement. */
  firstMeasurement: z.object({ devBefore: ScoreSchema, devAfter: ScoreSchema }).optional(),
  decision: z.enum(['kept', 'reverted']).optional(),
  decisionReason: z.string().optional(),
  costUsd: z.number().nonnegative(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  error: z.string().optional(),
});
export type Round = z.infer<typeof RoundSchema>;

export const BudgetStateSchema = z.object({
  rounds: z.object({ used: z.number().int().nonnegative(), max: z.number().int().positive() }),
  usd: z.object({ used: z.number().nonnegative(), max: z.number().nonnegative() }),
  minutes: z.object({ used: z.number().nonnegative(), max: z.number().positive() }),
});
export type BudgetState = z.infer<typeof BudgetStateSchema>;
