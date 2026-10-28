import { float32Bytes, type GgufTensorSource, type GgufWriteSpec } from '../../src/gguf';

/** Muse Glimmer's real layout per block, in ggml order ([n_in, n_out]), from its GGUF. */
export const GLIMMER_BLOCK_SHAPES = {
  attn_q: [6656, 4096],
  attn_k: [6656, 256],
  attn_v: [6656, 256],
  attn_output: [4096, 6656],
  attn_gate: [6656, 4096],
  ffn_gate: [6656, 19968],
  ffn_up: [6656, 19968],
  ffn_down: [19968, 6656],
} as const;

export interface TinyBaseOptions {
  blocks?: number;
  architecture?: string;
  /** Vocabulary strings, to make the header carry a long array the reader has to skip. */
  vocabulary?: number;
}

const zeros = (length: number) => () => float32Bytes(new Float32Array(length));

/**
 * A base model with Glimmer's tensor names and shape pattern, shrunk so a test can write it in a
 * few kilobytes: embedding 64, attention 32, key and value 8, feed-forward 96.
 */
export function tinyBaseSpec(options: TinyBaseOptions = {}): GgufWriteSpec {
  const architecture = options.architecture ?? 'muse-glimmer';
  const blocks = options.blocks ?? 2;
  const shapes: Record<string, [number, number]> = {
    attn_q: [64, 32],
    attn_k: [64, 8],
    attn_v: [64, 8],
    attn_output: [32, 64],
    attn_gate: [64, 32],
    ffn_gate: [64, 96],
    ffn_up: [64, 96],
    ffn_down: [96, 64],
  };
  const tensors: GgufTensorSource[] = [
    { name: 'token_embd.weight', dims: [64, 100], type: 'F32', bytes: zeros(6400) },
  ];
  for (let block = 0; block < blocks; block++) {
    tensors.push({
      name: `blk.${block}.attn_norm.weight`,
      dims: [64],
      type: 'F32',
      bytes: zeros(64),
    });
    for (const [module, [inputs, outputs]] of Object.entries(shapes)) {
      tensors.push({
        name: `blk.${block}.${module}.weight`,
        dims: [inputs, outputs],
        type: 'F32',
        bytes: zeros(inputs * outputs),
      });
    }
  }
  const vocabulary = options.vocabulary ?? 300;
  return {
    metadata: [
      ['general.architecture', { type: 'string', value: architecture }],
      ['general.type', { type: 'string', value: 'model' }],
      ['general.name', { type: 'string', value: 'Tiny test base' }],
      [`${architecture}.block_count`, { type: 'uint32', value: blocks }],
      [`${architecture}.embedding_length`, { type: 'uint32', value: 64 }],
      [
        'tokenizer.ggml.tokens',
        {
          type: 'array',
          itemType: 'string',
          length: vocabulary,
          items: Array.from({ length: vocabulary }, (_, index) => ({
            type: 'string' as const,
            value: `token-${index}`,
          })),
        },
      ],
    ],
    tensors,
  };
}
