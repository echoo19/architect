import { metadataNumber, metadataString, type GgufHeader, type GgufTensorInfo } from './types';
import { float32Bytes, type GgufTensorSource, type GgufWriteSpec } from './write';

/**
 * GGUF LoRA adapters as llama.cpp loads them: `general.type` "adapter", `adapter.type` "lora",
 * `adapter.lora.alpha`, and for each adapted weight `<name>.lora_a` with dims [n_in, r] and
 * `<name>.lora_b` with dims [r, n_out], where the base weight `<name>` has dims [n_in, n_out].
 * llama.cpp scales each pair by alpha / r.
 */

/** Tensor types llama.cpp's converter writes for an adapter. */
export const LORA_TENSOR_TYPES: ReadonlySet<string> = new Set(['F32', 'F16', 'BF16', 'Q8_0']);

/** Metadata Architect adds to adapters it builds itself, so nobody mistakes them for trained ones. */
export const ADAPTER_KIND_KEY = 'architect.adapter.kind';
export const STAND_IN_ADAPTER_KIND = 'stand-in';
export const STAND_IN_ADAPTER_NAME = 'Architect stand-in adapter (not trained)';

const MAX_PROBLEMS = 20;

export interface LoraPair {
  /** The base weight this pair adapts, such as `blk.0.attn_q.weight`. */
  base: string;
  a: GgufTensorInfo;
  b: GgufTensorInfo;
  rank: number;
}

export interface LoraSummary {
  architecture: string;
  alpha: number;
  /** Distinct ranks, smallest first. */
  ranks: number[];
  pairs: number;
  /** The adapted kinds of weight, such as attn_q or ffn_down. */
  modules: string[];
  /** Distinct blocks with at least one adapted weight. */
  blocks: number;
  tensorTypes: string[];
  /** The adapter carries Architect's stand-in label: it was built, not trained. */
  standIn: boolean;
}

export interface LoraCheck {
  ok: boolean;
  /** Plain sentences, at most twenty, then a count of the rest. */
  problems: string[];
  summary: LoraSummary | null;
}

interface Inspection {
  problems: string[];
  pairs: LoraPair[];
  summary: LoraSummary | null;
}

/** `blk.12.attn_q.weight` is block 12, module attn_q; `output.weight` has no block. */
export function weightParts(name: string): { block: number | null; module: string } {
  const match = /^blk\.(\d+)\.(.+)\.weight$/.exec(name);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return { block: Number(match[1]), module: match[2] };
  }
  return { block: null, module: name.replace(/\.weight$/, '') };
}

function capped(problems: string[]): string[] {
  if (problems.length <= MAX_PROBLEMS) return problems;
  return [
    ...problems.slice(0, MAX_PROBLEMS),
    `${problems.length - MAX_PROBLEMS} more problems like these.`,
  ];
}

