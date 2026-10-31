import { listOllamaModels, ollamaVersion, type NetworkDeps } from '@architect/adapters';
import {
  AdapterError,
  OLLAMA_BASE_URL,
  type AdapterErrorCode,
  type OllamaStatus,
  type StudentEndpoint,
} from '@architect/shared';

/** Ollama on this computer answers at once; anything slower counts as not running. */
const STATUS_TIMEOUT_MS = 5_000;

/** Ways of not getting an answer at all, as opposed to getting a wrong one. */
const NO_ANSWER: ReadonlySet<AdapterErrorCode> = new Set(['network', 'timeout', 'aborted']);

/** The default student's server when it runs on Ollama, otherwise Ollama's standard address. */
export function ollamaBaseUrl(student: StudentEndpoint): string {
  return student.runtime === 'ollama' ? student.baseUrl : OLLAMA_BASE_URL;
}

/**
 * Whether Ollama runs at `baseUrl` and which models it has. Not running is an answer; one outside
 * the closed network (decision 098) is refused, never asked.
 */
export async function ollamaStatus(baseUrl: string, network?: NetworkDeps): Promise<OllamaStatus> {
  const signal = AbortSignal.timeout(STATUS_TIMEOUT_MS);
  let version: string;
  try {
    version = await ollamaVersion(baseUrl, signal, network);
  } catch (error) {
    if (error instanceof AdapterError && NO_ANSWER.has(error.code)) {
      return { running: false, models: [] };
    }
    throw error;
  }
  return { running: true, version, models: await listOllamaModels(baseUrl, signal, network) };
}
