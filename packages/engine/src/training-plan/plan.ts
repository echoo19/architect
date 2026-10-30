import {
  CLUSTER_TEMPLATE_WORDING,
  GPU_TYPES,
  TRAINING_PLAN_FORMAT,
  TrainingPlanSchema,
  type MemoryTerm,
  type ModelConfig,
  type TrainingPlan,
  type TrainMethod,
  type TrainPrecision,
} from '@architect/shared';
import { sizeModel } from './size';

/** GPU memory by type, kept with the contracts so the app's screens list the same types. */
export { GPU_TYPES };

export const GB = 1e9;
/** Kept back on each GPU for the allocator's fragmentation and anything this sizing misses. */
export const HEADROOM_FRACTION = 0.1;
/** The CUDA context, cuBLAS workspace and NCCL buffers on each GPU. */
export const RUNTIME_BYTES = 2 * GB;
/**
 * NF4 with double quantization: 4 bits a weight, one 8-bit scale per 64 weights, and one 32-bit
 * scale per 256 of those.
 */
export const NF4_BYTES = 0.5 + 1 / 64 + 4 / (64 * 256);

const PRECISION_BYTES: Readonly<Record<TrainPrecision, number>> = { bf16: 2, fp16: 2, fp32: 4 };

export interface TrainingPlanInput {
  model?: { repo: string | null; revision: string | null };
  method: TrainMethod;
  precision: TrainPrecision;
  gpu: { name: string; memoryGb: number };
  seqLen: number;
  microBatch: number;
  gpusPerNode: number;
  loraRank: number;
}

/** A number of parameters as people read it: 235.1B, 72.4M. */
export function params(count: number): string {
  if (count >= 1e9) return `${(count / 1e9).toFixed(1)}B`;
  if (count >= 1e6) return `${(count / 1e6).toFixed(1)}M`;
  if (count >= 1e3) return `${(count / 1e3).toFixed(1)}K`;
  return String(count);
}

/** Bytes in GB (10^9), as the plan shows them. */
export function gb(bytes: number): string {
  return `${(bytes / GB).toFixed(bytes >= 10 * GB ? 1 : 2)} GB`;
}

/**
 * Works out the memory a training job needs on each GPU, term by term, and the fewest GPUs and
 * nodes it fits on with FSDP sharding. Every expert is resident whether it is active or not, and
 * LoRA freezes weights without removing them. The result is an estimate and says so.
 */
