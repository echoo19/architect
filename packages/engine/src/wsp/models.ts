import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  closeSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { homedir, totalmem } from 'node:os';
import { basename, join } from 'node:path';
import type { WspBase, WspModel } from '@architect/shared';

/*
 * The models an Architect WSP experiment can start from: folders with a config.json and
 * safetensors weights, found in the Hugging Face cache or picked by the person. Nothing here
 * writes to a model's folder.
 */

const GB = 1024 ** 3;

/** Bytes a dtype takes per element, for the dtypes safetensors names. */
const DTYPE_BYTES: Record<string, number> = {
  F64: 8,
  F32: 4,
  F16: 2,
  BF16: 2,
  I64: 8,
  I32: 4,
  I16: 2,
  I8: 1,
  U8: 1,
  BOOL: 1,
};

interface TensorInfo {
  dtype: string;
  shape: number[];
}

/** A safetensors file's header: each tensor's dtype and shape. */
export function safetensorsHeader(path: string): Record<string, TensorInfo> {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(8);
    readSync(fd, head, 0, 8, 0);
    const size = Number(head.readBigUInt64LE(0));
    if (size <= 0 || size > 100 * 1024 * 1024)
      throw new Error(`${basename(path)} has no readable header.`);
    const json = Buffer.alloc(size);
    readSync(fd, json, 0, size, 8);
    const parsed = JSON.parse(json.toString('utf8')) as Record<string, unknown>;
    const out: Record<string, TensorInfo> = {};
    for (const [name, value] of Object.entries(parsed)) {
      if (name === '__metadata__') continue;
      const info = value as { dtype?: unknown; shape?: unknown };
      if (typeof info.dtype !== 'string' || !Array.isArray(info.shape)) {
        throw new Error(`${basename(path)}: tensor ${name} has no dtype or shape.`);
      }
      out[name] = { dtype: info.dtype, shape: info.shape.map(Number) };
    }
    return out;
  } finally {
    closeSync(fd);
  }
}

function weightFiles(folder: string): string[] {
  return readdirSync(folder)
    .filter((name) => name.endsWith('.safetensors'))
    .sort();
}

/** Every tensor of a checkpoint by name, across its files. */
export function checkpointTensors(folder: string): Map<string, TensorInfo> {
  const tensors = new Map<string, TensorInfo>();
  for (const file of weightFiles(folder)) {
    for (const [name, info] of Object.entries(safetensorsHeader(join(folder, file)))) {
      tensors.set(name, info);
    }
  }
  return tensors;
}

