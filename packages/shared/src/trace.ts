import { z } from 'zod';
import { ChatMessageSchema, ToolCallSchema, UsageSchema } from './chat';
import { CheckResultSchema } from './checker';
import { JsonValueSchema } from './json';
import { SplitNameSchema } from './task';

export const StopReasonSchema = z.enum(['answer', 'max_steps', 'refused', 'error', 'aborted']);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const TraceStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    slug: z.string(),
    via: z.enum(['rule', 'tool']),
  }),
  z.object({
    kind: z.literal('model'),
    text: z.string(),
    toolCalls: z.array(ToolCallSchema),
    usage: UsageSchema,
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('tool'),
    callId: z.string(),
    name: z.string(),
    arguments: z.record(z.string(), JsonValueSchema),
    result: JsonValueSchema.nullable(),
    error: z.string().optional(),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('refusal'),
    taskType: z.string(),
    reason: z.string(),
  }),
]);
export type TraceStep = z.infer<typeof TraceStepSchema>;

export const TraceSchema = z.object({
  taskId: z.string().optional(),
  harnessVersion: z.number().int().nonnegative(),
  studentModel: z.string(),
  messages: z.array(ChatMessageSchema),
  steps: z.array(TraceStepSchema),
  finalText: z.string(),
  stopReason: StopReasonSchema,
  error: z.string().optional(),
  usage: UsageSchema,
  latencyMs: z.number().int().nonnegative(),
});
export type Trace = z.infer<typeof TraceSchema>;

export const AttemptSchema = z.object({
  id: z.string(),
  runId: z.string(),
  /** Null for evaluations outside a round (baseline dev score, locked test). */
  round: z.number().int().nonnegative().nullable(),
  taskId: z.string(),
  taskType: z.string(),
  split: SplitNameSchema,
  harnessVersion: z.number().int().nonnegative(),
  check: CheckResultSchema,
  latencyMs: z.number().int().nonnegative(),
  usage: UsageSchema,
  /** Short form of the agent's answer for tables, e.g. `$1,284.50`. */
  answerSummary: z.string().optional(),
  /** Short form of the expected result, shown next to a wrong answer. */
  expectedSummary: z.string().optional(),
});
export type Attempt = z.infer<typeof AttemptSchema>;
