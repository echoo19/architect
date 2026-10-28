import { z } from 'zod';
import type { ServerCommand } from './binary';
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

export interface HostRuntimeOptions {
  /**
   * This host's own folder for its server's key, process record and logs. Two hosts never share
   * one: each stops a server it finds there that answers to its key.
   */
  runtimeDir: string;
  settings: () => LocalRuntimeSettings;
  /** A stand-in llama-server for tests, run instead of finding the real one. */
  command?: ServerCommand;
}

/**
 * The adapter runtime of one host (the workspace's agent host, the engine host, the CLI): one
 * llama-server of its own, stopped after 10 idle minutes (decision 035), following the settings
 * at every start.
 */
export function hostAdapterRuntime(options: HostRuntimeOptions): LocalAdapterRuntime {
  return new LocalAdapterRuntime({
    runtimeDir: options.runtimeDir,
    serverPath: () => options.settings().llamaServerPath,
    threads: () => options.settings().threads,
    ollamaUrl: () => options.settings().ollamaUrl,
    ...(options.command === undefined ? {} : { command: options.command }),
  });
}
