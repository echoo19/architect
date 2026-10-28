import { createHash } from 'node:crypto';
import { unloadOllamaModel } from '@architect/adapters';
import { writeHarness } from '@architect/harness';
import { STUDENT_PRESETS, type BackendId, type Job, type RuntimeIdentity } from '@architect/shared';
import { readGgufHeader } from '../gguf';
import { createEngineDeps } from '../host/wiring';
import { hubTokenResolver } from '../hub';
import {
  describeLlamaServer,
  hostAdapterRuntime,
  resolveOllamaModel,
  type LocalAdapterRuntime,
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

export interface RealEnvironmentOptions {
  /** The comparison's data folder. */
  dataDir: string;
  /** The repository's `trainer/` folder, for weights arms. */
  trainerDir: string;
  /** Watch the local runtime during local locked tests: only within the owner's GPU window. */
  meter: boolean;
  parallel: number;
  commit: string | null;
  log(line: string): void;
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

/** Asks this computer's Ollama to unload every student build Architect knows, so the GPU is free. */
async function unloadOllamaStudents(): Promise<void> {
  for (const preset of STUDENT_PRESETS.filter((item) => item.runtime === 'ollama')) {
    await unloadOllamaModel('http://127.0.0.1:11434', preset.model).catch(() => undefined);
  }
}

/**
 * The real environment for a comparison: the engine's own dependencies with keys from the
 * environment, a training worker that uses Hugging Face Jobs when a token resolves, the engine's
 * llama-server for adapter students, and the system meter when the GPU window is granted.
 */
export function realEnvironment(options: RealEnvironmentOptions): {
  env: ComparisonEnvironment;
  adapterRuntime: LocalAdapterRuntime;
} {
  const paths = new DataPaths(options.dataDir);
  const adapterRuntime = hostAdapterRuntime({
    runtimeDir: paths.runtimeDir('comparisons'),
    settings: () => ({}),
  });
  const token = hubTokenResolver();
  const deps = createEngineDeps({
    dataDir: options.dataDir,
    getSecret: async (ref) => {
      const name = SECRET_ENV[ref];
      return name === undefined ? undefined : process.env[name] || undefined;
    },
    trainerDir: options.trainerDir,
    huggingFaceToken: token,
    adapterRuntime,
  });
  if (options.meter) {
    deps.meter = systemMeter({
      unload: {
        ollama: async () => {
          const ollama = 'http://127.0.0.1:11434';
          for (const preset of STUDENT_PRESETS.filter((item) => item.runtime === 'ollama')) {
            await unloadOllamaModel(ollama, preset.model).catch(() => undefined);
          }
        },
        'llama.cpp': () => adapterRuntime.stop(),
      },
    });
  }
  return {
    adapterRuntime,
    env: {
      deps,
      clock: systemClock,
      writeHarness,
      identify,
      // When the GPU window closes (decision 051): llama-server stops and Ollama lets go.
      releaseGpu: async () => {
        await adapterRuntime.stop();
        await unloadOllamaStudents();
      },
      log: options.log,
      commit: options.commit,
      dryRun: false,
      parallel: options.parallel,
    },
  };
}
