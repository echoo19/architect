import { ServerCommandSchema, type ServerCommand } from '@architect/engine';

/** Launch switches read from the environment. */
export interface LaunchOptions {
  /** Create windows hidden (tests and screenshots). Set with ARCHITECT_HIDDEN=1. */
  hidden: boolean;
  /** A separate profile folder, e.g. for tests. Set with ARCHITECT_USER_DATA. */
  userDataDir?: string;
  /** The renderer dev server, set by electron-vite in development. */
  devServerUrl?: string;
  /**
   * A stand-in for llama-server, run in its place by every host (tests): a program and the
   * arguments before llama-server's own, as JSON `{ "file", "args" }`. Set with
   * ARCHITECT_LLAMA_SERVER_COMMAND; never in normal use.
   */
  llamaServerCommand?: ServerCommand;
}

export function readLaunchOptions(env: NodeJS.ProcessEnv): LaunchOptions {
  const options: LaunchOptions = { hidden: env.ARCHITECT_HIDDEN === '1' };
  if (env.ARCHITECT_USER_DATA) options.userDataDir = env.ARCHITECT_USER_DATA;
  if (env.ELECTRON_RENDERER_URL) options.devServerUrl = env.ELECTRON_RENDERER_URL;
  const command = env.ARCHITECT_LLAMA_SERVER_COMMAND;
  if (command) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(command);
    } catch (error) {
      throw new Error('ARCHITECT_LLAMA_SERVER_COMMAND must be JSON: { "file", "args" }.', {
        cause: error,
      });
    }
    options.llamaServerCommand = ServerCommandSchema.parse(parsed);
  }
  return options;
}
