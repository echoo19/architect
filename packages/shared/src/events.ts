import { z } from 'zod';
import { UsageSchema } from './chat';
import { ScoreSchema } from './lineage';
import { TypeScoreSchema } from './mentor';
import { BudgetStateSchema, RoundSchema, RunSchema } from './run';
import { SplitNameSchema } from './task';
import { AttemptSchema } from './trace';

const base = { runId: z.string(), at: z.iso.datetime() };

/** Events the engine emits while a run progresses. The UI rebuilds its view from them. */
export const RunEventSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('run.updated'), run: RunSchema }),
  z.object({ ...base, type: z.literal('round.updated'), round: RoundSchema }),
  z.object({
    ...base,
    type: z.literal('attempt.started'),
    taskId: z.string(),
    split: SplitNameSchema,
    harnessVersion: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal('attempt.finished'),
    attempt: AttemptSchema,
    /** The request text, for train and dev attempts only. */
    prompt: z.string().optional(),
  }),
  z.object({ ...base, type: z.literal('mentor.started'), round: z.number().int().positive() }),
  z.object({
    ...base,
    type: z.literal('mentor.finished'),
    round: z.number().int().positive(),
    usage: UsageSchema,
    costUsd: z.number().nonnegative().nullable(),
  }),
  z.object({
    ...base,
    type: z.literal('eval.progress'),
    split: z.enum(['dev', 'test']),
    harnessVersion: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    pass: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal('eval.finished'),
    split: z.enum(['dev', 'test']),
    harnessVersion: z.number().int().nonnegative(),
    score: ScoreSchema,
    perType: z.array(TypeScoreSchema),
  }),
  z.object({ ...base, type: z.literal('budget'), state: BudgetStateSchema }),
  z.object({
    ...base,
    type: z.literal('log'),
    level: z.enum(['info', 'warn', 'error']),
    message: z.string(),
  }),
  z.object({ ...base, type: z.literal('graduate.ready'), graduateId: z.string() }),
  /** A lesson, intervention, experiment or reference was recorded or changed; read it back. */
  z.object({
    ...base,
    type: z.literal('mentoring.updated'),
    record: z.enum(['lesson', 'intervention', 'experiment', 'reference', 'counterexample']),
    id: z.string(),
    round: z.number().int().positive().nullable(),
  }),
]);
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventType = RunEvent['type'];
