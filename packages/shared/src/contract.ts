import { z } from 'zod';
import { DataFileSchema } from './data';
import { PermissionModeSchema, TaskTypeInfoSchema, type Job } from './job';

/**
 * A file the job reads or writes, as its contract names it. The same declaration as the job's
 * data file, so the runtime enforces exactly what the contract promises.
 */
export const ContractFileSchema = DataFileSchema;
export type ContractFile = z.infer<typeof ContractFileSchema>;

/**
 * What a job promises, versioned: what the agent does and doesn't do, what it reads and writes,
 * what it may never do, and what counts as passing. A change to any of it makes a new version,
 * and a graduation result belongs to the version it was measured against (spec sections 4 and 8).
 * Training settings (mentor, student endpoints, budget, splits) are not part of it.
 */
export const JobContractSchema = z
  .object({
    version: z.number().int().positive(),
    /** The job the contract belongs to, on the computer that wrote it. */
    jobId: z.string().min(1),
    name: z.string().min(1).max(60),
    description: z.string().min(1),
    summary: z.string().optional(),
    /** The day the job's records are current as of; the agent treats it as today. */
    businessDate: z.iso.date().optional(),
    capabilities: z
      .object({
        taskTypes: z.array(TaskTypeInfoSchema).min(1),
        does: z.array(z.string()),
        doesNot: z.array(z.string()),
      })
      .strict(),
    inputs: z
      .object({
        /** The request, in the user's words. */
        request: z.literal('text'),
        /** Every file the agent may open. They live in the `data` resource. */
        files: z.array(ContractFileSchema),
      })
      .strict(),
    outputs: z
      .object({
        /** The reply, in words. */
        answer: z.literal('text'),
        /** The files it may change, by name. Each is also an input with write access. */
        files: z.array(z.string()),
      })
      .strict(),
    boundaries: z
      .object({
        /** How writes are approved, as the job asked. An installation may grant less. */
        writes: PermissionModeSchema,
        /** Opening files the contract doesn't declare. */
        unseenFiles: PermissionModeSchema,
        /** A graduate never reaches the network; only its local model runtime. */
        network: z.literal('none'),
      })
      .strict(),
    acceptance: z
      .object({
        /** Share of the locked test the graduate must pass, 0 to 1. */
        passRate: z.number().min(0).max(1),
        p95LatencyMs: z.number().int().positive().optional(),
      })
      .strict(),
  })
  .strict();
export type JobContract = z.infer<typeof JobContractSchema>;

/** A contract without its version number: what decides whether a change makes a new version. */
export type ContractTerms = Omit<JobContract, 'version'>;

/** The contract a job states right now, without a version number. */
export function contractTerms(job: Job): ContractTerms {
  return {
    jobId: job.id,
    name: job.name,
    description: job.description,
    ...(job.summary === undefined ? {} : { summary: job.summary }),
    ...(job.businessDate === undefined ? {} : { businessDate: job.businessDate }),
    capabilities: { taskTypes: job.taskTypes, does: job.does, doesNot: job.doesNot },
    inputs: { request: 'text', files: job.data.files },
    outputs: {
      answer: 'text',
      files: job.data.files.filter((file) => file.access === 'write').map((file) => file.name),
    },
    boundaries: {
      writes: job.permissions.writes,
      unseenFiles: job.permissions.unseenFiles,
      network: 'none',
    },
    acceptance: {
      passRate: job.requirements.passRate,
      ...(job.requirements.p95LatencyMs === undefined
        ? {}
        : { p95LatencyMs: job.requirements.p95LatencyMs }),
    },
  };
}

/**
 * Whether two contracts promise the same thing, whatever their version numbers. The name and
 * one-line summary are labels, so renaming a job keeps its contract; everything else, the
 * description included, is scope or success criteria.
 */
export function sameContractTerms(
  a: ContractTerms | JobContract,
  b: ContractTerms | JobContract,
): boolean {
  return canonical(scopeOf(a)) === canonical(scopeOf(b));
}

function scopeOf(terms: ContractTerms | JobContract): unknown {
  const { name: _name, summary: _summary, ...scope } = terms;
  if ('version' in scope) {
    const { version: _version, ...unversioned } = scope;
    return unversioned;
  }
  return scope;
}

/** JSON with object keys sorted, so key order never decides whether two values are equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner !== null && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner as Record<string, unknown>).sort(([x], [y]) =>
            x < y ? -1 : x > y ? 1 : 0,
          ),
        )
      : inner,
  );
}
