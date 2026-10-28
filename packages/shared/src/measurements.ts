import { z } from 'zod';
import { StudentTargetSchema } from './job';
import { SplitNameSchema } from './task';

/**
 * What the runtime serving a model did during one stretch of an evaluation, beside the attempts
 * it served (decision 045): how much memory its server process and the GPU held at most, and how
 * long its first reply took when the model had to load first. A meter takes these on this
 * computer only; a hosted copy has none to take. An evaluation interrupted and resumed has one
 * record per stretch, and the most any of them saw is the evaluation's peak.
 */
export const RuntimeMeasurementSchema = z.object({
  id: z.string().regex(/^msr_[a-z0-9]+$/),
  runId: z.string().min(1),
  split: SplitNameSchema,
  target: StudentTargetSchema,
  /** The attempts' configuration key: `student`, `student/llama.cpp/<adapter>@<scale>`, ... */
  config: z.string().min(1),
  harnessVersion: z.number().int().nonnegative(),
  seeds: z.array(z.number().int()),
  /** `ollama` or `llama.cpp`: the runtime the meter watched. */
  backend: z.string().min(1),
  /** The most memory the server's processes held (resident set) at any sample; null if none read. */
  peakProcessBytes: z.number().int().nonnegative().nullable(),
  /** The most GPU memory in use on the card at any sample; null without a GPU reading. */
  peakGpuBytes: z.number().int().nonnegative().nullable(),
  /** How long a first reply took with the model unloaded before it; null when not measured. */
  coldStartMs: z.number().int().nonnegative().nullable(),
  samples: z.number().int().nonnegative(),
  /** How the numbers were read, such as `nvidia-smi and tasklist every 2 s`. */
  sampler: z.string().min(1),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
});
export type RuntimeMeasurement = z.infer<typeof RuntimeMeasurementSchema>;