function inspect(adapter: GgufHeader): Inspection {
  const problems: string[] = [];
  const type = metadataString(adapter, 'general.type');
  if (type !== 'adapter') {
    problems.push(`general.type is ${type ?? 'missing'}; an adapter says "adapter".`);
  }
  const adapterType = metadataString(adapter, 'adapter.type');
  if (adapterType !== 'lora') {
    problems.push(`adapter.type is ${adapterType ?? 'missing'}; a LoRA says "lora".`);
  }
  const architecture = metadataString(adapter, 'general.architecture');
  if (!architecture) problems.push('The adapter does not name its architecture.');
  const alpha = metadataNumber(adapter, 'adapter.lora.alpha');
  if (alpha === null || !Number.isFinite(alpha) || alpha <= 0) {
    problems.push('adapter.lora.alpha is missing or not a positive number.');
  }

  const halves = new Map<string, { a?: GgufTensorInfo; b?: GgufTensorInfo }>();
  for (const tensor of adapter.tensors) {
    const match = /^(.+)\.lora_([ab])$/.exec(tensor.name);
    if (!match?.[1] || !match[2]) {
      problems.push(`${tensor.name} is not a lora_a or lora_b tensor.`);
      continue;
    }
    const entry = halves.get(match[1]) ?? {};
    entry[match[2] === 'a' ? 'a' : 'b'] = tensor;
    halves.set(match[1], entry);
    if (tensor.typeName === null || !LORA_TENSOR_TYPES.has(tensor.typeName)) {
      problems.push(
        `${tensor.name} has type ${tensor.typeName ?? tensor.typeId}, which an adapter can't use.`,
      );
    }
  }

  const pairs: LoraPair[] = [];
  for (const [base, { a, b }] of halves) {
    // llama.cpp lays these out transposed; Architect's recipe never adapts the embeddings.
    if (base === 'token_embd.weight') {
      problems.push('Adapters on the token embeddings are not supported.');
      continue;
    }
    if (!a || !b) {
      problems.push(`${base} has lora_${a ? 'a' : 'b'} without lora_${a ? 'b' : 'a'}.`);
      continue;
    }
    if (a.dims.length !== 2 || b.dims.length !== 2) {
      problems.push(`${base}: lora_a and lora_b must both be matrices.`);
      continue;
    }
    const [, rankA = 0] = a.dims;
    const [rankB = 0] = b.dims;
    if (rankA !== rankB) {
      problems.push(`${base}: lora_a has rank ${rankA} and lora_b has rank ${rankB}.`);
      continue;
    }
    pairs.push({ base, a, b, rank: rankA });
  }
  if (adapter.tensors.length === 0) problems.push('The adapter has no tensors.');

  const summary: LoraSummary | null =
    architecture && alpha !== null && pairs.length > 0
      ? {
          architecture,
          alpha,
          ranks: [...new Set(pairs.map((pair) => pair.rank))].sort((x, y) => x - y),
          pairs: pairs.length,
          modules: [...new Set(pairs.map((pair) => weightParts(pair.base).module))].sort(),
          blocks: new Set(
            pairs.map((pair) => weightParts(pair.base).block).filter((block) => block !== null),
          ).size,
          tensorTypes: [
            ...new Set(adapter.tensors.map((tensor) => tensor.typeName ?? String(tensor.typeId))),
          ].sort(),
          standIn: metadataString(adapter, ADAPTER_KIND_KEY) === STAND_IN_ADAPTER_KIND,
        }
      : null;
  return { problems, pairs, summary };
}

/** Checks an adapter on its own: what it claims to be and whether its tensors pair up. */
export function inspectLoraAdapter(adapter: GgufHeader): LoraCheck {
  const { problems, summary } = inspect(adapter);
  return { ok: problems.length === 0, problems: capped(problems), summary };
}

export interface LoraExpectation {
  /** Every pair must have this rank. */
  rank?: number;
  alpha?: number;
}

/**
 * Checks an adapter against the base model it will be loaded on, the way llama.cpp would refuse
 * it: same architecture, every adapted weight present in the base, and shapes that fit.
 */
export function checkLoraAgainstBase(
  adapter: GgufHeader,
  base: GgufHeader,
  expect: LoraExpectation = {},
): LoraCheck {
  const { problems, pairs, summary } = inspect(adapter);
  const architecture = metadataString(adapter, 'general.architecture');
  const baseArchitecture = metadataString(base, 'general.architecture');
  if (architecture && baseArchitecture && architecture !== baseArchitecture) {
    problems.push(`The adapter is for ${architecture}, but the base model is ${baseArchitecture}.`);
  }
  if (metadataString(base, 'general.type') === 'adapter') {
    problems.push('The base model file is itself an adapter.');
  }

  const baseTensors = new Map(base.tensors.map((tensor) => [tensor.name, tensor]));
  for (const pair of pairs) {
    const weight = baseTensors.get(pair.base);
    if (!weight) {
      problems.push(`The base model has no ${pair.base}.`);
      continue;
    }
    const [inputs = 0, outputs = 0] = weight.dims;
    if (weight.dims.length !== 2) {
      problems.push(`${pair.base} in the base model is not a matrix.`);
      continue;
    }
    if (pair.a.dims[0] !== inputs || pair.b.dims[1] !== outputs) {
      problems.push(
        `${pair.base} is [${inputs}, ${outputs}] in the base model, but the adapter's pair fits [${pair.a.dims[0]}, ${pair.b.dims[1]}].`,
      );
    }
    if (expect.rank !== undefined && pair.rank !== expect.rank) {
      problems.push(`${pair.base} has rank ${pair.rank}, not the expected ${expect.rank}.`);
    }
  }
  if (
    expect.alpha !== undefined &&
    summary !== null &&
    Math.abs(summary.alpha - expect.alpha) > 1e-6
  ) {
    problems.push(`The adapter's alpha is ${summary.alpha}, not the expected ${expect.alpha}.`);
  }
  return { ok: problems.length === 0, problems: capped(problems), summary };
}

