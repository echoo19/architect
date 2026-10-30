import type { ModelConfig, ModelSize } from '@architect/shared';

/** A configuration the sizing can't count, with what it lacks or doesn't understand. */
export class SizingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SizingError';
  }
}

/** Architectures whose layers aren't attention plus an MLP or experts, which this count assumes. */
const UNSUPPORTED_TYPES = /mamba|rwkv|jamba|zamba|falcon_h1|nemotron_h|xlstm|recurrent|t5|bart/i;
const ATTENTION_LAYER_TYPES = new Set(['full_attention', 'sliding_attention', 'chunked_attention']);

type Matrix = readonly [inputs: number, outputs: number];

const paramsOf = (matrices: readonly Matrix[]) =>
  matrices.reduce((sum, [inputs, outputs]) => sum + inputs * outputs, 0);
/** LoRA at rank 1 adds A (inputs x 1) and B (1 x outputs) to each matrix. */
const loraOf = (matrices: readonly Matrix[]) =>
  matrices.reduce((sum, [inputs, outputs]) => sum + inputs + outputs, 0);
/** A gated MLP (SwiGLU): gate and up from the hidden size, down back to it. */
const gatedMlp = (hidden: number, width: number): Matrix[] => [
  [hidden, width],
  [hidden, width],
  [width, hidden],
];

class Fields {
  constructor(
    private readonly config: ModelConfig,
    private readonly where: string,
  ) {}

  /** The first of `names` the configuration sets, checked to be a whole number at least 0. */
  number(...names: string[]): number | undefined {
    for (const name of names) {
      const value = this.config[name];
      if (value === undefined || value === null) continue;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
        throw new SizingError(`${this.where}${name} is ${JSON.stringify(value)}, not a count.`);
      }
      return value;
    }
    return undefined;
  }

  required(what: string, ...names: string[]): number {
    const value = this.number(...names);
    if (value === undefined || value === 0) {
      throw new SizingError(
        `The configuration doesn't say its ${what} (looked for ${names.join(', ')}), so it can't be sized.`,
      );
    }
    return value;
  }

  boolean(name: string): boolean | undefined {
    const value = this.config[name];
    return typeof value === 'boolean' ? value : undefined;
  }

  string(name: string): string | undefined {
    const value = this.config[name];
    return typeof value === 'string' ? value : undefined;
  }

  numbers(name: string): number[] {
    const value = this.config[name];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'number') : [];
  }

  strings(name: string): string[] {
    const value = this.config[name];
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
  }
}

