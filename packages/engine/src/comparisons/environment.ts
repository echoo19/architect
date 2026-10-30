import { createHash } from 'node:crypto';
import { unloadOllamaModel } from '@architect/adapters';
import { writeHarness } from '@architect/harness';
import {
  AdapterError,
  OLLAMA_BASE_URL,
  STUDENT_PRESETS,
  type BackendId,
  type Job,
  type RuntimeIdentity,
} from '@architect/shared';
import { readGgufHeader } from '../gguf';
import { studentsHolding } from '../host/students';
import { createEngineDeps } from '../host/wiring';
import { hubTokenResolver } from '../hub';
import {
  describeLlamaServer,
  GpuLease,
  hostAdapterRuntime,
  LocalRuntimeError,
  resolveOllamaModel,
  type GpuLeaseOptions,
  type GpuPurpose,
} from '../local-runtime';
import { systemClock } from '../loop/deps';
import { DataPaths } from '../loop/paths';
import { systemMeter } from './meter';
import type { ComparisonEnvironment } from './runner';

/** Where each provider's key comes from: the environment, never a file or an argument. */
const SECRET_ENV: Record<string, string> = {
  meta: 'META_API_TOKEN',
  openrouter: 'OPENROUTER_API_KEY',
};

/** What the comparisons script does with the GPU, as the app tells whoever it keeps waiting. */
export const COMPARISON_PURPOSE: GpuPurpose = {
  priority: 'run',
  doing: 'testing a model on this computer',
  hint: 'Wait for the comparison to finish, or stop it, then try again.',
};

/**
 * The comparisons script's share of the GPU lease on the app's data folder (decision 046). Its
 * llama-server and its students on Ollama hold the GPU for each request, as the engine's do, and
 * give it up when idle to any process of the app that asks. It takes the GPU only when no process
 * of the app has any of it, and otherwise stops at once with the busy error: a measurement taken
 * beside the app's work would be wrong, and waiting out a long local evaluation could take hours.
 */
export function comparisonLease(
  appDataDir: string,
  timing: Pick<GpuLeaseOptions, 'pollMs' | 'heartbeatMs'> = {},
): GpuLease {
  return new GpuLease({
    dataDir: appDataDir,
    owner: 'comparisons',
    onlyWhenFree: { hint: 'Close Architect while a comparison runs, then run the command again.' },
    ...timing,
  });
}

/**
 * The meter's unload before it times a cold start (decision 045), through the lease: the script
 * holds the GPU alone while its own llama-server stops and Ollama unloads `models`, so no model of
 * Architect's stays loaded or loads meanwhile; any process of the app would have to wait, and the
 * script's own students on Ollama unload what they used as they give the GPU up to it. Fails at
 * once, unloading nothing, when a process of the app has the GPU.
 */
export function clearBeforeColdStart(
  gpu: GpuLease,
  runtime: { stop(): Promise<void> },
  ollama: { baseUrl: string; models: readonly string[] },
): (signal?: AbortSignal) => Promise<void> {
  return async (signal) => {
    const hold = await gpu.hold('llama-server', COMPARISON_PURPOSE, signal);
    try {
      await runtime.stop();
      for (const model of ollama.models) {
        try {
          await unloadOllamaModel(ollama.baseUrl, model, signal);
        } catch (error) {
          // An Ollama that isn't running, or that hasn't the model, has nothing of it loaded.
          const absent =
            error instanceof AdapterError &&
            (error.code === 'network' || error.code === 'not_found');
          if (!absent) throw error;
        }
      }
    } finally {
      hold.release();
    }
  };
}

export interface RealEnvironmentOptions {
  /** The comparison's data folder. */
  dataDir: string;
  /**
   * The app's data folder, where the script takes its turns at the GPU with the app's processes
   * (decision 046).
   */
  appDataDir: string;
  /** The repository's `trainer/` folder, for weights arms. */
  trainerDir: string;
  /** Watch the local runtime during local locked tests: only within the owner's GPU window. */
  meter: boolean;
  parallel: number;
  commit: string | null;
  log(line: string): void;
  /** Where keys come from: the app's saved keys; the environment's variables when absent. */
  getSecret?(ref: string): Promise<string | undefined>;
  /** The Hugging Face token for training compute; Hugging Face's own lookup when absent. */
  huggingFaceToken?: () => Promise<string | undefined>;
}

/** A GGUF's chat template, by the sha256 of its text, read from the header alone. */
function chatTemplateOf(modelPath: string): string | null {
  const entry = readGgufHeader(modelPath).metadata.get('tokenizer.chat_template');
  if (entry?.type !== 'string') return null;
  return `sha256:${createHash('sha256').update(entry.value).digest('hex').slice(0, 16)} (the GGUF's own)`;
}