function readConfig(folder: string): Record<string, unknown> | null {
  const path = join(folder, 'config.json');
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function elements(shape: readonly number[]): number {
  return shape.reduce((product, dim) => product * dim, 1);
}

/**
 * Peak memory, kernel and evaluator together: the evaluator holds the model in float32 below 4B
 * parameters and in bf16 above; the kernel maps the files and copies a few tensors in float32.
 */
export function estimateMemoryGb(parameters: number, bytesOnDisk: number): number {
  const evaluator = parameters * (parameters < 4e9 ? 4 : 2);
  const kernel = bytesOnDisk * 0.25 + 0.6 * GB;
  return Math.round(((evaluator + kernel + 1.2 * GB) / GB) * 10) / 10;
}

/** What a folder holds, and whether an experiment can start from it on this computer. */
export function inspectModelFolder(
  folder: string,
  given: { repo?: string; revision?: string } = {},
  memoryGb = totalmem() / GB,
): WspModel {
  const source = given.repo === undefined ? cacheSource(folder) : given;
  const reasons: string[] = [];
  const config = readConfig(folder);
  if (config === null) reasons.push('It has no readable config.json.');
  const files = existsSync(folder) ? weightFiles(folder) : [];
  if (files.length === 0)
    reasons.push('It has no .safetensors weights; GGUF and .bin files are not read.');
  let parameters = 0;
  let bytes = 0;
  let dtype: string | null = null;
  try {
    for (const info of checkpointTensors(folder).values()) {
      parameters += elements(info.shape);
      dtype ??= info.dtype;
      if (!(info.dtype in DTYPE_BYTES))
        reasons.push(`It stores tensors as ${info.dtype}, which can't be edited here.`);
    }
    for (const file of files) bytes += statSync(join(folder, file)).size;
  } catch (error) {
    reasons.push((error as Error).message);
  }
  const architectures = Array.isArray(config?.['architectures'])
    ? (config['architectures'] as unknown[])
    : [];
  const architecture = typeof architectures[0] === 'string' ? architectures[0] : null;
  if (config !== null && (architecture === null || !architecture.endsWith('ForCausalLM'))) {
    reasons.push(
      'Only decoder-only language models (an architecture ending in ForCausalLM) are supported.',
    );
  }
  const layersValue = config?.['num_hidden_layers'];
  const layers = typeof layersValue === 'number' ? layersValue : null;
  const memory = estimateMemoryGb(parameters, bytes);
  if (parameters > 0 && memory > memoryGb * 0.8) {
    reasons.push(`It needs about ${memory} GB; this computer has ${Math.round(memoryGb)} GB.`);
  }
  const unique = [...new Set(reasons)];
  return {
    ...(source.repo === undefined ? {} : { repo: source.repo }),
    ...(source.revision === undefined ? {} : { revision: source.revision }),
    path: folder,
    name: source.repo ?? basename(folder),
    architecture,
    parameters,
    dtype: dtype === null ? null : dtype.toLowerCase(),
    layers,
    bytes,
    compatibility: { supported: unique.length === 0, reasons: unique },
    memoryGb: memory,
  };
}

/** The repository and revision of a folder that is a snapshot in the Hugging Face cache. */
function cacheSource(folder: string): { repo?: string; revision?: string } {
  const match = /models--([^\\/]+?)--([^\\/]+)[\\/]snapshots[\\/]([0-9a-f]{40})[\\/]?$/.exec(
    folder,
  );
  return match === null ? {} : { repo: `${match[1]}/${match[2]}`, revision: match[3]! };
}

/** The Hugging Face cache's hub folder, as the Hub's own tools find it. */
export function hubCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env['HF_HUB_CACHE']) return env['HF_HUB_CACHE'];
  if (env['HF_HOME']) return join(env['HF_HOME'], 'hub');
  return join(homedir(), '.cache', 'huggingface', 'hub');
}

/** Every model snapshot in the cache that has a config.json. */
export function cachedModels(cacheDir = hubCacheDir(), memoryGb?: number): WspModel[] {
  if (!existsSync(cacheDir)) return [];
  const models: WspModel[] = [];
  for (const entry of readdirSync(cacheDir)) {
    if (!entry.startsWith('models--')) continue;
    const repo = entry.slice('models--'.length).replace('--', '/');
    const snapshots = join(cacheDir, entry, 'snapshots');
    if (!existsSync(snapshots)) continue;
    for (const revision of readdirSync(snapshots)) {
      const folder = join(snapshots, revision);
      if (!existsSync(join(folder, 'config.json'))) continue;
      const source = /^[0-9a-f]{40}$/.test(revision) ? { repo, revision } : { repo };
      models.push(inspectModelFolder(folder, source, memoryGb));
    }
  }
  return models.sort((a, b) => a.parameters - b.parameters || a.name.localeCompare(b.name));
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** The base pinned: every file in its folder hashed, and a digest over them. */
export async function pinBase(model: WspModel): Promise<WspBase> {
  const names = readdirSync(model.path)
    .filter((name) => statSync(join(model.path, name)).isFile())
    .sort();
  const files = [];
  for (const name of names) {
    const path = join(model.path, name);
    files.push({ name, bytes: statSync(path).size, sha256: await sha256File(path) });
  }
  return {
    ...(model.repo === undefined ? {} : { repo: model.repo }),
    ...(model.revision === undefined ? {} : { revision: model.revision }),
    path: model.path,
    name: model.name,
    architecture: model.architecture,
    parameters: model.parameters,
    files,
    digest: baseDigest(files),
  };
}

export function baseDigest(files: readonly { name: string; sha256: string }[]): string {
  const lines = [...files]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((file) => `${file.name}\t${file.sha256}`);
  return createHash('sha256').update(lines.join('\n')).digest('hex');
}

/** The files that changed since the base was pinned; empty when it is as it was. */
export async function baseChanges(base: WspBase): Promise<string[]> {
  const changed: string[] = [];
  for (const file of base.files) {
    const path = join(base.path, file.name);
    if (
      !existsSync(path) ||
      statSync(path).size !== file.bytes ||
      (await sha256File(path)) !== file.sha256
    ) {
      changed.push(file.name);
    }
  }
  return changed;
}