export function planTraining(config: ModelConfig, input: TrainingPlanInput): TrainingPlan {
  const size = sizeModel(config);
  const { method, precision, seqLen: s, microBatch: b, loraRank: r } = input;
  const p = PRECISION_BYTES[precision];
  const terms: MemoryTerm[] = [];
  const assumptions: string[] = [
    'Gradient checkpointing on every decoder layer, and attention by a fused kernel that keeps no sequence-by-sequence matrix.',
    'FSDP full sharding, one wrapped unit per decoder layer; data parallel, so each GPU holds its own micro-batch.',
    'Adam (AdamW) for whatever is trained.',
  ];

  // Resident weights: every parameter, every expert.
  const everyExpert = size.experts > 0 ? `, all ${size.experts} experts in every expert layer` : '';
  if (method === 'qlora') {
    const other = size.totalParams - size.linearParams;
    const bytes = size.linearParams * NF4_BYTES + other * p;
    terms.push({
      key: 'weights',
      label: `Resident weights${everyExpert}, frozen in 4 bits`,
      bytes,
      arithmetic: `${params(size.linearParams)} linear parameters × ${NF4_BYTES.toFixed(4)} bytes (NF4 with double quantization) + ${params(other)} embeddings and norms × ${p} bytes (${precision}) = ${gb(bytes)}`,
      sharded: true,
    });
    assumptions.push(
      "Every linear layer, each expert's included, is one bitsandbytes can quantize; expert weights a model fuses into one tensor stay in the compute precision, which this doesn't count.",
    );
  } else {
    const bytes = size.totalParams * p;
    terms.push({
      key: 'weights',
      label: `${method === 'full' ? 'Weights' : 'Resident weights'}${everyExpert}${method === 'full' ? '' : ', frozen'}`,
      bytes,
      arithmetic: `${params(size.totalParams)} parameters × ${p} bytes (${precision}) = ${gb(bytes)}`,
      sharded: true,
    });
  }

  if (method === 'full') {
    const gradients = size.totalParams * p;
    terms.push({
      key: 'gradients',
      label: 'Gradients for every parameter',
      bytes: gradients,
      arithmetic: `${params(size.totalParams)} × ${p} bytes (${precision}) = ${gb(gradients)}`,
      sharded: true,
    });
    const perParam = p === 4 ? 8 : 12;
    const optimizer = size.totalParams * perParam;
    terms.push({
      key: 'optimizer',
      label: p === 4 ? 'Adam: two fp32 moments' : 'Adam: an fp32 master copy and two fp32 moments',
      bytes: optimizer,
      arithmetic: `${params(size.totalParams)} × ${perParam} bytes = ${gb(optimizer)}`,
      sharded: true,
    });
  } else {
    const adapter = size.loraParamsPerRank * r;
    const shape = `${params(size.loraParamsPerRank)} per rank × rank ${r} = ${params(adapter)} parameters`;
    terms.push(
      {
        key: 'adapter',
        label: 'LoRA adapter on attention and every MLP or expert projection, in fp32',
        bytes: adapter * 4,
        arithmetic: `${shape} × 4 bytes = ${gb(adapter * 4)}`,
        sharded: true,
      },
      {
        key: 'adapter_gradients',
        label: "The adapter's gradients, in fp32",
        bytes: adapter * 4,
        arithmetic: `${params(adapter)} × 4 bytes = ${gb(adapter * 4)}`,
        sharded: true,
      },
      {
        key: 'adapter_optimizer',
        label: "Adam's two fp32 moments for the adapter",
        bytes: adapter * 8,
        arithmetic: `${params(adapter)} × 8 bytes = ${gb(adapter * 8)}`,
        sharded: true,
      },
    );
  }

  // Activations: each GPU's own micro-batch, so not sharded.
  const h = size.hiddenSize;
  const checkpoints = b * s * h * p * size.layers;
  const layer = b * s * (8 * h + 3 * size.activeMlpWidth) * p;
  const logits = b * s * size.vocabSize * (p + 4);
  const activations = checkpoints + layer + logits;
  terms.push({
    key: 'activations',
    label: 'Activations for one micro-batch (approximate)',
    bytes: activations,
    arithmetic: `checkpoints b·s·h·${p}·L = ${b}·${s}·${h}·${p}·${size.layers} = ${gb(checkpoints)}; one layer recomputed ≈ b·s·(8h + 3·${size.activeMlpWidth} active MLP width)·${p} = ${gb(layer)}; logits b·s·vocab·(${p} + 4 for the fp32 loss) = ${gb(logits)}; total ${gb(activations)}`,
    sharded: false,
  });

  // FSDP gathers each wrapped unit whole before using it, and prefetches the next one.
  const unitBytesPerParam =
    method === 'qlora' && size.largestUnit.name !== 'the embedding table' ? NF4_BYTES : p;
  const unit = size.largestUnit.params * unitBytesPerParam;
  const copies = method === 'full' ? 3 : 2;
  const peak = unit * copies;
  terms.push({
    key: 'fsdp_peak',
    label: `FSDP's peak: ${size.largestUnit.name} gathered whole`,
    bytes: peak,
    arithmetic: `${params(size.largestUnit.params)} × ${unitBytesPerParam === p ? `${p} bytes` : `${NF4_BYTES.toFixed(4)} bytes`} = ${gb(unit)} per unit × ${copies} (${method === 'full' ? 'the unit in use, the next one prefetched, and the unit’s full gradients before they are scattered' : 'the unit in use and the next one prefetched'}) = ${gb(peak)}`,
    sharded: false,
  });
  terms.push({
    key: 'runtime',
    label: 'CUDA context, cuBLAS workspace and NCCL buffers',
    bytes: RUNTIME_BYTES,
    arithmetic: `taken as ${gb(RUNTIME_BYTES)}`,
    sharded: false,
  });

  const shardedBytes = terms.filter((t) => t.sharded).reduce((sum, t) => sum + t.bytes, 0);
  const fixed = terms.filter((t) => !t.sharded).reduce((sum, t) => sum + t.bytes, 0);
  const gpuBytes = input.gpu.memoryGb * GB;
  const usable = gpuBytes * (1 - HEADROOM_FRACTION);
  const headroom = {
    fraction: HEADROOM_FRACTION,
    usableBytes: usable,
    arithmetic: `${input.gpu.memoryGb} GB × (1 − ${HEADROOM_FRACTION}) = ${gb(usable)} usable on each ${input.gpu.name}`,
  };

  let fit: TrainingPlan['fit'] = null;
  let reason: string | null = null;
  if (fixed >= usable) {
    reason = `Each GPU holds ${gb(fixed)} whatever the count (activations, FSDP's peak, the runtime), more than the ${gb(usable)} usable on a ${input.gpu.name}. Shorten the sequence, lower the micro-batch, or choose a larger GPU.`;
  } else {
    const least = Math.max(1, Math.ceil(shardedBytes / (usable - fixed)));
    const nodes = Math.ceil(least / input.gpusPerNode);
    const gpus = nodes === 1 ? least : nodes * input.gpusPerNode;
    const perGpuBytes = shardedBytes / gpus + fixed;
    fit = {
      gpus,
      nodes,
      gpusPerNode: nodes === 1 ? gpus : input.gpusPerNode,
      perGpuBytes,
      arithmetic: `sharded ${gb(shardedBytes)} ÷ (usable ${gb(usable)} − whole on each GPU ${gb(fixed)}) = ${(shardedBytes / (usable - fixed)).toFixed(2)}, so at least ${least} GPU${least === 1 ? '' : 's'}; ${nodes === 1 ? 'one node' : `${nodes} nodes of ${input.gpusPerNode}`} = ${gpus} GPU${gpus === 1 ? '' : 's'}, ${gb(perGpuBytes)} on each`,
    };
  }

  return TrainingPlanSchema.parse({
    format: TRAINING_PLAN_FORMAT,
    label: 'estimate',
    model: input.model ?? { repo: null, revision: null },
    input: {
      method,
      precision,
      gpu: input.gpu,
      seqLen: s,
      microBatch: b,
      gpusPerNode: input.gpusPerNode,
      loraRank: r,
    },
    size,
    terms,
    shardedBytes,
    perGpuFixedBytes: fixed,
    headroom,
    fit,
    reason,
    assumptions,
    wording: CLUSTER_TEMPLATE_WORDING,
  });
}

