import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bufferSource,
  encodeGguf,
  parseGgufHeader,
  standInLoraSpec,
  type GgufHeader,
} from '../../src/gguf';
import type { ServerCommand } from '../../src/local-runtime';
import { tinyBaseSpec } from './gguf';
import { writeOllamaStore } from './ollama-store';

/** The stand-in llama-server: the real flags, health check, key check and adapter list, no model. */
export const FAKE_LLAMA_SERVER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'fake-llama-server.ts',
);

/**
 * Runs the stand-in llama-server, which appends what it was started with and every chat request
 * to `record`. `flags` are its own: `--fake-build 9000` says an old build, `--fake-mode` a failure.
 */
export function fakeLlamaCommand(record: string, ...flags: string[]): ServerCommand {
  return {
    file: process.execPath,
    args: ['--import', 'tsx', FAKE_LLAMA_SERVER, '--fake-record', record, ...flags],
  };
}

export interface Recorded {
  kind: 'start' | 'chat';
  pid?: number;
  argv?: string[];
  body?: Record<string, unknown>;
  /** At a start: stand-ins started earlier on the same record that were still running. */
  alongside?: number[];
}

/** What the stand-in recorded, in order. */
export function recorded(record: string): Recorded[] {
  if (!existsSync(record)) return [];
  return readFileSync(record, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Recorded);
}

/** The value after `name` in a recorded command line. */
export function flag(argv: readonly string[] | undefined, name: string): string | undefined {
  const index = argv?.indexOf(name) ?? -1;
  return index === -1 ? undefined : argv?.[index + 1];
}

/** A base model's weights as Ollama's store keeps them: their digest, and their header. */
export interface StoredBase {
  digest: string;
  header: GgufHeader;
}

/**
 * Writes a tiny base with Glimmer's tensor names into an Ollama store under `name`, the way
 * Ollama 0.40 lays it out. Another `blocks` count makes another build of the same model.
 */
export function storeBase(modelsDir: string, name = 'muse-glimmer:30b', blocks = 2): StoredBase {
  const bytes = encodeGguf(tinyBaseSpec({ blocks, vocabulary: 8 }));
  const [model = name, tag = 'latest'] = name.split(':');
  writeOllamaStore(modelsDir, [
    { path: ['ollama.com', 'library', model, tag], layout: 'v2', weights: bytes },
  ]);
  return {
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    header: parseGgufHeader(bufferSource(bytes)),
  };
}

/** A labeled stand-in LoRA that fits `base`; another `seed` makes another file. */
export function standInAdapter(base: GgufHeader, seed = 1): Buffer {
  return Buffer.from(
    encodeGguf(standInLoraSpec(base, { modules: ['attn_q'], effect: 'perturb', seed })),
  );
}
