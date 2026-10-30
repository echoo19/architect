import { z } from 'zod';
import { JsonValueSchema } from './json';

/**
 * Counterexample-guided repair (docs/CERTIFY.md section 2, decision 078). When a helper the
 * mentor wrote fails on a train attempt, its call is replayed in the sandbox, the input tables
 * are reduced while the same failure still holds, and the reduced case is kept: the mentor
 * repairs the helper against it, and every later change to that helper must pass it.
 */

/**
 * The failure a counterexample reproduces. `threw`: the helper threw this message. `contradicts`:
 * the helper's output gives `got` for a field where the checker's expected values hold `expected`.
 */
export const CounterexamplePredicateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('threw'), message: z.string() }),
  z.object({
    kind: z.literal('contradicts'),
    field: z.string().min(1),
    expected: JsonValueSchema,
    got: JsonValueSchema,
  }),
]);
export type CounterexamplePredicate = z.infer<typeof CounterexamplePredicateSchema>;

/** A table of a case: its columns and rows, every cell text and an empty cell null. */
export const CaseTableSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string().nullable())),
});
export type CaseTable = z.infer<typeof CaseTableSchema>;

const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);

/** One run of a helper on one case of the suite. */
export const SuiteResultSchema = z.object({
  counterexampleId: z.string(),
  /** The reduced case, or the attempt's own inputs rebuilt by replay. */
  case: z.enum(['reduced', 'original']),
  passed: z.boolean(),
  /** One sentence: what the helper did on the case. */
  detail: z.string(),
});
export type SuiteResult = z.infer<typeof SuiteResultSchema>;

/** A helper change measured against the suite (the earliest one that passed it, or the last try). */
export const CounterexampleRepairSchema = z.object({
  runId: z.string(),
  round: z.number().int().positive(),
  /** sha256 of the repaired code. */
  codeHash: sha256Hex,
  passed: z.boolean(),
  results: z.array(SuiteResultSchema),
});
export type CounterexampleRepair = z.infer<typeof CounterexampleRepairSchema>;

export const CounterexampleSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  runId: z.string(),
  /** The round whose train attempt failed. */
  round: z.number().int().positive(),
  taskId: z.string(),
  org: z.string().optional(),
  attemptId: z.string(),
  /** The call in the attempt's trace that was replayed. */
  callId: z.string(),
  helper: z.object({ name: z.string(), codeHash: sha256Hex }),
  arguments: z.record(z.string(), JsonValueSchema),
  predicate: CounterexamplePredicateSchema,
  /** The reduced tables, which the helper is run on. */
  tables: z.record(z.string(), CaseTableSchema),
  /** The text files kept with them, whole. */
  texts: z.record(z.string(), z.string()),
  size: z.object({
    originalRows: z.number().int().nonnegative(),
    reducedRows: z.number().int().nonnegative(),
    originalColumns: z.number().int().nonnegative(),
    reducedColumns: z.number().int().nonnegative(),
  }),
  /**
   * `1-minimal` only when removing any one remaining row (and, for a crash, column) was tried
   * and lost the failure; otherwise `reduced`. Rows the call points at and the rows they
   * reference by id are never removed (decision 078).
   */
  minimality: z.enum(['1-minimal', 'reduced']),
  /** Sandbox runs the reduction took. */
  steps: z.number().int().nonnegative(),
  /** sha256 of the original and the reduced inputs, tables and texts. */
  hashes: z.object({ original: sha256Hex, reduced: sha256Hex }),
  repair: CounterexampleRepairSchema.optional(),
  createdAt: z.string(),
});
export type Counterexample = z.infer<typeof CounterexampleSchema>;

function shown(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
}

/** An error's own words, without the `Error: ` its kind puts before them. */
export function errorWords(message: string): string {
  return message.replace(/^Error:\s*/, '');
}

/** The failure in plain words, for the mentor and for the person. */
export function predicateSentence(helper: string, predicate: CounterexamplePredicate): string {
  return predicate.kind === 'threw'
    ? `${helper} stops with the error "${errorWords(predicate.message)}"`
    : `${helper} gives ${predicate.field} ${shown(predicate.got)} where the checker expects ${shown(predicate.expected)}`;
}
