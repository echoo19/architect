import { statSync } from 'node:fs';
import { sha256File } from '@architect/harness';
import {
  AdapterError,
  DEFAULT_STUDENT,
  type AdapterErrorCode,
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
import { LocalRuntimeError, type LocalRuntimeErrorCode } from './errors';
import { freeGpuFromOllama } from './gpu';
import { resolveOllamaModel, type OllamaModelFile, type OllamaStoreOptions } from './ollama-models';
import { LlamaServer, type LlamaServerLaunch, type ServerStatus } from './server';

export interface AdapterFile {
  /** What the caller calls it, such as the graduate version or candidate it belongs to. */
  key: string;
  /** A GGUF LoRA. */
  path: string;
  /** The file's sha256 as its package lists it. A file that no longer matches never loads. */
  sha256?: string;
}

export interface ServeRequest {
  /** The base model, by its name in Ollama's store. */
  model: string;
  /** Every adapter the server loads, in load order. */
  adapters: readonly AdapterFile[];
  /** This student's scale for each adapter, by key. Adapters it doesn't name get 0. */
  scales: Readonly<Record<string, number>>;
  /**
   * The base build the adapters were trained on: the digest (`sha256:<hex>`) of its GGUF file in
   * Ollama's store. A model of that name with other weights is refused before anything loads.
   */
  baseDigest?: string;
  /** The context the server runs with, as the version was made with; the runtime's default when absent. */
  contextLength?: number;
  /**
   * The base as the version's package records it: the name its author ran it under and, when the
   * weights came from a hub, their revision. A base of another build is refused with these.
   */
  publishedBase?: { name: string; revision?: string };
}

/** Everything serving a request needs, as a check found it. Nothing was loaded to find it. */
export interface ServeSurvey {
  /** The llama-server that would run, and its build; null when there is none fit to run. */
  server: { file: string; build: number } | null;
  /** The base's weights in Ollama's store; null when they aren't there whole. */
  base: OllamaModelFile | null;
  /** What stands in the way of serving, each saying what to do about it; empty when nothing does. */
  problems: LocalRuntimeError[];
}

/** What a host needs from the adapter runtime: to check serving a version, and to serve it. */
export interface AdapterServing {
  survey(request: ServeRequest): Promise<ServeSurvey>;
  access(request: ServeRequest): LlamaServerAccess;
  /** Stops the server now, which frees the GPU. */
  stop(): Promise<void>;
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
  /** The Ollama whose models are unloaded before a start; Ollama's own address by default. */
  ollamaUrl?: () => string | undefined;
  /** Default: the student's usual 16K. */
  contextSize?: number;
  /** Default: every layer. */
  gpuLayers?: number;
  idleStopMs?: number;
  startupTimeoutMs?: number;
  /** Frees the GPU before the server starts. Default: unload the models of `ollamaUrl`. */
  freeGpu?: (signal?: AbortSignal) => Promise<void>;
  /** Runs this instead of finding llama-server; its build is checked all the same. Tests use a stand-in. */
  command?: ServerCommand;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

const ALL_LAYERS = 999;

/**
 * How a student reports a runtime that can't start: as an adapter error, which stops an
 * evaluation instead of counting as a wrong answer. Waiting may fix a busy GPU or a failed start,
 * so those can be tried again; a missing or unusable file can't be.
 */
const ADAPTER_CODES: Record<LocalRuntimeErrorCode, AdapterErrorCode> = {
  binary_not_found: 'not_found',
  binary_unusable: 'bad_request',
  model_not_found: 'not_found',
  model_unusable: 'bad_request',
  base_mismatch: 'bad_request',
  adapter_unusable: 'bad_request',
  gpu_busy: 'server',
  out_of_memory: 'server',
  start_failed: 'server',
  busy: 'server',
};

function asAdapterError(error: unknown): unknown {
  if (!(error instanceof LocalRuntimeError)) return error;
  return new AdapterError(ADAPTER_CODES[error.code], `${error.message} ${error.hint}`, {
    cause: error,
  });
}

/** `sha256:` and the first twelve digits: enough to tell two builds apart in a sentence. */
export function shortDigest(digest: string): string {
  return digest.slice(0, 19);
}

/** A file's size and modification time: what says it may have changed since it was last read. */
function stampOf(path: string): string | null {
  try {
    const stats = statSync(path);
    return stats.isFile() ? `${stats.size}:${stats.mtimeMs}` : null;
  } catch {
    return null;
  }
}

/**
 * Serves a base model from Ollama's store with GGUF LoRA adapters through one llama-server
 * process: finds the program, resolves the model's file, checks every adapter against the base
 * before anything loads, frees the GPU from Ollama, and hands students what they need to call it.
 */
export class LocalAdapterRuntime implements AdapterServing {
  private readonly server: LlamaServer;
  private readonly versions = new Map<string, ServerVersion>();
  private readonly headers = new Map<string, { stamp: string; header: GgufHeader }>();
  private readonly hashes = new Map<string, { stamp: string; sha256: string }>();

  constructor(private readonly options: LocalAdapterRuntimeOptions) {
    const freeGpu =
      options.freeGpu ??
      (async (signal?: AbortSignal) => {
        const baseUrl = options.ollamaUrl?.();
        await freeGpuFromOllama({
          ...(baseUrl === undefined ? {} : { baseUrl }),
          ...(signal === undefined ? {} : { signal }),
        });
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

  /**
   * Everything a start needs, checked: the program and its build, the model's file and its build,
   * and each adapter's file and fit. Throws the first problem it finds.
   */
  async prepare(
    request: Pick<
      ServeRequest,
      'model' | 'adapters' | 'baseDigest' | 'contextLength' | 'publishedBase'
    >,
  ): Promise<{ launch: LlamaServerLaunch; model: OllamaModelFile; version: ServerVersion }> {
    const keys = request.adapters.map((adapter) => adapter.key);
    if (new Set(keys).size !== keys.length) throw new Error('Two adapters have the same key.');
    const { command, version } = await this.serverCommand();
    const { model, header } = this.resolveBase(request.model);
    this.assertBaseBuild(request, model);
    const adapterFiles: string[] = [];
    for (const adapter of request.adapters) {
      adapterFiles.push(await this.checkAdapter(request.model, adapter, header));
    }
    const threads = this.options.threads?.();
    const launch: LlamaServerLaunch = {
      command,
      modelPath: model.modelPath,
      alias: request.model,
      adapters: request.adapters.map((adapter) => adapter.path),
      adapterFiles,
      contextSize: this.contextLength(request),
      gpuLayers: this.options.gpuLayers ?? ALL_LAYERS,
      ...(threads === undefined ? {} : { threads }),
    };
    return { launch, model, version };
  }

  private contextLength(request: Pick<ServeRequest, 'contextLength'>): number {
    return request.contextLength ?? this.options.contextSize ?? DEFAULT_STUDENT.contextLength;
  }

  /**
   * Checks each thing serving needs on its own, so every problem shows at once rather than the
   * first: the program and its build, the base in Ollama's store and its build, and each
   * adapter's file and fit. Loads nothing.
   */
  async survey(request: ServeRequest): Promise<ServeSurvey> {
    const problems: LocalRuntimeError[] = [];
    const note = (error: unknown): void => {
      if (!(error instanceof LocalRuntimeError)) throw error;
      problems.push(error);
    };
    let server: ServeSurvey['server'] = null;
    try {
      const { command, version } = await this.serverCommand();
      server = { file: command.file, build: version.build };
    } catch (error) {
      note(error);
    }
    let base: { model: OllamaModelFile; header: GgufHeader } | null = null;
    try {
      base = this.resolveBase(request.model);
      this.assertBaseBuild(request, base.model);
    } catch (error) {
      note(error);
    }
    for (const adapter of request.adapters) {
      try {
        await this.checkAdapter(request.model, adapter, base?.header ?? null);
      } catch (error) {
        note(error);
      }
    }
    return { server, base: base?.model ?? null, problems };
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
        try {
          const { launch } = await this.prepare(request);
          const { server, release } = await this.server.acquire(launch, signal);
          return {
            url: server.url,
            apiKey: server.apiKey,
            lora: lora.map((entry) => ({ ...entry })),
            release,
          };
        } catch (error) {
          throw asAdapterError(error);
        }
      },
      check: () => this.check(request),
      describe: () => this.describe(request),
      // Other students may share the server: it stops once none of them has a request in flight.
      stop: () => this.server.stopWhenIdle(),
    };
  }

  private async check(request: ServeRequest): Promise<ConnectionTest> {
    const started = performance.now();
    try {
      const { version } = await this.prepare(request);
      const adapters = request.adapters.length;
      return {
        ok: true,
        latencyMs: Math.round(performance.now() - started),
        detail: `llama-server build ${version.build} can run ${request.model}${adapters > 0 ? ` with ${adapters === 1 ? 'its adapter' : `${adapters} adapters`}` : ''}.`,
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
      contextLength: this.contextLength(request),
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

  /** The program to run and its build, which is asked again only when the file changes. */
  private async serverCommand(): Promise<{ command: ServerCommand; version: ServerVersion }> {
    const command =
      this.options.command ??
      findLlamaServer({
        configured: this.options.serverPath?.() ?? null,
        ...(this.options.env === undefined ? {} : { env: this.options.env }),
        ...(this.options.platform === undefined ? {} : { platform: this.options.platform }),
      }).command;
    const key = JSON.stringify([command.file, command.args, stampOf(command.file)]);
    let version = this.versions.get(key);
    if (!version) {
      version = await checkServerVersion(command);
      this.versions.set(key, version);
    }
    return { command, version };
  }

  /** The base's GGUF file in Ollama's store, with its header. */
  private resolveBase(name: string): { model: OllamaModelFile; header: GgufHeader } {
    const model = resolveOllamaModel(name, this.store());
    const header = this.header(
      model.modelPath,
      () =>
        new LocalRuntimeError(
          'model_unusable',
          `The weights of ${name} can't be read as GGUF.`,
          `Reinstall ${name} in Settings › Models.`,
        ),
    );
    return { model, header };
  }

  /**
   * Refuses a base whose weights aren't the build the adapters were trained on. Ollama can't
   * download a build by its weights, so the fix is that exact file, from whoever published the
   * agent, added under a name of its own: other versions may use the model under this name, so
   * the fix never replaces it.
   */
  private assertBaseBuild(
    request: Pick<ServeRequest, 'model' | 'adapters' | 'baseDigest' | 'publishedBase'>,
    model: OllamaModelFile,
  ): void {
    const expected = request.baseDigest;
    if (expected === undefined || model.digest === expected) return;
    const trained = request.adapters.length === 1 ? 'its adapter was' : 'its adapters were';
    const published = request.publishedBase;
    const named =
      published === undefined ||
      (published.name === request.model && published.revision === undefined)
        ? ''
        : ` (its package names it ${published.name}${published.revision === undefined ? '' : ` at revision ${published.revision}`})`;
    throw new LocalRuntimeError(
      'base_mismatch',
      `${request.model} on this computer is another build (weights ${shortDigest(model.digest)}) than the one ${trained} trained on (${shortDigest(expected)}).`,
      `It needs the exact GGUF ${trained} trained on, whose weights are ${expected}. Ollama can't download a build by its weights, so get that file from whoever published this agent${named}, add it to Ollama under a name of its own, then set this agent's model to that name.`,
    );
  }

  /**
   * Checks one adapter before anything loads it: its file is the one its package lists, it reads
   * as GGUF, and it fits the base (when the base could be read). Returns what the file holds: its
   * sha256 when the request names one, else its size and time.
   */
  private async checkAdapter(
    model: string,
    adapter: AdapterFile,
    base: GgufHeader | null,
  ): Promise<string> {
    const unreadable = () =>
      new LocalRuntimeError(
        'adapter_unusable',
        `The adapter for ${adapter.key} is missing or isn't a GGUF file.`,
        'Train it again, or restore the graduate from its export.',
      );
    const stamp = stampOf(adapter.path);
    if (stamp === null) throw unreadable();
    if (adapter.sha256 !== undefined) {
      const actual = await this.sha256Of(adapter.path, stamp);
      if (actual !== adapter.sha256) {
        throw new LocalRuntimeError(
          'adapter_unusable',
          `The adapter for ${adapter.key} isn't the file it was installed with: its sha256 begins ${actual.slice(0, 12)}, not ${adapter.sha256.slice(0, 12)}.`,
          'Import the graduate again from its export, or roll back to a version whose files are whole.',
        );
      }
    }
    const header = this.header(adapter.path, unreadable);
    if (base !== null) {
      const check = checkLoraAgainstBase(header, base);
      if (!check.ok) {
        throw new LocalRuntimeError(
          'adapter_unusable',
          `The adapter for ${adapter.key} doesn't fit ${model}: ${check.problems[0] ?? ''}`,
          'Use the model it was trained for, or train it again for this one.',
        );
      }
    }
    return adapter.sha256 ?? stamp;
  }

  /** A file's sha256, worked out again only when the file changes. */
  private async sha256Of(path: string, stamp: string): Promise<string> {
    const cached = this.hashes.get(path);
    if (cached?.stamp === stamp) return cached.sha256;
    const sha256 = await sha256File(path);
    this.hashes.set(path, { stamp, sha256 });
    return sha256;
  }

  /** A GGUF header, read again only when the file changes. */
  private header(path: string, unreadable: () => LocalRuntimeError): GgufHeader {
    const stamp = stampOf(path);
    if (stamp === null) throw unreadable();
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
