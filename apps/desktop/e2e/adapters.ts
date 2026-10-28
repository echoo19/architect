import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  bufferSource,
  encodeGguf,
  float32Bytes,
  parseGgufHeader,
  standInLoraSpec,
  type GgufHeader,
} from '@architect/engine';
import { readPackage, sha256Bytes, writePackage, type PackageEntry } from '@architect/harness';

/*
 * What a graduate with an adapter needs on a test computer, with no model anywhere: a tiny base
 * in a folder laid out like Ollama's store, a stand-in LoRA trained on it, and the stand-in
 * llama-server the engine's tests use, which answers with the adapter scales it was sent.
 */

/** The stand-in llama-server: llama-server's flags, health check, key and adapter list, no model. */
const FAKE_LLAMA_SERVER = fileURLToPath(
  new URL('../../../packages/engine/test/fixtures/fake-llama-server.ts', import.meta.url),
);

/** The base's name in the store, as installations here bind it. */
export const BASE_NAME = 'muse-glimmer:30b';

/**
 * The value of ARCHITECT_LLAMA_SERVER_COMMAND that runs the stand-in, recording into `record`.
 * Node runs it with tsx, named by its full address so it loads from any working folder.
 */
export function standInCommand(record: string): string {
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  return JSON.stringify({
    file: process.execPath,
    args: ['--import', tsx, FAKE_LLAMA_SERVER, '--fake-record', record],
  });
}

export interface Recorded {
  kind: 'start' | 'chat';
  /** The stand-in's own process, for a start. */
  pid?: number;
  argv?: string[];
  body?: Record<string, unknown>;
}

/** What the stand-in recorded: each start, with its flags, and each chat request. */
export function recorded(record: string): Recorded[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Recorded);
}

export function flag(argv: readonly string[] | undefined, name: string): string | undefined {
  const index = argv?.indexOf(name) ?? -1;
  return index === -1 ? undefined : argv?.[index + 1];
}

/** The base's weights in the store: their digest as Ollama names it, and their header. */
export interface StoredBase {
  digest: string;
  header: GgufHeader;
}

/** A base of one block with Glimmer's names: small enough to write in a test, real GGUF. */
function tinyBase(): Uint8Array {
  const zeros = (length: number) => () => float32Bytes(new Float32Array(length));
  return encodeGguf({
    metadata: [
      ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
      ['general.type', { type: 'string', value: 'model' }],
      ['muse-glimmer.block_count', { type: 'uint32', value: 1 }],
      ['muse-glimmer.embedding_length', { type: 'uint32', value: 16 }],
    ],
    tensors: [
      { name: 'token_embd.weight', dims: [16, 32], type: 'F32', bytes: zeros(512) },
      { name: 'blk.0.attn_q.weight', dims: [16, 8], type: 'F32', bytes: zeros(128) },
    ],
  });
}

/** Writes the base into `modelsDir` the way Ollama 0.40 lays out its store. */
export async function storeBase(modelsDir: string): Promise<StoredBase> {
  const weights = tinyBase();
  const hex = createHash('sha256').update(weights).digest('hex');
  await mkdir(join(modelsDir, 'blobs'), { recursive: true });
  await writeFile(join(modelsDir, 'blobs', `sha256-${hex}`), weights);
  const [model, tag] = BASE_NAME.split(':') as [string, string];
  const manifests = join(modelsDir, 'manifests-v2', 'ollama.com', 'library', model);
  await mkdir(manifests, { recursive: true });
  const manifest = {
    schemaVersion: 2,
    layers: [
      {
        mediaType: 'application/vnd.ollama.image.model',
        digest: `sha256:${hex}`,
        size: weights.byteLength,
      },
    ],
    format: 'gguf',
  };
  await writeFile(join(manifests, tag), JSON.stringify(manifest));
  return { digest: `sha256:${hex}`, header: parseGgufHeader(bufferSource(weights)) };
}

/**
 * Repackages the graduate in `source` as agent `id` carrying a stand-in LoRA trained on `base`,
 * for llama.cpp to serve on that base from Ollama's store, and writes it to `folder`.
 */
export async function withAdapter(
  source: string,
  folder: string,
  id: string,
  base: StoredBase,
): Promise<void> {
  const { manifest } = await readPackage(source);
  const adapter = encodeGguf(
    standInLoraSpec(base.header, { modules: ['attn_q'], effect: 'perturb' }),
  );
  const entries: PackageEntry[] = [
    ...manifest.integrity.files.map((file) => ({
      path: file.path,
      source: join(source, ...file.path.split('/')),
    })),
    { path: 'adapter/adapter.gguf', content: adapter },
  ];
  const { integrity: _integrity, ...draft } = manifest;
  await writePackage(
    folder,
    {
      ...draft,
      identity: { ...draft.identity, agentId: id },
      model: {
        ...draft.model,
        base: { ...draft.model.base, name: BASE_NAME },
        adapter: {
          path: 'adapter/adapter.gguf',
          format: 'gguf_lora',
          sha256: sha256Bytes(adapter),
          sizeBytes: adapter.byteLength,
          baseDigest: base.digest,
          scale: 1,
          standIn: true,
        },
        runtime: { compatible: ['llama.cpp'] },
      },
      requirements: {
        ...draft.requirements,
        limitations: [
          ...draft.requirements.limitations,
          'Its adapter came from the stand-in training backend: it was built, not trained, and changes nothing.',
        ],
      },
    },
    entries,
  );
}
