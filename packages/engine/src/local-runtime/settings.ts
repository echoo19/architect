import { isLoopbackUrl, OLLAMA_BASE_URL, type StudentEndpoint } from '@architect/shared';
import { z } from 'zod';
import type { ServerCommand } from './binary';
import type { GpuLease } from './lease';
import type { GpuPurpose } from './lease-rules';
import { LocalAdapterRuntime } from './runtime';

/** A program, and the arguments that go before llama-server's own. */
export const ServerCommandSchema = z
  .object({ file: z.string().min(1), args: z.array(z.string()).readonly() })
  .strict() satisfies z.ZodType<ServerCommand>;

/** What a host's adapter runtime takes from the app's settings. It reads them at every start. */
export const LocalRuntimeSettingsSchema = z
  .object({
    /** The llama-server chosen in Settings: the program, or its folder. Absent: the one on PATH. */
    llamaServerPath: z.string().min(1).optional(),
    /** The quiet-mode CPU thread cap; absent leaves llama-server its own default. */
    threads: z.number().int().positive().optional(),
    /** The Ollama whose models are unloaded before llama-server starts. */
    ollamaUrl: z.url().optional(),
  })
  .strict();
export type LocalRuntimeSettings = z.infer<typeof LocalRuntimeSettingsSchema>;

/**
 * Quiet mode's CPU-thread cap for local models: a quarter of the logical cores, about half the
 * physical ones, and never fewer than two. Undefined when quiet mode is off, which leaves each
 * runtime its own default.
 */
export function quietThreadCap(quiet: boolean, logicalCores: number): number | undefined {
  return quiet ? Math.max(2, Math.round(logicalCores / 4)) : undefined;
}

/**
 * What a host's llama-server starts with, from the app's settings: the program chosen in
 * Settings, quiet mode's thread cap, and the Ollama to unload first. That Ollama is the default
 * student's, and only when it is on this computer: one elsewhere holds no GPU here, and the
 * runtime refuses to call it.
 */
export function runtimeSettingsOf(
  settings: {
    llamaServerPath?: string | undefined;
    defaultStudent: Pick<StudentEndpoint, 'runtime' | 'baseUrl'>;
  },
  threads: number | undefined,
): LocalRuntimeSettings {
  const student = settings.defaultStudent;
  const ollamaUrl = student.runtime === 'ollama' ? student.baseUrl : OLLAMA_BASE_URL;
  return {
    ...(settings.llamaServerPath === undefined
      ? {}
      : { llamaServerPath: settings.llamaServerPath }),
    ...(threads === undefined ? {} : { threads }),
    ...(isLoopbackUrl(ollamaUrl) ? { ollamaUrl } : {}),
  };
}

export interface HostRuntimeOptions {
  /**
   * This host's own folder for its server's key, process record and logs. Two hosts never share
   * one: each stops a server it finds there that answers to its key.
   */
  runtimeDir: string;
  settings: () => LocalRuntimeSettings;
  /** A stand-in llama-server for tests, run instead of finding the real one. */
  command?: ServerCommand;
  /**
   * The process's share of the machine-wide GPU lease (decision 046). Every process of the app
   * passes one; a test or a script without it coordinates with nothing.
   */
  gpu?: GpuLease;
  /** What the host's requests are for when a student names nothing else. */
  purpose?: GpuPurpose;
}

/**
 * The adapter runtime of one host (the workspace's agent host, the engine host, the CLI): one
 * llama-server of its own, stopped after 10 idle minutes (decision 035) or when another of
 * Architect's processes needs the GPU while it is idle (decision 046), following the settings at
 * every start.
 */
export function hostAdapterRuntime(options: HostRuntimeOptions): LocalAdapterRuntime {
  return new LocalAdapterRuntime({
    runtimeDir: options.runtimeDir,
    serverPath: () => options.settings().llamaServerPath,
    threads: () => options.settings().threads,
    ollamaUrl: () => options.settings().ollamaUrl,
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.gpu === undefined ? {} : { gpu: options.gpu }),
    ...(options.purpose === undefined ? {} : { purpose: options.purpose }),
  });
}
