import { isLoopbackUrl, unloadOllamaModel } from '@architect/adapters';
import {
  AdapterError,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentEndpoint,
  type StudentStreamEvent,
} from '@architect/shared';
import { asAdapterError } from './errors';
import type { GpuHold, GpuLease } from './lease';
import type { GpuPurpose } from './lease-rules';

export interface OllamaUseOptions {
  /** How long Ollama keeps a model loaded after its last request. */
  keepAliveMs: number;
}

/**
 * Ollama on this computer as one Architect process uses it under the GPU lease (decision 046):
 * each request holds the lease, so Architect's idle llama-servers stop before Ollama is asked
 * anything, and when the process must give the GPU up it unloads the models it sent requests to.
 */
export class OllamaUse {
  /** The models this process has used since it last gave the GPU up, by address and name. */
  private readonly loaded = new Map<string, { baseUrl: string; model: string }>();
  private lastUsed = 0;

  constructor(
    private readonly lease: GpuLease,
    private readonly options: OllamaUseOptions,
  ) {
    lease.serve('ollama', {
      release: () => this.unloadAll(),
      // Ollama lets a model go by itself once it has been idle for its keep-alive.
      resident: () => this.loaded.size > 0 && Date.now() - this.lastUsed < options.keepAliveMs,
    });
  }

  /**
   * The student, holding the GPU for each of its requests when it is Ollama on this computer, for
   * `purpose`; any other student as it is, since Architect can't free another runtime's memory.
   */
  student(
    endpoint: Pick<StudentEndpoint, 'runtime' | 'baseUrl' | 'model'>,
    student: StudentAdapter,
    purpose: GpuPurpose,
  ): StudentAdapter {
    if (endpoint.runtime !== 'ollama' || !isLoopbackUrl(endpoint.baseUrl)) return student;
    const key = `${endpoint.baseUrl} ${endpoint.model}`;
    const model = { baseUrl: endpoint.baseUrl, model: endpoint.model };
    return {
      label: student.label,
      model: student.model,
      baseUrl: student.baseUrl,
      isLocal: student.isLocal,
      contextLength: student.contextLength,
      chat: (request, signal) => this.chat(student, key, model, purpose, request, signal),
      describe: () => student.describe(),
      testConnection: () => student.testConnection(),
      release: async () => {
        await student.release();
        this.loaded.delete(key);
      },
    };
  }

  private async *chat(
    student: StudentAdapter,
    key: string,
    model: { baseUrl: string; model: string },
    purpose: GpuPurpose,
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    let hold: GpuHold;
    try {
      hold = await this.lease.hold('ollama', purpose, signal);
    } catch (error) {
      throw asAdapterError(error);
    }
    this.loaded.set(key, model);
    try {
      yield* student.chat(request, signal);
    } finally {
      this.lastUsed = Date.now();
      hold.release();
    }
  }

  /** Unloads every model this process used. An Ollama that isn't running holds nothing. */
  private async unloadAll(): Promise<void> {
    const models = [...this.loaded.values()];
    this.loaded.clear();
    let failure: unknown = null;
    for (const { baseUrl, model } of models) {
      try {
        await unloadOllamaModel(baseUrl, model);
      } catch (error) {
        if (
          error instanceof AdapterError &&
          (error.code === 'network' || error.code === 'not_found')
        )
          continue;
        failure ??= error;
      }
    }
    if (failure !== null) throw failure;
  }
}