export interface StandInLoraOptions {
  /** Base weights to adapt, by module name such as attn_q; every block that has one. */
  modules: readonly string[];
  /** Default 4. */
  rank?: number;
  /** Default: the rank, so llama.cpp's scale is 1. */
  alpha?: number;
  /**
   * `none` writes lora_b as zeros, so the adapter changes nothing at any scale: it proves the
   * plumbing without touching behavior. `perturb` writes small values in both, so output changes
   * when it is applied: it proves the adapter is really in use.
   */
  effect: 'none' | 'perturb';
  /** Largest value written in perturb mode. Default 0.01. */
  amplitude?: number;
  seed?: number;
}

/** A small deterministic generator (mulberry32), so the same options always write the same file. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A LoRA built for a base model without any training, labeled as a stand-in in its metadata. Tests
 * and plumbing checks use it; it never counts as a trained adapter.
 */
export function standInLoraSpec(base: GgufHeader, options: StandInLoraOptions): GgufWriteSpec {
  const architecture = metadataString(base, 'general.architecture');
  if (!architecture) throw new Error('The base model does not name its architecture.');
  const rank = options.rank ?? 4;
  if (!Number.isInteger(rank) || rank < 1) throw new Error('The rank must be a positive integer.');
  const alpha = options.alpha ?? rank;
  const amplitude = options.amplitude ?? 0.01;

  const targets = base.tensors
    .map((tensor) => ({ tensor, ...weightParts(tensor.name) }))
    .filter(
      (entry) =>
        entry.block !== null &&
        options.modules.includes(entry.module) &&
        entry.tensor.dims.length === 2,
    )
    .sort((x, y) => (x.block ?? 0) - (y.block ?? 0) || x.module.localeCompare(y.module));
  for (const module of options.modules) {
    if (!targets.some((entry) => entry.module === module)) {
      throw new Error(`The base model has no ${module} weights to adapt.`);
    }
  }

  const tensors: GgufTensorSource[] = [];
  targets.forEach((entry, index) => {
    const [inputs = 0, outputs = 0] = entry.tensor.dims;
    const fill = (length: number, salt: number, zero: boolean) => () => {
      const values = new Float32Array(length);
      if (!zero) {
        const next = generator((options.seed ?? 1) * 7919 + index * 2 + salt);
        for (let at = 0; at < length; at++) values[at] = (next() * 2 - 1) * amplitude;
      }
      return float32Bytes(values);
    };
    tensors.push({
      name: `${entry.tensor.name}.lora_a`,
      dims: [inputs, rank],
      type: 'F32',
      bytes: fill(inputs * rank, 0, false),
    });
    tensors.push({
      name: `${entry.tensor.name}.lora_b`,
      dims: [rank, outputs],
      type: 'F32',
      bytes: fill(rank * outputs, 1, options.effect === 'none'),
    });
  });

  return {
    metadata: [
      ['general.architecture', { type: 'string', value: architecture }],
      ['general.type', { type: 'string', value: 'adapter' }],
      ['general.name', { type: 'string', value: STAND_IN_ADAPTER_NAME }],
      ['adapter.type', { type: 'string', value: 'lora' }],
      ['adapter.lora.alpha', { type: 'float32', value: alpha }],
      [ADAPTER_KIND_KEY, { type: 'string', value: STAND_IN_ADAPTER_KIND }],
      [
        'architect.adapter.effect',
        { type: 'string', value: options.effect === 'none' ? 'none' : 'perturb' },
      ],
    ],
    tensors,
  };
}
