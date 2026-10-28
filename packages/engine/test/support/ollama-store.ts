import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface StoredModel {
  /** Path parts under the manifests folder: host, namespace, model, tag. */
  path: [string, string, string, string];
  /** `manifests-v2` as Ollama 0.40 writes, or the older `manifests`. */
  layout: 'v1' | 'v2';
  weights: Uint8Array;
  /** Changes the size the manifest records, to fake a damaged download. */
  recordedSize?: number;
  /** Layers besides the weights, such as a projector or an adapter. */
  extraLayers?: { mediaType: string; content: Uint8Array }[];
  format?: string;
}

function blob(modelsDir: string, content: Uint8Array): { digest: string; size: number } {
  const hex = createHash('sha256').update(content).digest('hex');
  mkdirSync(join(modelsDir, 'blobs'), { recursive: true });
  writeFileSync(join(modelsDir, 'blobs', `sha256-${hex}`), content);
  return { digest: `sha256:${hex}`, size: content.length };
}

/** Writes models into a folder laid out like Ollama's store, manifests in the shape Ollama writes. */
export function writeOllamaStore(modelsDir: string, models: readonly StoredModel[]): void {
  for (const model of models) {
    const weights = blob(modelsDir, model.weights);
    const layers = [
      {
        mediaType: 'application/vnd.ollama.image.model',
        digest: weights.digest,
        size: model.recordedSize ?? weights.size,
      },
      ...(model.extraLayers ?? []).map((layer) => ({
        mediaType: layer.mediaType,
        ...blob(modelsDir, layer.content),
      })),
      {
        mediaType: 'application/vnd.ollama.image.params',
        ...blob(modelsDir, Buffer.from('{"temperature":1,"top_k":64,"top_p":0.95}')),
      },
    ];
    const config = blob(modelsDir, Buffer.from('{"model_format":"gguf"}'));
    const manifest = {
      schemaVersion: 2,
      mediaType: 'application/vnd.docker.distribution.manifest.v2+json',
      config: { mediaType: 'application/vnd.docker.container.image.v1+json', ...config },
      layers,
      ...(model.layout === 'v2' ? { runner: 'llamacpp', format: model.format ?? 'gguf' } : {}),
    };
    const folder = join(
      modelsDir,
      model.layout === 'v2' ? 'manifests-v2' : 'manifests',
      ...model.path.slice(0, 3),
    );
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, model.path[3]), JSON.stringify(manifest));
  }
}