/** Ollama's version, from its own API on this computer; null when it doesn't answer. */
async function ollamaVersion(baseUrl: string): Promise<string | null> {
  try {
    const response = await fetch(new URL('/api/version', baseUrl), {
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === 'string' ? `Ollama ${body.version}` : null;
  } catch {
    return null;
  }
}

/**
 * What each backend is, read from its records and files: the hosted copy by its endpoint and the
 * provider it is pinned to, Spark by its model, and this computer's 2-bit build by its GGUF file in
 * Ollama's store, its chat template and the program serving it. Nothing loads a model.
 */
async function identify(backend: BackendId, job: Job): Promise<RuntimeIdentity | null> {
  const hosted = job.student.hosted;
  switch (backend) {
    case 'hosted': {
      if (hosted === undefined) return null;
      const providers = hosted.providers;
      return {
        model: hosted.model,
        provider:
          providers === undefined
            ? `${new URL(hosted.baseUrl).host}, any provider`
            : `${new URL(hosted.baseUrl).host}, pinned to ${providers.join(', ')} with no fallback`,
        runtime: hosted.runtime,
        quantization: providers?.includes('DeepInfra')
          ? "bf16, as DeepInfra's listing on OpenRouter says; not reported per call"
          : null,
        ggufSha256: null,
        runtimeBuild: null,
        chatTemplate: "the provider's own",
        contextLength: hosted.contextLength,
      };
    }
    case 'reference':
      if (job.mentor.kind !== 'model') return null;
      return {
        model: job.mentor.model,
        provider: new URL(job.mentor.baseUrl).host,
        runtime: job.mentor.provider,
        quantization: null,
        ggufSha256: null,
        runtimeBuild: null,
        chatTemplate: "the provider's own",
        contextLength: null,
      };
    case 'local-ollama':
    case 'local-llama.cpp': {
      const local = job.student.local;
      let file: ReturnType<typeof resolveOllamaModel>;
      try {
        file = resolveOllamaModel(local.model);
      } catch {
        return null;
      }
      const server = backend === 'local-llama.cpp' ? await describeLlamaServer() : null;
      return {
        model: local.model,
        provider:
          backend === 'local-ollama' ? 'Ollama on this computer' : 'llama-server on this computer',
        runtime: backend === 'local-ollama' ? 'ollama' : 'llama.cpp',
        quantization: null,
        ggufSha256: file.digest,
        runtimeBuild:
          backend === 'local-ollama'
            ? await ollamaVersion(local.baseUrl)
            : server?.build === undefined
              ? null
              : `b${server.build}`,
        chatTemplate:
          backend === 'local-ollama'
            ? "Ollama's renderer for Glimmer"
            : chatTemplateOf(file.modelPath),
        contextLength: local.contextLength,
      };
    }
  }
}

/** Whether an error is the lease's busy error: another process of the app has the GPU. */
function gpuBusy(error: unknown): boolean {
  return error instanceof LocalRuntimeError && error.code === 'gpu_busy';
}

/**
 * The real environment for a comparison: the engine's own dependencies with keys from the
 * environment, a training worker that uses Hugging Face Jobs when a token resolves, a llama-server
 * of its own for adapter students, and the system meter when the GPU window is granted. Its
 * llama-server and its students on Ollama take the GPU lease the app's processes share, and only
 * when the app has none of it (decision 046).
 */
export function realEnvironment(options: RealEnvironmentOptions): {
  env: ComparisonEnvironment;
  /** Stops the llama-server and leaves the GPU lease. */
  close(): Promise<void>;
} {
  const paths = new DataPaths(options.dataDir);
  const gpu = comparisonLease(options.appDataDir);
  const adapterRuntime = hostAdapterRuntime({
    runtimeDir: paths.runtimeDir('comparisons'),
    settings: () => ({}),
    gpu,
    purpose: COMPARISON_PURPOSE,
  });
  const token = options.huggingFaceToken ?? hubTokenResolver();
  const deps = studentsHolding(
    createEngineDeps({
      dataDir: options.dataDir,
      getSecret:
        options.getSecret ??
        (async (ref) => {
          const name = SECRET_ENV[ref];
          return name === undefined ? undefined : process.env[name] || undefined;
        }),
      trainerDir: options.trainerDir,
      huggingFaceToken: token,
      adapterRuntime,
    }),
    gpu,
    COMPARISON_PURPOSE,
  );
  const clear = clearBeforeColdStart(gpu, adapterRuntime, {
    baseUrl: OLLAMA_BASE_URL,
    models: STUDENT_PRESETS.filter((item) => item.runtime === 'ollama').map((item) => item.model),
  });
  if (options.meter) {
    // Either backend's cold start begins from a GPU with nothing of Architect's on it.
    deps.meter = systemMeter({ unload: { ollama: clear, 'llama.cpp': clear } });
  }
  return {
    close: async () => {
      await adapterRuntime.stop();
      await gpu.close();
    },
    env: {
      deps,
      clock: systemClock,
      writeHarness,
      identify,
      // A free GPU, through the lease: the busy error at once when the app has any of it. With no
      // server running, the hold leaves the lease as soon as it is released.
      checkGpu: async () => {
        const hold = await gpu.hold('llama-server', COMPARISON_PURPOSE);
        hold.release();
      },
      // When the GPU window closes (decision 051), through the lease, so nothing of the app's is
      // touched: when the app has the GPU, the script gave up what it had loaded before it could.
      releaseGpu: async () => {
        try {
          await clear();
        } catch (error) {
          if (!gpuBusy(error)) throw error;
        }
      },
      log: options.log,
      commit: options.commit,
      dryRun: false,
      parallel: options.parallel,
    },
  };
}
