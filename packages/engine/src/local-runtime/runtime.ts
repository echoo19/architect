import { statSync } from 'node:fs';
import {
  DEFAULT_STUDENT,
  type ConnectionTest,
  type LlamaServerAccess,
  type LoraScale,
  type StudentModelInfo,
} from '@architect/shared';
import { checkLoraAgainstBase, GgufError, readGgufHeader, type GgufHeader } from '../gguf';
import {
  checkServerVersion,
  findLlamaServer,
  type ServerCommand,
  type ServerVersion,
} from './binary';
import { LocalRuntimeError } from './errors';
import { freeGpuFromOllama } from './gpu';
import { resolveOllamaModel, type OllamaModelFile, type OllamaStoreOptions } from './ollama-models';
import { LlamaServer, type LlamaServerLaunch, type ServerStatus } from './server';

export interface AdapterFile {
  /** What the caller calls it, such as the graduate version or candidate it belongs to. */
  key: string;
  /** A GGUF LoRA. */
  path: string;
}

export interface ServeRequest {
  /** The base model, by its name in Ollama's store. */
  model: string;
  /** Every adapter the server loads, in load order. */
  adapters: readonly AdapterFile[];
  /** This student's scale for each adapter, by key. Adapters it doesn't name get 0. */
  scales: Readonly<Record<string, number>>;
}

export interface LocalAdapterRuntimeOptions {
  /** Under the app's data folder: the server's key, process record and logs. */
  runtimeDir: string;
  /** The llama-server path set in Settings, read at each start. */
  serverPath?: () => string | null | undefined;
  /** The folder Ollama keeps models in, when Settings names one; read at each start. */
  ollamaModelsDir?: () => string | null | undefined;
  /** The quiet-mode CPU thread cap, read at each start. */
  threads?: () => number | undefined;
  /** Default: the student's usual 16K. */
  contextSize?: number;
  /** Default: every layer. */
  gpuLayers?: number;
  idleStopMs?: number;
  startupTimeoutMs?: number;
  /** Frees the GPU before the server starts. Default: unload Ollama's models. */
  freeGpu?: (signal?: AbortSignal) => Promise<void>;
  /** Runs this instead of finding llama-server, with no version check. Tests use a stand-in. */
  command?: ServerCommand;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

const ALL_LAYERS = 999;

/**
 * Serves a base model from Ollama's store with GGUF LoRA adapters through one llama-server
 * process: finds the program, resolves the model's file, checks every adapter against the base
 * before anything loads, frees the GPU from Ollama, and hands students what they need to call it.
 */
export class LocalAdapterRuntime {
  private readonly server: LlamaServer;
  private readonly versions = new Map<string, ServerVersion>();
  private readonly headers = new Map<string, { stamp: string; header: GgufHeader }>();

  constructor(private readonly options: LocalAdapterRuntimeOptions) {
    const freeGpu =
      options.freeGpu ??
      (async (signal?: AbortSignal) => {
        await freeGpuFromOllama(signal === undefined ? {} : { signal });
      });
    this.server = new LlamaServer({
      runtimeDir: options.runtimeDir,
      beforeStart: freeGpu,
      ...(options.idleStopMs === undefined ? {} : { idleStopMs: options.idleStopMs }),
      ...(options.startupTimeoutMs === undefined
        ? {}
        : { startupTimeoutMs: options.startupTimeoutMs }),
    });
  }

  status(): ServerStatus {
    return this.server.status();
  }

  recentLog(): string[] {
    return this.server.recentLog();
  }

  stop(): Promise<void> {
    return this.server.stop();
  }

