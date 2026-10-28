import { existsSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { openLocalLibrary, type LocalLibrary } from '@architect/engine/graduates';
import { HF_ENDPOINT, HubClient, hubTokenResolver } from '@architect/engine/hub';
import { appDataDir, type LocalRuntimeSettings } from '@architect/engine/local-runtime';
import { CliError } from './exit';
import type { CliIo } from './io';
import { appRuntimeSettings } from './runtime-settings';

/** What one command works with, opened when first needed and closed when it ends. */
export class CliContext {
  readonly dataDir: string;
  private opened: LocalLibrary | null = null;
  private hubClient: HubClient | null = null;
  private runtimeSettings: LocalRuntimeSettings | null = null;

  constructor(readonly io: CliIo) {
    this.dataDir = appDataDir(io.env);
  }

  /** A path the user typed, read against the folder they ran the command in. */
  path(typed: string): string {
    return isAbsolute(typed) ? typed : resolve(this.io.cwd, typed);
  }

  /**
   * The app's graduates. Only `install` may start a data folder that has none; every other
   * command says where it looked instead.
   */
  library(options: { create?: boolean } = {}): LocalLibrary {
    if (this.opened) return this.opened;
    if (!options.create && !existsSync(join(this.dataDir, 'architect.db'))) {
      throw new CliError(
        'invalid_input',
        'no_data',
        `Architect has no agents in ${this.dataDir}.`,
        'Install one with `architect install`, or set ARCHITECT_USER_DATA to the folder the app uses.',
      );
    }
    this.opened = openLocalLibrary({
      dataDir: this.dataDir,
      ...(this.io.sandboxEntryPath === undefined
        ? {}
        : { sandboxEntryPath: this.io.sandboxEntryPath }),
      runtime: {
        owner: 'cli',
        settings: () => this.localRuntime(),
        ...(this.io.llamaServerCommand === undefined
          ? {}
          : { command: this.io.llamaServerCommand }),
      },
    });
    return this.opened;
  }

  /**
   * What the app's settings say about local models, read once: the llama-server to use, quiet
   * mode's thread cap (for llama-server and for a local student alike), and which Ollama to ask
   * to let go of the GPU.
   */
  localRuntime(): LocalRuntimeSettings {
    this.runtimeSettings ??= appRuntimeSettings(this.dataDir);
    return this.runtimeSettings;
  }

  /** The Hub at HF_ENDPOINT (huggingface.co by default), with HF_TOKEN or the token file. */
  hub(): HubClient {
    this.hubClient ??= new HubClient({
      endpoint: this.io.env['HF_ENDPOINT'] || HF_ENDPOINT,
      token: hubTokenResolver({ env: this.io.env }),
    });
    return this.hubClient;
  }

  /** Stops this command's llama-server, if it started, so none outlives it; closes the store. */
  async close(): Promise<void> {
    const opened = this.opened;
    this.opened = null;
    await opened?.close();
  }
}
