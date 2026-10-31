import { z } from 'zod';
import { JsonValueSchema } from './json';

/*
 * Contracts for planning a training job on a cluster (docs/SCALE.md, decision 072): a model's
 * Hugging Face `config.json` as it is read, the plan worked out from it, and the record a launch
 * bundle carries. Everything here is an estimate or a generated file; nothing in it has run on a
 * cluster.
 */

export const TRAINING_PLAN_FORMAT = 'architect.training-plan/1';
export const TRAIN_BUNDLE_FORMAT = 'architect.train-bundle/1';

/** The words every plan and bundle carries, from SCALE.md's amendments. */
export const CLUSTER_TEMPLATE_WORDING =
  'Architect develops and evaluates field-specific agent harnesses and exports checker-verified training examples. Experimental cluster templates are validated structurally and against simulated schedulers; GPU execution, large-model compatibility and training gains remain unverified.';

/** A model's `config.json`: any JSON object. The sizing reads the fields it knows and checks each. */
export const ModelConfigSchema = z.record(z.string(), JsonValueSchema);
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const TrainMethodSchema = z.enum(['lora', 'qlora', 'full']);
export type TrainMethod = z.infer<typeof TrainMethodSchema>;

/** The dtype weights are kept and computed in; QLoRA computes in it over 4-bit weights. */
export const TrainPrecisionSchema = z.enum(['bf16', 'fp16', 'fp32']);
export type TrainPrecision = z.infer<typeof TrainPrecisionSchema>;

/** Where a bundle runs: Slurm, a Kubernetes cluster's training operator, or SkyPilot on any cloud. */
export const ClusterTargetSchema = z.enum(['slurm', 'kubernetes', 'skypilot']);
export type ClusterTarget = z.infer<typeof ClusterTargetSchema>;

const repoId = z.string().regex(/^[\w.-]+\/[\w.-]+$/);
const sha256Hex = z.string().regex(/^[0-9a-f]{64}$/);
const gitCommit = z.string().regex(/^[0-9a-f]{40}$/);

/** One part of the memory a GPU needs, with how it was worked out. */
export const MemoryTermSchema = z.strictObject({
  key: z.enum([
    'weights',
    'adapter',
    'adapter_gradients',
    'adapter_optimizer',
    'gradients',
    'optimizer',
    'activations',
    'fsdp_peak',
    'runtime',
  ]),
  label: z.string(),
  bytes: z.number().nonnegative(),
  /** The arithmetic with its numbers, as a person checks it. */
  arithmetic: z.string(),
  /** Split across the GPUs by FSDP (true), or held whole on each GPU (false). */
  sharded: z.boolean(),
});
export type MemoryTerm = z.infer<typeof MemoryTermSchema>;

/** A model's parameters, counted from its configuration. */
export const ModelSizeSchema = z.strictObject({
  architecture: z.string(),
  totalParams: z.number().int().nonnegative(),
  /** Parameters one token passes through: top-k experts, not all of them. Never used for memory. */
  activeParams: z.number().int().nonnegative(),
  /** Parameters in the decoder's linear layers, which QLoRA stores in 4 bits. */
  linearParams: z.number().int().nonnegative(),
  layers: z.number().int().positive(),
  hiddenSize: z.number().int().positive(),
  vocabSize: z.number().int().positive(),
  /** The widest MLP a token passes through in one layer: its experts' widths added up. */
  activeMlpWidth: z.number().int().nonnegative(),
  moeLayers: z.number().int().nonnegative(),
  experts: z.number().int().nonnegative(),
  expertsPerToken: z.number().int().nonnegative(),
  /** How the configuration says which layers hold experts. */
  moePattern: z.string(),
  /** The largest unit FSDP wraps and gathers whole on each GPU. */
  largestUnit: z.strictObject({ name: z.string(), params: z.number().int().nonnegative() }),
  /** LoRA parameters at rank 1 on attention and MLP or expert projections; scale by the rank. */
  loraParamsPerRank: z.number().int().nonnegative(),
  notes: z.array(z.string()),
});
export type ModelSize = z.infer<typeof ModelSizeSchema>;