  /** Everything a start needs, checked: the program, the model's file and each adapter. */
  async prepare(
    request: Pick<ServeRequest, 'model' | 'adapters'>,
  ): Promise<{ launch: LlamaServerLaunch; model: OllamaModelFile; version: ServerVersion | null }> {
    const keys = request.adapters.map((adapter) => adapter.key);
    if (new Set(keys).size !== keys.length) throw new Error('Two adapters have the same key.');
    const { command, version } = await this.serverCommand();
    const model = resolveOllamaModel(request.model, this.store());
    const base = this.header(
      model.modelPath,
      () =>
        new LocalRuntimeError(
          'model_unusable',
          `The weights of ${request.model} can't be read as GGUF.`,
          `Reinstall ${request.model} in Settings › Models.`,
        ),
    );
    for (const adapter of request.adapters) {
      const header = this.header(
        adapter.path,
        () =>
          new LocalRuntimeError(
            'adapter_unusable',
            `The adapter for ${adapter.key} is missing or isn't a GGUF file.`,
            'Train it again, or restore the graduate from its export.',
          ),
      );
      const check = checkLoraAgainstBase(header, base);
      if (!check.ok) {
        throw new LocalRuntimeError(
          'adapter_unusable',
          `The adapter for ${adapter.key} doesn't fit ${request.model}: ${check.problems[0] ?? ''}`,
          'Use the model it was trained for, or train it again for this one.',
        );
      }
    }
    const threads = this.options.threads?.();
    const launch: LlamaServerLaunch = {
      command,
      modelPath: model.modelPath,
      alias: request.model,
      adapters: request.adapters.map((adapter) => adapter.path),
      contextSize: this.options.contextSize ?? DEFAULT_STUDENT.contextLength,
      gpuLayers: this.options.gpuLayers ?? ALL_LAYERS,
      ...(threads === undefined ? {} : { threads }),
    };
    return { launch, model, version };
  }

  /** What one llama.cpp student needs: a server started on demand, and its scale per adapter. */
  access(request: ServeRequest): LlamaServerAccess {
    const known = new Set(request.adapters.map((adapter) => adapter.key));
    for (const [key, scale] of Object.entries(request.scales)) {
      if (!known.has(key)) throw new Error(`No adapter is loaded as ${key}.`);
      if (!Number.isFinite(scale)) throw new Error(`The scale for ${key} isn't a number.`);
    }
    const lora: LoraScale[] = request.adapters.map((adapter, id) => ({
      id,
      scale: request.scales[adapter.key] ?? 0,
    }));
    return {
      model: request.model,
      baseUrl: 'http://127.0.0.1',
      acquire: async (signal) => {
        const { launch } = await this.prepare(request);
        const running = await this.server.ensure(launch, signal);
        const release = this.server.hold();
        return {
          url: running.url,
          apiKey: running.apiKey,
          lora: lora.map((entry) => ({ ...entry })),
          release,
        };
      },
      check: () => this.check(request),
      describe: () => this.describe(request),
      stop: () => this.server.stop(),
    };
  }

  private async check(request: ServeRequest): Promise<ConnectionTest> {
    const started = performance.now();
    try {
      const { version } = await this.prepare(request);
      const adapters = request.adapters.length;
      const build = version ? `llama-server build ${version.build}` : 'llama-server';
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        detail: `${build} can run ${request.model}${adapters > 0 ? ` with ${adapters === 1 ? 'its adapter' : `${adapters} adapters`}` : ''}.`,
      };
    } catch (error) {
      if (error instanceof LocalRuntimeError)
        return { ok: false, error: error.message, hint: error.hint };
      throw error;
    }
  }

  private describe(request: ServeRequest): Promise<StudentModelInfo> {
    const model = resolveOllamaModel(request.model, this.store());
    return Promise.resolve({
      model: request.model,
      digest: model.digest,
      sizeBytes: model.sizeBytes,
      contextLength: this.options.contextSize ?? DEFAULT_STUDENT.contextLength,
    });
  }

  private store(): OllamaStoreOptions {
    return {
      configured: this.options.ollamaModelsDir?.() ?? null,
      ...(this.options.env === undefined ? {} : { env: this.options.env }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
      ...(this.options.home === undefined ? {} : { home: this.options.home }),
    };
  }

  private async serverCommand(): Promise<{
    command: ServerCommand;
    version: ServerVersion | null;
  }> {
    if (this.options.command) return { command: this.options.command, version: null };
    const { command } = findLlamaServer({
      configured: this.options.serverPath?.() ?? null,
      ...(this.options.env === undefined ? {} : { env: this.options.env }),
      ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
    });
    let version = this.versions.get(command.file);
    if (!version) {
      version = await checkServerVersion(command);
      this.versions.set(command.file, version);
    }
    return { command, version };
  }

  /** A GGUF header, read again only when the file changes. */
  private header(path: string, unreadable: () => LocalRuntimeError): GgufHeader {
    let stamp: string;
    try {
      const stats = statSync(path);
      stamp = `${stats.size}:${stats.mtimeMs}`;
    } catch {
      throw unreadable();
    }
    const cached = this.headers.get(path);
    if (cached?.stamp === stamp) return cached.header;
    try {
      const header = readGgufHeader(path);
      this.headers.set(path, { stamp, header });
      return header;
    } catch (error) {
      if (error instanceof GgufError) throw unreadable();
      throw error;
    }
  }
}
