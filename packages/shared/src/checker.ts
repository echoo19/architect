import { z } from 'zod';
import { JsonValueSchema } from './json';

export const CheckResultSchema = z.object({
  pass: z.boolean(),
  /** One sentence a person can read: why it passed or failed. */
  reason: z.string().min(1),
  details: z.record(z.string(), JsonValueSchema).optional(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

/**
 * `builtin` handles `answer` and `facts` expectations. `module` points at a JavaScript file in
 * the job folder that exports end-state validators; it runs in the sandbox with no clock or
 * randomness, so it stays deterministic.
 */
export const CheckerConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('builtin') }),
  z.object({ kind: z.literal('module'), path: z.string().min(1) }),
]);
export type CheckerConfig = z.infer<typeof CheckerConfigSchema>;

/** What a checker sees about an attempt. */
export const CheckOutcomeSchema = z.object({
  finalText: z.string(),
  /** Parsed JSON from the last `ANSWER:` line, or null if missing or invalid. */
  answer: JsonValueSchema.nullable(),
  answerError: z.string().optional(),
  toolCalls: z.array(
    z.object({ name: z.string(), arguments: z.record(z.string(), JsonValueSchema) }),
  ),
  stopReason: z.enum(['answer', 'max_steps', 'refused', 'error', 'aborted']),
});
export type CheckOutcome = z.infer<typeof CheckOutcomeSchema>;
