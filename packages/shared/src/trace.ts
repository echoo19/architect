import { z } from 'zod';
import { ChatMessageSchema, ToolCallSchema, UsageSchema } from './chat';
import { CheckResultSchema } from './checker';
import { DecodingSchema } from './harness';
import { JsonValueSchema } from './json';
import { SplitNameSchema } from './task';
import { RowDiffSchema, TableViewSchema } from './workspace';

export const StopReasonSchema = z.enum(['answer', 'max_steps', 'refused', 'error', 'aborted']);
export type StopReason = z.infer<typeof StopReasonSchema>;

/** A change to one file in the agent's folder, as a unified diff of its text. */
export const FileChangeSchema = z.object({
  /** The file's path in the agent's folder, e.g. `data/returns.csv`. */
  path: z.string(),
  patch: z.string(),
  /** For a table, the rows the change added, removed and changed. */
  rows: RowDiffSchema.optional(),
});
export type FileChange = z.infer<typeof FileChangeSchema>;

/** What one `write`, `edit` or `append` call changed, or would have. */
export const WriteRecordSchema = FileChangeSchema.extend({
  op: z.enum(['write', 'edit', 'append']),
  /** False when the user declined the change, so the file stayed as it was. */
  applied: z.boolean(),
});
export type WriteRecord = z.infer<typeof WriteRecordSchema>;

export const TraceStepSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill'),
    /** The skill's name: its folder under `skills/`. */
    slug: z.string(),
    /** `rule` when a retrieval rule put it in the system prompt, `tool` when the agent read it. */
    via: z.enum(['rule', 'tool']),
  }),
  z.object({
    kind: z.literal('model'),
    text: z.string(),
    toolCalls: z.array(ToolCallSchema),
    usage: UsageSchema,
    /** What the provider billed for the call, in US dollars, when it reported it. */
    costUsd: z.number().nonnegative().optional(),
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
    /** The write the call made or asked for. */
    change: WriteRecordSchema.optional(),
    /** For a read of a table, the rows it showed, parsed. */
    table: TableViewSchema.optional(),
  }),
  z.object({
    kind: z.literal('refusal'),
    taskType: z.string(),
    reason: z.string(),
  }),
]);
export type TraceStep = z.infer<typeof TraceStepSchema>;

/**
 * What an attempt started from, so it can be told apart from others and replayed: the data it
 * saw, the harness and tools it ran with, and the settings the runner chose.
 */
export const ReplaySetupSchema = z.object({
  /** A sha256 of each data file's text when the attempt started, by path (`data/x.csv`). */
  data: z.record(z.string(), z.string()),
  harnessHash: z.string(),
  /** The version of the built-in tools: what they do and the text of their results. */
  toolRuntime: z.string(),
  /** The sampler seed of every model call. */
  seed: z.number().int(),
  decoding: DecodingSchema,
  /** The date the agent worked as of, YYYY-MM-DD. */
  today: z.string(),
});
export type ReplaySetup = z.infer<typeof ReplaySetupSchema>;

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
  /** Absent from traces made before it was recorded. */
  replay: ReplaySetupSchema.optional(),
  /** Every file the attempt changed, each as a diff from how it started. */
  changes: z.array(FileChangeSchema).optional(),
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
