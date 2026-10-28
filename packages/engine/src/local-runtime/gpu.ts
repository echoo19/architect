import { createServer } from 'node:net';
import { loadedOllamaModels, unloadOllamaModel } from '@architect/adapters';
import { AdapterError, isLoopbackUrl, OLLAMA_BASE_URL } from '@architect/shared';
import { LocalRuntimeError } from './errors';

export interface FreeGpuOptions {
  /** Where Ollama listens; only this computer is accepted. */
  baseUrl?: string;
  /** How long to wait for Ollama to let go of its models. Default 60 s. */
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Asks Ollama to unload every model it holds and waits until it has, so llama-server gets the
 * GPU to itself. An Ollama that isn't running holds nothing.
 */
export async function freeGpuFromOllama(options: FreeGpuOptions = {}): Promise<string[]> {
  const baseUrl = options.baseUrl ?? OLLAMA_BASE_URL;
  if (!isLoopbackUrl(baseUrl)) throw new Error('Ollama must be on this computer.');
  const { signal } = options;
  let loaded: string[];
  try {
    loaded = (await loadedOllamaModels(baseUrl, signal)).map((model) => model.name);
  } catch (error) {
    if (error instanceof AdapterError && error.code === 'network') return [];
    throw error;
  }
  for (const model of loaded) await unloadOllamaModel(baseUrl, model, signal);

  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const still = (await loadedOllamaModels(baseUrl, signal)).map((model) => model.name);
    if (still.length === 0) return loaded;
    if (Date.now() >= deadline) {
      throw new LocalRuntimeError(
        'gpu_busy',
        `Ollama still holds ${still.join(', ')} after being asked to unload it.`,
        'Stop the chat or training that uses it, or quit Ollama, then try again.',
      );
    }
    await wait(options.pollMs ?? 500);
  }
}

/** A port on 127.0.0.1 that nothing listens on right now. */
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('No port was free.'))));
    });
  });
}
