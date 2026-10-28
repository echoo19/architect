import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  bufferSource,
  checkLoraAgainstBase,
  encodeGguf,
  float32Bytes,
  GgufError,
  inspectLoraAdapter,
  metadataNumber,
  metadataString,
  parseGgufHeader,
  readGgufHeader,
  readTensorBytes,
  standInLoraSpec,
  writeGgufFile,
  type GgufHeader,
  type GgufTensorInfo,
  type GgufValue,
  type GgufWriteSpec,
} from '../src/gguf';
import { GLIMMER_BLOCK_SHAPES, tinyBaseSpec } from './support/gguf';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'architect-gguf-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const parse = (bytes: Uint8Array, maxArrayItems?: number) =>
  parseGgufHeader(bufferSource(bytes), maxArrayItems === undefined ? {} : { maxArrayItems });

function writeFile(name: string, spec: GgufWriteSpec): string {
  const path = join(dir, name);
  writeGgufFile(path, spec);
  return path;
}

const everyKind: ReadonlyArray<readonly [string, GgufValue]> = [
  ['test.u8', { type: 'uint8', value: 250 }],
  ['test.i8', { type: 'int8', value: -7 }],
  ['test.u16', { type: 'uint16', value: 65_000 }],
  ['test.i16', { type: 'int16', value: -30_000 }],
  ['test.u32', { type: 'uint32', value: 4_000_000_000 }],
  ['test.i32', { type: 'int32', value: -2_000_000_000 }],
  ['test.f32', { type: 'float32', value: 0.5 }],
  ['test.f64', { type: 'float64', value: Math.PI }],
  ['test.u64', { type: 'uint64', value: 2n ** 60n }],
  ['test.i64', { type: 'int64', value: -(2n ** 40n) }],
  ['test.bool', { type: 'bool', value: true }],
  ['test.string', { type: 'string', value: 'Glimmer, ünïcode and all' }],
  [
    'test.ints',
    {
      type: 'array',
      itemType: 'int32',
      length: 3,
      items: [
        { type: 'int32', value: 1 },
        { type: 'int32', value: -2 },
        { type: 'int32', value: 3 },
      ],
    },
  ],
];