export const TrainingPlanSchema = z.strictObject({
  format: z.literal(TRAINING_PLAN_FORMAT),
  /** Every number in a plan is an estimate. */
  label: z.literal('estimate'),
  model: z.strictObject({ repo: repoId.nullable(), revision: z.string().nullable() }),
  input: z.strictObject({
    method: TrainMethodSchema,
    precision: TrainPrecisionSchema,
    gpu: z.strictObject({ name: z.string(), memoryGb: z.number().positive() }),
    seqLen: z.number().int().positive(),
    microBatch: z.number().int().positive(),
    gpusPerNode: z.number().int().positive(),
    loraRank: z.number().int().positive(),
  }),
  size: ModelSizeSchema,
  terms: z.array(MemoryTermSchema),
  shardedBytes: z.number().nonnegative(),
  perGpuFixedBytes: z.number().nonnegative(),
  headroom: z.strictObject({
    fraction: z.number().min(0).max(1),
    usableBytes: z.number().nonnegative(),
    arithmetic: z.string(),
  }),
  /** The smallest count that fits; null when no count does, with the reason. */
  fit: z
    .strictObject({
      gpus: z.number().int().positive(),
      nodes: z.number().int().positive(),
      gpusPerNode: z.number().int().positive(),
      perGpuBytes: z.number().nonnegative(),
      arithmetic: z.string(),
    })
    .nullable(),
  reason: z.string().nullable(),
  assumptions: z.array(z.string()),
  wording: z.literal(CLUSTER_TEMPLATE_WORDING),
});
export type TrainingPlan = z.infer<typeof TrainingPlanSchema>;

/** `bundle.json`: what a launch bundle was made from, so trained weights trace back to a field. */
export const TrainBundleSchema = z.strictObject({
  format: z.literal(TRAIN_BUNDLE_FORMAT),
  experimental: z.literal(true),
  target: ClusterTargetSchema,
  base_model: z.strictObject({ repo: repoId, revision: gitCommit }),
  method: TrainMethodSchema,
  nodes: z.number().int().positive(),
  gpus_per_node: z.number().int().positive(),
  /** The field export the data came from; null when the bundle was made without one. */
  field_export: z
    .strictObject({
      manifest_sha256: sha256Hex.nullable(),
      declared_hash: z.string().nullable(),
      data: z.array(z.strictObject({ name: z.string(), sha256: sha256Hex })),
    })
    .nullable(),
  recipe: z.strictObject({
    /** sha256 over the recipe files' names and hashes, one `name sha256` line each, sorted. */
    sha256: sha256Hex,
    files: z.array(z.strictObject({ name: z.string(), sha256: sha256Hex })),
    /** The pinned recipe whose image and package versions the bundle reuses. */
    pins: z.strictObject({ name: z.string(), sha256: sha256Hex }),
  }),
  submit: z.string(),
  wording: z.literal(CLUSTER_TEMPLATE_WORDING),
});
export type TrainBundle = z.infer<typeof TrainBundleSchema>;

/** GPU memory by type, in GB (10^9 bytes) as each is sold. A plan may name any other by its memory. */
export const GPU_TYPES: Readonly<Record<string, number>> = {
  'h100-80gb': 80,
  h200: 141,
  'a100-80gb': 80,
  'a100-40gb': 40,
  l40s: 48,
  b200: 180,
};

/*
 * The app's Compute place asks the engine for these: a model's config.json read from the Hub or
 * from a file the person chose, a plan sized from it, and a bundle written from that plan.
 */

/** Where a model's config.json comes from: the Hub at a revision, or a file on this computer. */
export const ModelConfigSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hub'), repo: repoId, revision: z.string().min(1) }),
  z.strictObject({ kind: z.literal('file'), path: z.string().min(1) }),
]);
export type ModelConfigSource = z.infer<typeof ModelConfigSourceSchema>;

/** A config.json as read, with the model it names: a Hub read resolves its revision to a commit. */
export const ModelConfigReadSchema = z.strictObject({
  config: ModelConfigSchema,
  model: z.strictObject({ repo: repoId.nullable(), revision: z.string().nullable() }),
});
export type ModelConfigRead = z.infer<typeof ModelConfigReadSchema>;

/** A plan's settings, beside the config they size. */
export const TrainingPlanRequestSchema = z.strictObject({
  ...ModelConfigReadSchema.shape,
  method: TrainMethodSchema,
  precision: TrainPrecisionSchema,
  gpu: z.strictObject({ name: z.string().min(1), memoryGb: z.number().positive() }),
  seqLen: z.number().int().positive(),
  microBatch: z.number().int().positive(),
  gpusPerNode: z.number().int().positive(),
  loraRank: z.number().int().positive(),
});
export type TrainingPlanRequest = z.infer<typeof TrainingPlanRequestSchema>;

/** A bundle to write: the plan, sized again, a field export's folder, and where to write it. */
export const TrainBundleRequestSchema = z.strictObject({
  plan: TrainingPlanRequestSchema,
  target: ClusterTargetSchema,
  exportDir: z.string().min(1),
  /** The bundle goes in a new folder inside this one, named for the model and the target. */
  parentDir: z.string().min(1),
});
export type TrainBundleRequest = z.infer<typeof TrainBundleRequestSchema>;

export const WrittenTrainBundleSchema = z.strictObject({
  bundle: TrainBundleSchema,
  dir: z.string(),
  files: z.array(z.string()),
});
export type WrittenTrainBundle = z.infer<typeof WrittenTrainBundleSchema>;
