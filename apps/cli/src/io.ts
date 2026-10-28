import type { Readable } from 'node:stream';
import type { ServerCommand } from '@architect/engine/local-runtime';

/** Where text goes. `write` returns once the text is handed over. */
export interface Output {
  write(text: string): void;
}

/**
 * Everything the command touches outside itself, so tests can run it in-process: the standard
 * streams, the environment, the working folder, interrupts, and the network guard.
 */
export interface CliIo {
  /** Results only: an answer, a table, or a JSON document. */
  stdout: Output;
  /** Progress, steps and messages. */
  stderr: Output;
  stdin: Readable;
  /** Whether stdin is a terminal someone types into, so an approval can be asked there. */
  terminal: boolean;
  env: NodeJS.ProcessEnv;
  /** The folder relative paths are read against. */
  cwd: string;
  /** Calls `listener` when Ctrl+C is pressed or the process is asked to stop. */
  onInterrupt(listener: () => void): () => void;
  /**
   * Makes the process refuse every connection that isn't to this computer, as the workspace's
   * agent host does, before a graduate loads. It can't be undone.
   */
  installGuard(): void;
  /** The tool sandbox's child entry, when the command runs from a bundle. */
  sandboxEntryPath?: string;
  /** A stand-in llama-server, run instead of finding the real one. Only tests set it. */
  llamaServerCommand?: ServerCommand;
}

/** Sets up interrupts for one command: a controller that aborts on the first Ctrl+C. */
export function interrupts(io: CliIo): { signal: AbortSignal; dispose(): void } {
  const controller = new AbortController();
  const dispose = io.onInterrupt(() => controller.abort(new Error('Interrupted.')));
  return { signal: controller.signal, dispose };
}
