import { z } from 'zod';
import { ScoreSchema } from './lineage';
import { MethodSchema } from './run';
import { StudentTargetSchema } from './job';
import { TypeResultSchema } from './report';

/** graduate.yaml: what pins a harness to a model and records how it was made. */
export const GraduateManifestSchema = z.object({
  format: z.literal(1),
  id: z.string(),
  name: z.string().min(1),
  jobId: z.string(),
  runId: z.string(),
  method: MethodSchema,
  createdAt: z.iso.datetime(),
  acceptedAt: z.iso.datetime().optional(),
  student: z.object({
    label: z.string(),
    runtime: z.enum(['ollama', 'openai_compatible']),
    baseUrl: z.url(),
    model: z.string(),
    quantization: z.string().optional(),
    digest: z.string().optional(),
    sizeBytes: z.number().int().nonnegative().optional(),
    contextLength: z.number().int().positive(),
  }),
  harness: z.object({
    version: z.number().int().nonnegative(),
    hash: z.string(),
    /** The round whose kept change made this version; absent for the starting harness. */
    round: z.number().int().positive().optional(),
    /** That round wrote a whole draft rather than one change. */
    draft: z.literal(true).optional(),
  }),
  requirements: z.object({
    passRate: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }),
    p95LatencyMs: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }).optional(),
  }),
  test: z.object({
    score: ScoreSchema,
    perType: z.array(TypeResultSchema),
    /**
     * Where the locked test ran: the pinned local build or a hosted copy of the student. Graduates
     * from before this was recorded leave it out; theirs ran locally.
     */
    testedOn: StudentTargetSchema.optional(),
  }),
  mentor: z.object({ label: z.string(), model: z.string() }),
});
export type GraduateManifest = z.infer<typeof GraduateManifestSchema>;
