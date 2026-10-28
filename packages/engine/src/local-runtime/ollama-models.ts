import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { LocalRuntimeError } from './errors';

/**
 * Finds a model's GGUF file in Ollama's own store, so llama-server can load the same weights
 * without a second copy. Ollama keeps a manifest per model name and the files as content-addressed
 * blobs: `manifests/<host>/<namespace>/<model>/<tag>` points at `blobs/sha256-<hex>`. Ollama 0.40
 * writes new manifests under `manifests-v2/`, with `ollama.com` as the default host.
 */

const MODEL_LAYER = 'application/vnd.ollama.image.model';
const PROJECTOR_LAYER = 'application/vnd.ollama.image.projector';
const ADAPTER_LAYER = 'application/vnd.ollama.image.adapter';

const ManifestSchema = z.object({
  schemaVersion: z.number().int(),
  layers: z.array(
    z.object({
      mediaType: z.string(),
      digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
      size: z.number().int().nonnegative(),
    }),
  ),
  /** Ollama 0.40 records the weights' format; GGUF is the one llama-server loads. */
  format: z.string().optional(),
});

export interface OllamaModelFile {
  /** The name as asked for. */
  name: string;
  manifestPath: string;
  /** The GGUF file llama-server loads. */
  modelPath: string;
  /** `sha256:<hex>`: the weights' identity, the same on every computer. */
  digest: string;
  sizeBytes: number;
  /** The vision projector Ollama keeps beside the weights, if the model has one. */
  projectorPath: string | null;
}

export interface OllamaStoreOptions {
  /** The models folder set in Settings, if any. */
  configured?: string | null;
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
}

/** Where Ollama keeps models: the setting, then `OLLAMA_MODELS`, then its default folders. */
export function ollamaModelsDirs(options: OllamaStoreOptions = {}): string[] {
  const configured = options.configured?.trim();
  if (configured) return [configured];
  const fromEnv = (options.env ?? process.env)['OLLAMA_MODELS']?.trim();
  if (fromEnv) return [fromEnv];
  const home = options.home ?? homedir();
  const dirs = [join(home, '.ollama', 'models')];
  // The Linux installer runs Ollama as its own user with this home.
  if ((options.platform ?? process.platform) === 'linux') {
    dirs.push('/usr/share/ollama/.ollama/models');
  }
  return dirs;
}

interface ParsedName {
  host: string | null;
  namespace: string;
  model: string;
  tag: string;
}

const PART = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const HOST = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** `[host/][namespace/]model[:tag]`, Ollama's form. Anything that could leave the store is refused. */
export function parseOllamaName(name: string): ParsedName | null {
  const parts = name.trim().split('/');
  if (parts.length > 3) return null;
  const last = parts.at(-1) ?? '';
  const colon = last.lastIndexOf(':');
  const model = colon === -1 ? last : last.slice(0, colon);
  const tag = colon === -1 ? 'latest' : last.slice(colon + 1);
  const host = parts.length === 3 ? (parts[0] ?? null) : null;
  const namespace = parts.length >= 2 ? (parts.at(-2) ?? 'library') : 'library';
  const valid =
    PART.test(model) &&
    PART.test(tag) &&
    PART.test(namespace) &&
    (host === null || HOST.test(host)) &&
    ![model, tag, namespace, host].some((part) => part === '.' || part === '..');
  return valid ? { host, namespace, model, tag } : null;
}

function manifestCandidates(modelsDir: string, parsed: ParsedName): string[] {
  const { namespace, model, tag } = parsed;
  const v2Hosts = parsed.host ? [parsed.host] : ['ollama.com', 'registry.ollama.ai'];
  const v1Hosts = parsed.host ? [parsed.host] : ['registry.ollama.ai', 'ollama.com'];
  return [
    ...v2Hosts.map((host) => join(modelsDir, 'manifests-v2', host, namespace, model, tag)),
    ...v1Hosts.map((host) => join(modelsDir, 'manifests', host, namespace, model, tag)),
  ];
}

const blobPath = (modelsDir: string, digest: string) =>
  join(modelsDir, 'blobs', digest.replace(':', '-'));

function startsWithGguf(path: string): boolean {
  const fd = openSync(path, 'r');
  try {
    const magic = Buffer.alloc(4);
    return readSync(fd, magic, 0, 4, 0) === 4 && magic.toString('latin1') === 'GGUF';
  } finally {
    closeSync(fd);
  }
}

/** Resolves an Ollama model name to its GGUF weights, checking the file is whole. */
export function resolveOllamaModel(
  name: string,
  options: OllamaStoreOptions = {},
): OllamaModelFile {
  const parsed = parseOllamaName(name);
  if (!parsed) {
    throw new LocalRuntimeError(
      'model_not_found',
      `"${name}" isn't a model name Ollama uses.`,
      'Choose an installed model in Settings › Models.',
    );
  }
  const dirs = ollamaModelsDirs(options);
  for (const modelsDir of dirs) {
    for (const manifestPath of manifestCandidates(modelsDir, parsed)) {
      let text: string;
      try {
        text = readFileSync(manifestPath, 'utf8');
      } catch {
        continue;
      }
      return modelFromManifest(name, modelsDir, manifestPath, text);
    }
  }
  throw new LocalRuntimeError(
    'model_not_found',
    `${name} isn't in Ollama's model folder (${dirs.join(' or ')}).`,
    `Download ${name} with Ollama (Settings › Models downloads Glimmer's builds), then try again.`,
  );
}

function modelFromManifest(
  name: string,
  modelsDir: string,
  manifestPath: string,
  text: string,
): OllamaModelFile {
  const unusable = (message: string, hint = `Reinstall ${name} in Settings › Models.`) =>
    new LocalRuntimeError('model_unusable', message, hint);
  let manifest: z.infer<typeof ManifestSchema>;
  try {
    manifest = ManifestSchema.parse(JSON.parse(text));
  } catch {
    throw unusable(`Ollama's record of ${name} can't be read.`);
  }
  if (manifest.format !== undefined && manifest.format !== 'gguf') {
    throw unusable(
      `${name} is stored as ${manifest.format}, not GGUF, so llama-server can't load it.`,
      'Use a build of the model that Ollama stores as GGUF.',
    );
  }
  if (manifest.layers.some((layer) => layer.mediaType === ADAPTER_LAYER)) {
    throw unusable(
      `${name} has an adapter built into Ollama's copy, which llama-server would leave out.`,
      'Use the base model without an adapter.',
    );
  }
  const models = manifest.layers.filter((layer) => layer.mediaType === MODEL_LAYER);
  const [layer] = models;
  if (!layer || models.length > 1)
    throw unusable(`Ollama's record of ${name} has no single weights file.`);

  const modelPath = blobPath(modelsDir, layer.digest);
  let size: number;
  try {
    size = statSync(modelPath).size;
  } catch {
    throw unusable(`The weights of ${name} are missing from Ollama's folder.`);
  }
  if (size !== layer.size) {
    throw unusable(`The weights of ${name} are ${size} bytes; Ollama recorded ${layer.size}.`);
  }
  if (!startsWithGguf(modelPath)) throw unusable(`The weights of ${name} aren't a GGUF file.`);

  const projector = manifest.layers.find((entry) => entry.mediaType === PROJECTOR_LAYER);
  return {
    name,
    manifestPath,
    modelPath,
    digest: layer.digest,
    sizeBytes: layer.size,
    projectorPath: projector ? blobPath(modelsDir, projector.digest) : null,
  };
}