/** A plan as lines of text: the model, each term with its arithmetic, the fit, the estimate's label. */
export function describePlan(plan: TrainingPlan): string[] {
  const { size, input } = plan;
  const model = plan.model.repo
    ? `${plan.model.repo}${plan.model.revision ? ` at ${plan.model.revision}` : ''}`
    : 'The model';
  const lines = [
    `${model}: ${size.architecture}, ${params(size.totalParams)} parameters (${params(size.activeParams)} active per token), ${size.layers} layers; ${size.moePattern}.`,
    `${input.method.toUpperCase()} in ${input.precision}, sequence ${input.seqLen}, micro-batch ${input.microBatch}, on ${input.gpu.name} (${input.gpu.memoryGb} GB). Estimates, not measurements.`,
    '',
    ...plan.terms.flatMap((term) => [
      `  ${term.label}${term.sharded ? ' (sharded)' : ' (on each GPU)'}: ${gb(term.bytes)}`,
      `    ${term.arithmetic}`,
    ]),
    `  Headroom: ${plan.headroom.arithmetic}`,
    '',
    plan.fit
      ? `Fits on ${plan.fit.gpus} GPU${plan.fit.gpus === 1 ? '' : 's'} (${plan.fit.nodes} node${plan.fit.nodes === 1 ? '' : 's'}): ${plan.fit.arithmetic}.`
      : `Doesn't fit: ${plan.reason ?? ''}`,
    '',
    'Assumptions:',
    ...[...plan.assumptions, ...size.notes].map((note) => `  ${note}`),
    '',
    plan.wording,
  ];
  return lines;
}
