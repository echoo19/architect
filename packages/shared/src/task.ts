import { z } from 'zod';
import { JsonValueSchema } from './json';

/**
 * How a parsed `ANSWER:` value is compared with the expected value.
 * - exact: deep equality after normalizing strings (trim, case-insensitive) and key order
 * - set: arrays compared as unordered sets (of normalized items)
 * - number: numeric equality within `tolerance`
 */
export const AnswerCompareSchema = z.object({
  mode: z.enum(['exact', 'set', 'number']).default('exact'),
  tolerance: z.number().nonnegative().optional(),
  /** For object answers: only these keys are compared. */
  keys: z.array(z.string()).optional(),
  /** For object answers: these keys hold arrays compared as unordered sets. */
  setKeys: z.array(z.string()).optional(),
});
export type AnswerCompare = z.infer<typeof AnswerCompareSchema>;

export const ExpectedSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('answer'),
    value: JsonValueSchema,
    compare: AnswerCompareSchema.default({ mode: 'exact' }),
  }),
  z.object({
    kind: z.literal('facts'),
    /** Each fact is a dotted path into the ANSWER object and the value it must hold. */
    facts: z.array(z.object({ path: z.string().min(1), value: JsonValueSchema })).min(1),
  }),
  z.object({
    kind: z.literal('end_state'),
    /** Name of a validator exported by the job's checker module. */
    validator: z.string().min(1),
    params: z.record(z.string(), JsonValueSchema),
    /**
     * The files the task may change: a data file by its name, an output file by its path
     * (`output/report.md`). When listed, an attempt that changed or made any other file fails
     * whatever the validator says. Absent: the validator alone judges the end state.
     */
    writes: z.array(z.string().min(1)).optional(),
  }),
]);
export type Expected = z.infer<typeof ExpectedSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1),
  /** Task type, e.g. `invoice`. Used for per-type results, stratified splits and guardrails. */
  type: z.string().min(1),
  /** Tasks with the same family are near-duplicates and always land in the same split. */
  family: z.string().min(1),
  /**
   * The organization the task belongs to, by id; required when the job lists organizations. Its
   * `data/` is that organization's files, for the student and the checker alike.
   */
  org: z.string().min(1).optional(),
  /** The request as the agent sees it. */
  prompt: z.string().min(1),
  expected: ExpectedSchema,
  /** Optional facts for humans reading results (never shown to the student). */
  meta: z.record(z.string(), JsonValueSchema).optional(),
});
export type Task = z.infer<typeof TaskSchema>;

export const SplitNameSchema = z.enum(['calibration', 'train', 'dev', 'test']);
export type SplitName = z.infer<typeof SplitNameSchema>;

/** The line every task answer ends with. */
export const ANSWER_PREFIX = 'ANSWER:';