describe('GGUF round trip', () => {
  it('reads back every kind of metadata and every tensor it wrote', () => {
    const f32 = new Float32Array([1.5, -2, 3.25, 0]);
    const f16 = Uint8Array.from([0, 60, 0, 192]); // 1.0 and -2.0 in half precision
    const q80 = new Uint8Array(34 * 2).fill(7); // two Q8_0 blocks of 32
    const spec: GgufWriteSpec = {
      metadata: everyKind,
      tensors: [
        { name: 'a.weight', dims: [2, 2], type: 'F32', bytes: () => float32Bytes(f32) },
        { name: 'b.weight', dims: [2], type: 'F16', bytes: () => f16 },
        { name: 'c.weight', dims: [32, 2], type: 'Q8_0', bytes: () => q80 },
      ],
    };
    const path = writeFile('model.gguf', spec);
    const header = readGgufHeader(path);

    expect(header.version).toBe(3);
    expect(header.alignment).toBe(32);
    expect([...header.metadata.entries()]).toEqual(everyKind);
    expect(
      header.tensors.map(({ name, dims, typeName, bytes }) => ({ name, dims, typeName, bytes })),
    ).toEqual([
      { name: 'a.weight', dims: [2, 2], typeName: 'F32', bytes: 16 },
      { name: 'b.weight', dims: [2], typeName: 'F16', bytes: 4 },
      { name: 'c.weight', dims: [32, 2], typeName: 'Q8_0', bytes: 68 },
    ]);
    for (const tensor of header.tensors) expect(tensor.offset % 32).toBe(0);
    expect(
      new Float32Array(Uint8Array.from(readTensorBytes(path, header, 'a.weight')).buffer),
    ).toEqual(f32);
    expect([...readTensorBytes(path, header, 'b.weight')]).toEqual([...f16]);
    expect([...readTensorBytes(path, header, 'c.weight')]).toEqual([...q80]);
    expect(readFileSync(path)).toEqual(encodeGguf(spec));
    expect(readdirSync(dir)).toEqual(['model.gguf']);
  });

  it('keeps only the first items of a long array and still finds every tensor after it', () => {
    const bytes = encodeGguf(tinyBaseSpec({ blocks: 2, vocabulary: 5000 }));
    const header = parse(bytes, 3);
    const tokens = header.metadata.get('tokenizer.ggml.tokens');
    expect(tokens).toMatchObject({ type: 'array', itemType: 'string', length: 5000 });
    expect(
      tokens?.type === 'array'
        ? tokens.items.map((item) => (item.type === 'string' ? item.value : null))
        : [],
    ).toEqual(['token-0', 'token-1', 'token-2']);
    expect(header.tensors).toHaveLength(1 + 2 * 9);
    expect(header.tensors.at(-1)?.name).toBe('blk.1.ffn_down.weight');
    expect(metadataNumber(header, 'muse-glimmer.block_count')).toBe(2);
  });

  it('writes a different alignment into the header and aligns every tensor to it', () => {
    const spec: GgufWriteSpec = {
      alignment: 64,
      metadata: [['general.architecture', { type: 'string', value: 'muse-glimmer' }]],
      tensors: [
        { name: 'x', dims: [3], type: 'F32', bytes: () => float32Bytes(new Float32Array(3)) },
        { name: 'y', dims: [5], type: 'F32', bytes: () => float32Bytes(new Float32Array(5)) },
      ],
    };
    const header = parse(encodeGguf(spec));
    expect(header.alignment).toBe(64);
    expect(header.metadata.get('general.alignment')).toEqual({ type: 'uint32', value: 64 });
    expect(header.tensors.map((tensor) => tensor.offset)).toEqual([0, 64]);
    expect(header.dataOffset % 64).toBe(0);
  });

  it('refuses tensor bytes that do not match the shape', () => {
    const spec: GgufWriteSpec = {
      metadata: [],
      tensors: [{ name: 'x', dims: [4], type: 'F32', bytes: () => new Uint8Array(12) }],
    };
    expect(() => writeFile('bad.gguf', spec)).toThrow(/has 12 bytes; its shape and type need 16/);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('GGUF headers that are wrong', () => {
  const good = encodeGguf(tinyBaseSpec({ blocks: 1, vocabulary: 10 }));

  it('names what is wrong instead of reading garbage', () => {
    const notGguf = Buffer.from(good);
    notGguf.write('GGML', 0, 'latin1');
    expect(() => parse(notGguf)).toThrow(new GgufError('The file is not a GGUF file.'));

    const old = Buffer.from(good);
    old.writeUInt32LE(1, 4);
    expect(() => parse(old)).toThrow(/version 1/);

    expect(() => parse(good.subarray(0, 200))).toThrow(/ends inside its header/);

    const header = parse(good);
    const lastTensor = header.tensors.at(-1) as GgufTensorInfo;
    const cut = good.subarray(0, header.dataOffset + lastTensor.offset + 8);
    expect(() => parse(cut)).toThrow(/runs past the end of the file/);
  });

  it('refuses a key given twice', () => {
    const twice = encodeGguf({
      metadata: [
        ['general.name', { type: 'string', value: 'one' }],
        ['general.nam_', { type: 'string', value: 'two' }],
      ],
      tensors: [],
    });
    // Same length, so the second key can be renamed in place to collide with the first.
    const index = twice.indexOf('general.nam_');
    twice.write('general.name', index, 'latin1');
    expect(() => parse(twice)).toThrow(/general.name appears twice/);
  });
});

function adapterOn(
  base: GgufHeader,
  overrides: Partial<Parameters<typeof standInLoraSpec>[1]> = {},
) {
  return standInLoraSpec(base, {
    modules: ['attn_q', 'ffn_down'],
    rank: 4,
    effect: 'none',
    ...overrides,
  });
}

describe('LoRA adapters', () => {
  const base = parse(encodeGguf(tinyBaseSpec({ blocks: 3 })));

  it('builds a labeled stand-in that fits its base model', () => {
    const path = writeFile('stand-in.gguf', adapterOn(base, { alpha: 8 }));
    const adapter = readGgufHeader(path);
    const check = checkLoraAgainstBase(adapter, base, { rank: 4, alpha: 8 });

    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(check.summary).toEqual({
      architecture: 'muse-glimmer',
      alpha: 8,
      ranks: [4],
      pairs: 6,
      modules: ['attn_q', 'ffn_down'],
      blocks: 3,
      tensorTypes: ['F32'],
      standIn: true,
    });
    expect(metadataString(adapter, 'general.name')).toBe(
      'Architect stand-in adapter (not trained)',
    );
    expect(
      adapter.tensors.find((tensor) => tensor.name === 'blk.2.ffn_down.weight.lora_a')?.dims,
    ).toEqual([96, 4]);
    expect(
      adapter.tensors.find((tensor) => tensor.name === 'blk.2.ffn_down.weight.lora_b')?.dims,
    ).toEqual([4, 64]);
  });

  it('writes a no-op stand-in with zero lora_b, and a perturbing one the same way every time', () => {
    const noop = writeFile('noop.gguf', adapterOn(base, { effect: 'none' }));
    const noopHeader = readGgufHeader(noop);
    const b = readTensorBytes(noop, noopHeader, 'blk.0.attn_q.weight.lora_b');
    expect(b.every((byte) => byte === 0)).toBe(true);
    expect(
      readTensorBytes(noop, noopHeader, 'blk.0.attn_q.weight.lora_a').some((byte) => byte !== 0),
    ).toBe(true);

    const first = encodeGguf(adapterOn(base, { effect: 'perturb', seed: 3 }));
    const second = encodeGguf(adapterOn(base, { effect: 'perturb', seed: 3 }));
    const other = encodeGguf(adapterOn(base, { effect: 'perturb', seed: 4 }));
    expect(first.equals(second)).toBe(true);
    expect(first.equals(other)).toBe(false);
    const perturbed = parse(first);
    const lora = perturbed.tensors.find((tensor) => tensor.name === 'blk.0.attn_q.weight.lora_b');
    const start = perturbed.dataOffset + (lora?.offset ?? 0);
    const values = new Float32Array(
      first.buffer.slice(first.byteOffset + start, first.byteOffset + start + 16),
    );
    expect(values.some((value) => value !== 0)).toBe(true);
    expect(values.every((value) => Math.abs(value) <= 0.01)).toBe(true);
  });

  it('refuses an adapter llama.cpp would refuse, saying why', () => {
    const otherArch = parse(
      encodeGguf(adapterOn(parse(encodeGguf(tinyBaseSpec({ architecture: 'llama' }))))),
    );
    expect(checkLoraAgainstBase(otherArch, base).problems).toContain(
      'The adapter is for llama, but the base model is muse-glimmer.',
    );

    const bigger = parse(encodeGguf(tinyBaseSpec({ blocks: 4 })));
    const tooManyBlocks = parse(encodeGguf(adapterOn(bigger)));
    expect(checkLoraAgainstBase(tooManyBlocks, base).problems).toEqual([
      'The base model has no blk.3.attn_q.weight.',
      'The base model has no blk.3.ffn_down.weight.',
    ]);

    const wrongRank = checkLoraAgainstBase(parse(encodeGguf(adapterOn(base, { rank: 2 }))), base, {
      rank: 4,
    });
    expect(wrongRank.ok).toBe(false);
    expect(wrongRank.problems[0]).toBe('blk.0.attn_q.weight has rank 2, not the expected 4.');
  });

  it('catches shapes, halves, types and labels that do not add up', () => {
    const a = (name: string, dims: number[], type = 'F32') => ({
      name,
      dims,
      type,
      bytes: () => new Uint8Array(dims.reduce((x, y) => x * y, 1) * (type === 'F16' ? 2 : 4)),
    });
    const spec: GgufWriteSpec = {
      metadata: [
        ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
        ['general.type', { type: 'string', value: 'model' }],
        ['adapter.lora.alpha', { type: 'float32', value: 4 }],
      ],
      tensors: [
        a('blk.0.attn_q.weight.lora_a', [64, 4]),
        a('blk.0.attn_q.weight.lora_b', [4, 33]),
        a('blk.0.attn_k.weight.lora_a', [64, 4]),
        a('blk.0.attn_v.weight.lora_a', [64, 4]),
        a('blk.0.attn_v.weight.lora_b', [2, 8]),
        a('token_embd.weight.lora_a', [4, 100]),
        a('token_embd.weight.lora_b', [4, 64]),
        a('blk.0.attn_norm.weight', [64]),
      ],
    };
    const check = checkLoraAgainstBase(parse(encodeGguf(spec)), base);
    expect(check.ok).toBe(false);
    expect(check.problems).toEqual([
      'general.type is model; an adapter says "adapter".',
      'adapter.type is missing; a LoRA says "lora".',
      'blk.0.attn_norm.weight is not a lora_a or lora_b tensor.',
      'blk.0.attn_k.weight has lora_a without lora_b.',
      'blk.0.attn_v.weight: lora_a has rank 4 and lora_b has rank 2.',
      'Adapters on the token embeddings are not supported.',
      "blk.0.attn_q.weight is [64, 32] in the base model, but the adapter's pair fits [64, 33].",
    ]);

    const quantized = parse(
      encodeGguf({
        metadata: [
          ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
          ['general.type', { type: 'string', value: 'adapter' }],
          ['adapter.type', { type: 'string', value: 'lora' }],
          ['adapter.lora.alpha', { type: 'float32', value: 4 }],
        ],
        tensors: [
          {
            name: 'blk.0.attn_q.weight.lora_a',
            dims: [256, 4],
            type: 'Q4_K',
            bytes: () => new Uint8Array(144 * 4),
          },
          a('blk.0.attn_q.weight.lora_b', [4, 32]),
        ],
      }),
    );
    expect(inspectLoraAdapter(quantized).problems).toEqual([
      "blk.0.attn_q.weight.lora_a has type Q4_K, which an adapter can't use.",
    ]);
  });

  it("fits Glimmer's real weight shapes, as llama.cpp loaded the probe adapter", () => {
    // Glimmer's base header as the GGUF describes it: 52 blocks, tensor descriptions only.
    const tensors: GgufTensorInfo[] = [];
    for (let block = 0; block < 52; block++) {
      for (const [module, dims] of Object.entries(GLIMMER_BLOCK_SHAPES)) {
        tensors.push({
          name: `blk.${block}.${module}.weight`,
          dims: [...dims],
          typeId: 16,
          typeName: 'IQ2_XXS',
          offset: 0,
          bytes: null,
        });
      }
    }
    const glimmer: GgufHeader = {
      version: 3,
      alignment: 32,
      metadata: new Map([['general.architecture', { type: 'string', value: 'muse-glimmer' }]]),
      tensors,
      dataOffset: 0,
      fileSize: 0,
    };
    const adapter = parse(
      encodeGguf(
        standInLoraSpec(glimmer, {
          modules: ['attn_q', 'attn_k', 'attn_gate', 'ffn_down'],
          rank: 2,
          effect: 'none',
        }),
      ),
    );
    const check = checkLoraAgainstBase(adapter, glimmer, { rank: 2 });
    expect(check.problems).toEqual([]);
    expect(check.summary).toMatchObject({ pairs: 52 * 4, blocks: 52 });
    const shape = (name: string) => adapter.tensors.find((tensor) => tensor.name === name)?.dims;
    expect(shape('blk.0.attn_q.weight.lora_a')).toEqual([6656, 2]);
    expect(shape('blk.0.attn_q.weight.lora_b')).toEqual([2, 4096]);
    expect(shape('blk.51.attn_k.weight.lora_b')).toEqual([2, 256]);
    expect(shape('blk.7.ffn_down.weight.lora_a')).toEqual([19968, 2]);
    expect(shape('blk.7.ffn_down.weight.lora_b')).toEqual([2, 6656]);
  });

  it('refuses to build a stand-in for weights the base model lacks', () => {
    expect(() => standInLoraSpec(base, { modules: ['attn_qkv'], effect: 'none' })).toThrow(
      'The base model has no attn_qkv weights to adapt.',
    );
  });

  it('reads an adapter file written by another tool', () => {
    // The layout llama.cpp's converter writes: metadata first, then F16 pairs.
    const spec: GgufWriteSpec = {
      metadata: [
        ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
        ['general.type', { type: 'string', value: 'adapter' }],
        ['general.name', { type: 'string', value: 'Converted' }],
        ['adapter.type', { type: 'string', value: 'lora' }],
        ['adapter.lora.alpha', { type: 'float32', value: 32 }],
      ],
      tensors: [
        {
          name: 'blk.1.attn_v.weight.lora_a',
          dims: [64, 16],
          type: 'F16',
          bytes: () => new Uint8Array(64 * 16 * 2),
        },
        {
          name: 'blk.1.attn_v.weight.lora_b',
          dims: [16, 8],
          type: 'F16',
          bytes: () => new Uint8Array(16 * 8 * 2),
        },
      ],
    };
    const path = join(dir, 'converted.gguf');
    writeFileSync(path, encodeGguf(spec));
    const check = checkLoraAgainstBase(readGgufHeader(path), base, { rank: 16, alpha: 32 });
    expect(check).toMatchObject({ ok: true, summary: { standIn: false, tensorTypes: ['F16'] } });
  });
});