function isObject(value: unknown): value is ModelConfig {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Counts a decoder-only transformer's parameters from its Hugging Face `config.json`: dense
 * models, mixtures of experts (routed and shared experts, and which layers hold them), grouped and
 * multi-head latent attention, tied or untied embeddings. A multimodal config is counted by its
 * text decoder. A configuration it doesn't understand is refused with what is missing, never
 * guessed at.
 */
export function sizeModel(config: ModelConfig): ModelSize {
  const notes: string[] = [];
  const top = new Fields(config, '');
  const nested = config['text_config'];
  const decoder = isObject(nested) ? nested : config;
  if (decoder !== config) {
    notes.push(
      'Only the text decoder (text_config) is counted; a vision or audio tower adds to the resident weights.',
    );
  }
  const f = new Fields(decoder, decoder === config ? '' : 'text_config.');
  const modelType = f.string('model_type') ?? top.string('model_type') ?? 'unknown';
  if (UNSUPPORTED_TYPES.test(modelType) || top.boolean('is_encoder_decoder') === true) {
    throw new SizingError(
      `A ${modelType} model isn't a decoder made of attention and MLP or expert layers, so it can't be sized here.`,
    );
  }
  const otherLayers = f.strings('layer_types').filter((kind) => !ATTENTION_LAYER_TYPES.has(kind));
  if (otherLayers.length > 0) {
    throw new SizingError(
      `Its layers include ${[...new Set(otherLayers)].join(', ')}, which this sizing doesn't count.`,
    );
  }

  const hidden = f.required('hidden size', 'hidden_size', 'd_model', 'n_embd');
  const layers = f.required('layer count', 'num_hidden_layers', 'n_layer', 'num_layers');
  const heads = f.required('attention heads', 'num_attention_heads', 'n_head');
  const vocab = f.required('vocabulary size', 'vocab_size');
  const kvHeads = f.number('num_key_value_heads', 'num_kv_heads') ?? heads;
  const headDim = f.number('head_dim') ?? Math.floor(hidden / heads);

  // Attention: grouped-query, or DeepSeek's multi-head latent attention.
  let attention: Matrix[];
  const kvLora = f.number('kv_lora_rank');
  if (kvLora !== undefined) {
    const nope = f.required('no-position head size', 'qk_nope_head_dim');
    const rope = f.required('rotary head size', 'qk_rope_head_dim');
    const value = f.required('value head size', 'v_head_dim');
    const qLora = f.number('q_lora_rank');
    attention = [
      ...(qLora
        ? ([
            [hidden, qLora],
            [qLora, heads * (nope + rope)],
          ] as Matrix[])
        : ([[hidden, heads * (nope + rope)]] as Matrix[])),
      [hidden, kvLora + rope],
      [kvLora, heads * (nope + value)],
      [heads * value, hidden],
    ];
    notes.push('Attention is multi-head latent attention (kv_lora_rank).');
  } else {
    attention = [
      [hidden, heads * headDim],
      [hidden, kvHeads * headDim],
      [hidden, kvHeads * headDim],
      [heads * headDim, hidden],
    ];
  }

  // Experts, and which layers hold them.
  const experts = f.number('num_local_experts', 'num_experts', 'n_routed_experts') ?? 0;
  const perToken =
    experts > 0
      ? f.required(
          'experts per token',
          'num_experts_per_tok',
          'experts_per_token',
          'num_experts_per_token',
          'moe_topk',
        )
      : 0;
  const expertWidth =
    experts > 0 ? f.required('expert width', 'moe_intermediate_size', 'intermediate_size') : 0;
  let sharedWidth = 0;
  const sharedCount = f.number('n_shared_experts', 'num_shared_experts');
  if (experts > 0 && sharedCount) sharedWidth = sharedCount * expertWidth;
  else if (experts > 0 && f.number('shared_expert_intermediate_size')) {
    sharedWidth = f.number('shared_expert_intermediate_size') ?? 0;
  } else if (experts > 0 && modelType.startsWith('llama4')) sharedWidth = expertWidth;

  const firstDense = f.number('first_k_dense_replace') ?? 0;
  const frequency = f.number('moe_layer_freq') ?? 1;
  const sparseStep = f.number('decoder_sparse_step', 'interleave_moe_layer_step');
  const mlpOnly = new Set(f.numbers('mlp_only_layers'));
  const listed = f.numbers('moe_layers');
  const isMoe = (layer: number): boolean => {
    if (experts === 0 || mlpOnly.has(layer) || layer < firstDense) return false;
    if (listed.length > 0) return listed.includes(layer);
    if (sparseStep) return (layer + 1) % sparseStep === 0;
    return layer % frequency === 0;
  };
  const moeLayers = Array.from({ length: layers }, (_, layer) => isMoe(layer)).filter(
    Boolean,
  ).length;
  const denseLayers = layers - moeLayers;
  const denseWidth =
    denseLayers > 0
      ? f.required('MLP width', 'intermediate_size_mlp', 'intermediate_size', 'n_inner', 'ffn_dim')
      : 0;
  const patternParts: string[] = [];
  if (experts > 0) {
    if (firstDense) patternParts.push(`first ${firstDense} dense (first_k_dense_replace)`);
    if (listed.length > 0) patternParts.push('layers listed in moe_layers');
    else if (sparseStep) patternParts.push(`every ${sparseStep} layers (sparse step)`);
    else if (frequency > 1) patternParts.push(`every ${frequency} layers (moe_layer_freq)`);
    if (mlpOnly.size > 0) patternParts.push(`${mlpOnly.size} listed in mlp_only_layers`);
  }
  const moePattern =
    experts === 0
      ? 'dense: no experts'
      : `${moeLayers} of ${layers} layers hold experts${patternParts.length ? `: ${patternParts.join(', ')}` : ''}`;

  // Parameters per layer kind, all experts included: every one of them is resident.
  const norms = 2 * hidden;
  const attentionParams = paramsOf(attention);
  const expertMatrices = gatedMlp(hidden, expertWidth);
  const sharedMatrices = sharedWidth > 0 ? gatedMlp(hidden, sharedWidth) : [];
  const router = hidden * experts;
  const moeLayer =
    attentionParams +
    experts * paramsOf(expertMatrices) +
    paramsOf(sharedMatrices) +
    router +
    norms;
  const denseLayer = attentionParams + paramsOf(gatedMlp(hidden, denseWidth)) + norms;
  const embedding = vocab * hidden;
  const tied = top.boolean('tie_word_embeddings') ?? f.boolean('tie_word_embeddings');
  if (tied === undefined) {
    notes.push("tie_word_embeddings isn't set, so the output head is counted as its own weights.");
  }
  const head = tied === true ? 0 : embedding;
  const totalParams = moeLayers * moeLayer + denseLayers * denseLayer + embedding + head + hidden;
  const linearParams = moeLayers * (moeLayer - norms) + denseLayers * (denseLayer - norms);
  const activeMoeLayer =
    attentionParams +
    perToken * paramsOf(expertMatrices) +
    paramsOf(sharedMatrices) +
    router +
    norms;
  const activeParams =
    moeLayers * activeMoeLayer + denseLayers * denseLayer + embedding + head + hidden;

  const units = [
    ...(moeLayers > 0
      ? [
          {
            name: `one expert layer (attention, all ${experts} experts${sharedWidth ? ', the shared expert' : ''} and the router)`,
            params: moeLayer,
          },
        ]
      : []),
    ...(denseLayers > 0 ? [{ name: 'one dense decoder layer', params: denseLayer }] : []),
    { name: 'the embedding table', params: embedding },
  ];
  const largestUnit = units.reduce((largest, unit) =>
    unit.params > largest.params ? unit : largest,
  );

  const loraParamsPerRank =
    layers * loraOf(attention) +
    moeLayers * (experts * loraOf(expertMatrices) + loraOf(sharedMatrices)) +
    denseLayers * loraOf(gatedMlp(hidden, denseWidth));

  notes.push(
    'Biases and small per-head norms are left out; MLPs are counted as gated (gate, up, down).',
  );
  return {
    architecture: modelType,
    totalParams,
    activeParams,
    linearParams,
    layers,
    hiddenSize: hidden,
    vocabSize: vocab,
    activeMlpWidth: Math.max(
      moeLayers > 0 ? perToken * expertWidth + sharedWidth : 0,
      denseLayers > 0 ? denseWidth : 0,
    ),
    moeLayers,
    experts,
    expertsPerToken: perToken,
    moePattern,
    largestUnit,
    loraParamsPerRank,
    notes,
  };
}
