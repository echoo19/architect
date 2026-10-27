import { z } from 'zod';
import { ScoreSchema } from './lineage';
import { MethodSchema } from './run';
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
  harness: z.object({ version: z.number().int().nonnegative(), hash: z.string() }),
  requirements: z.object({
    passRate: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }),
    p95LatencyMs: z.object({ target: z.number(), actual: z.number(), met: z.boolean() }).optional(),
  }),
  test: z.object({ score: ScoreSchema, perType: z.array(TypeResultSchema) }),
  mentor: z.object({ label: z.string(), model: z.string() }),
});
export type GraduateManifest = z.infer<typeof GraduateManifestSchema>;
