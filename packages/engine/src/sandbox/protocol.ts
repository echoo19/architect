import { createHash } from 'node:crypto';
import { JsonValueSchema } from '@architect/shared';
import { z } from 'zod';

/**
 * Messages between the engine and the sandbox child process. Tables and texts travel as content
 * hashes plus, only when the child doesn't have them yet, the content itself.
 */

export const SandboxFailureSchema = z.object({
  kind: z.enum(['load', 'error', 'timeout', 'memory', 'invalid_result', 'crashed']),
  message: z.string(),
});
export type SandboxFailure = z.infer<typeof SandboxFailureSchema>;

export const FileInfoSchema = z.object({
  name: z.string(),
  kind: z.enum(['table', 'text']),
  access: z.enum(['read', 'write']),
  description: z.string().optional(),
  rows: z.number().int().nonnegative().optional(),
  columns: z.array(z.string()).optional(),
});

export const TableSnapshotSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.string().nullable())),
});

/** Name to content hash. */
const RefsSchema = z.record(z.string(), z.string());

const ToolJobSchema = z.object({
  kind: z.literal('tool'),
  name: z.string(),
  code: z.string(),
  args: z.record(z.string(), JsonValueSchema),
  files: z.array(FileInfoSchema),
  tables: RefsSchema,
  texts: RefsSchema,
});

const ValidatorJobSchema = z.object({
  kind: z.literal('validator'),
  source: z.string(),
  validator: z.string(),
  params: z.record(z.string(), JsonValueSchema),
  tables: RefsSchema,
  originalTables: RefsSchema,
  answer: JsonValueSchema.nullable(),
  finalText: z.string(),
  toolCalls: z.array(
    z.object({ name: z.string(), arguments: z.record(z.string(), JsonValueSchema) }),
  ),
});

export const SandboxJobSchema = z.discriminatedUnion('kind', [ToolJobSchema, ValidatorJobSchema]);
export type SandboxJob = z.infer<typeof SandboxJobSchema>;

export const LimitsSchema = z.object({
  timeoutMs: z.number().int().positive(),
  memoryLimitBytes: z.number().int().positive(),
});
export type Limits = z.infer<typeof LimitsSchema>;

export const RunRequestSchema = z.object({
  type: z.literal('run'),
  id: z.number().int(),
  job: SandboxJobSchema,
  limits: LimitsSchema,
  /** Content for hashes the child may not have: table JSON or text. */
  blobs: z.record(z.string(), z.string()),
});
export type RunRequest = z.infer<typeof RunRequestSchema>;

export const ChildOutcomeSchema = z.union([
  z.object({ ok: z.literal(true), json: z.string() }),
  z.object({ ok: z.literal(false), failure: SandboxFailureSchema }),
]);
export type ChildOutcome = z.infer<typeof ChildOutcomeSchema>;

export const ChildMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('missing'), id: z.number().int(), hashes: z.array(z.string()) }),
  z.object({ type: z.literal('result'), id: z.number().int(), outcome: ChildOutcomeSchema }),
]);
export type ChildMessage = z.infer<typeof ChildMessageSchema>;

/** Hashes a job refers to, which the child must hold before it can run the job. */
export function referencedHashes(job: SandboxJob): string[] {
  const refs = job.kind === 'tool' ? [job.tables, job.texts] : [job.tables, job.originalTables];
  return [...new Set(refs.flatMap((record) => Object.values(record)))];
}

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
