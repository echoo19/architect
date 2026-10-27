import type { OllamaStatus, PullProgress } from '@architect/shared';
import { createHttpClient, type HttpClient } from '../http/client';
import { badResponse, cutOff, HttpError } from '../http/errors';
import { withDetail } from '../http/failures';
import { readNdjson } from '../http/ndjson';
import { PullLineWire, TagsWire, VersionWire } from './ollama-wire';

export const OLLAMA_SERVICE = 'Ollama';

export type OllamaModelEntry = OllamaStatus['models'][number];

/** Pulls go quiet while Ollama checks a multi-gigabyte download, so the silence limit is long. */
const PULL_TIMEOUTS = { headersMs: 60_000, idleMs: 300_000 };

export function createOllamaClient(baseUrl: string): HttpClient {
  return createHttpClient({ baseUrl, service: OLLAMA_SERVICE });
}

/** The version of the Ollama server at `baseUrl`. Fails with a network error if none is running. */
export async function ollamaVersion(baseUrl: string, signal?: AbortSignal): Promise<string> {
  return fetchVersion(createOllamaClient(baseUrl), signal);
}

/** The models that are downloaded, with their size on disk and digest. */
export async function listOllamaModels(
  baseUrl: string,
  signal?: AbortSignal,
): Promise<OllamaModelEntry[]> {
  return fetchModels(createOllamaClient(baseUrl), signal);
}

export async function fetchVersion(http: HttpClient, signal?: AbortSignal): Promise<string> {
  return (await http.getJson('/api/version', VersionWire, { signal })).version;
}

export async function fetchModels(
  http: HttpClient,
  signal?: AbortSignal,
): Promise<OllamaModelEntry[]> {
  const { models } = await http.getJson('/api/tags', TagsWire, { signal });
  return models.map((model) => ({ name: model.name, sizeBytes: model.size, digest: model.digest }));
}

/**
 * Downloads a model, reporting progress as it goes. Bytes are totals across every layer seen so
 * far, so one bar can follow the whole download. Resolves once Ollama says the model is ready.
 */
export async function pullOllamaModel(
  baseUrl: string,
  model: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
): Promise<void> {
  const http = createHttpClient({
    baseUrl,
    service: OLLAMA_SERVICE,
    modelNotFoundHint: 'Check the spelling of the model name.',
    timeouts: PULL_TIMEOUTS,
  });
  const stream = await http.openStream('/api/pull', { model, stream: true }, { signal, model });
  const layers = new Map<string, { total: number; completed: number }>();
  try {
    for await (const raw of readNdjson(stream, OLLAMA_SERVICE)) {
      const parsed = PullLineWire.safeParse(raw);
      if (!parsed.success)
        throw badResponse(OLLAMA_SERVICE, 'a progress line in an unexpected shape');
      const line = parsed.data;
      if (line.error) throw pullFailure(line.error, model);

      if (line.digest && line.total) {
        layers.set(line.digest, { total: line.total, completed: line.completed ?? 0 });
      }
      const done = line.status === 'success';
      onProgress(progressOf(model, line.status ?? '', layers, done));
      if (done) return;
    }
    throw cutOff(OLLAMA_SERVICE);
  } finally {
    stream.close();
  }
}

function progressOf(
  model: string,
  status: string,
  layers: ReadonlyMap<string, { total: number; completed: number }>,
  done: boolean,
): PullProgress {
  const progress: PullProgress = { model, status: friendlyStatus(status), done };
  if (layers.size > 0) {
    let completed = 0;
    let total = 0;
    for (const layer of layers.values()) {
      completed += layer.completed;
      total += layer.total;
    }
    progress.completedBytes = completed;
    progress.totalBytes = total;
  }
  return progress;
}

/** Ollama's status lines name layer digests; the first-run screen wants words. */
function friendlyStatus(status: string): string {
  if (status.startsWith('pulling manifest')) return 'Preparing the download';
  if (status.startsWith('pulling')) return 'Downloading';
  if (status.startsWith('verifying')) return 'Checking the download';
  if (status.startsWith('writing') || status.startsWith('removing')) return 'Finishing';
  if (status === 'success') return 'Done';
  return status;
}

function pullFailure(message: string, model: string): HttpError {
  if (/not found|does not exist|manifest unknown/i.test(message)) {
    return new HttpError({
      code: 'not_found',
      summary: `Ollama has no model called "${model}" in its library.`,
      hint: 'Check the spelling of the model name.',
    });
  }
  return new HttpError({
    code: 'server',
    summary: withDetail(`Ollama couldn't finish downloading "${model}".`, message),
    hint: 'Check your internet connection and free disk space, then try again.',
  });
}
