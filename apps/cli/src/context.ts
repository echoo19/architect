import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  createEngineDeps,
  createEngineHost,
  realEnvironment,
  type EngineHost,
} from '@architect/engine';
import { openLocalLibrary, type LocalLibrary } from '@architect/engine/graduates';
import { HF_ENDPOINT, HubClient, hubTokenResolver } from '@architect/engine/hub';
import { appDataDir, type LocalRuntimeSettings } from '@architect/engine/local-runtime';
import { CliError } from './exit';
import type { CliIo } from './io';
import { appRuntimeSettings } from './runtime-settings';
import { trainerDir } from './trainer';

/** What one command works with, opened when first needed and closed when it ends. */
export class CliContext {
  readonly dataDir: string;
  private opened: LocalLibrary | null = null;
  private hubClient: HubClient | null = null;
  private runtimeSettings: LocalRuntimeSettings | null = null;
  private engineHost: EngineHost | null = null;

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
    const { machine } = this.io;
    if (!options.create && !existsSync(join(this.dataDir, 'architect.db'))) {
      throw new CliError(
        'invalid_input',
        'no_data',
        `Architect has no agents in ${this.dataDir}.`,
        'Install one with `architect install`, or set ARCHITECT_USER_DATA to the folder the app uses.',
      );
    }
    // Installing into a folder named in ARCHITECT_USER_DATA that doesn't exist yet starts it.
    if (options.create) mkdirSync(this.dataDir, { recursive: true });
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
      ...(machine === undefined ? {} : { machine: () => machine }),
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

  /**
   * The engine on the app's data folder, for work on its runs: nothing the app left active
   * resumes here. A hosted model's key comes from the environment (`<PROVIDER>_API_KEY`).
   */
  async engine(): Promise<EngineHost> {
    if (this.engineHost) return this.engineHost;
    this.library();
    const { env } = this.io;
    // An experiment calls hosted models with keys from the environment and uses no GPU here.
    this.engineHost = await createEngineHost({
      dataDir: this.dataDir,
      recover: false,
      localRuntime: () => this.localRuntime(),
      experimentEnvironment:
        this.io.experimentEnvironment ??
        ((dataDir, log) =>
          realEnvironment({
            dataDir,
            appDataDir: this.dataDir,
            trainerDir: trainerDir(env),
            meter: false,
            parallel: 2,
            commit: null,
            log,
            getSecret: async (ref) => env[`${ref.toUpperCase()}_API_KEY`] || undefined,
            huggingFaceToken: hubTokenResolver({ env }),
          })),
      deps: createEngineDeps({
        dataDir: this.dataDir,
        getSecret: async (ref) => env[`${ref.toUpperCase()}_API_KEY`] || undefined,
        ...(this.io.sandboxEntryPath === undefined
          ? {}
          : { sandboxEntryPath: this.io.sandboxEntryPath }),
      }),
    });
    return this.engineHost;
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
    const engine = this.engineHost;
    this.opened = null;
    this.engineHost = null;
    await engine?.close();
    await opened?.close();
  }
}
