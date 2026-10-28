import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { openLocalLibrary, type LocalLibrary } from '@architect/engine/graduates';
import { HF_ENDPOINT, HubClient, hubTokenResolver } from '@architect/engine/hub';
import { CliError } from './exit';
import type { CliIo } from './io';

/**
 * The app's data folder, found the way the desktop app finds it: ARCHITECT_USER_DATA when set,
 * else Electron's `userData` folder for an app called Architect.
 */
export function appDataDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  const override = env['ARCHITECT_USER_DATA'];
  if (override) return resolve(override);
  if (platform === 'win32') {
    return join(env['APPDATA'] || join(home, 'AppData', 'Roaming'), 'Architect');
  }
  if (platform === 'darwin') return join(home, 'Library', 'Application Support', 'Architect');
  return join(env['XDG_CONFIG_HOME'] || join(home, '.config'), 'Architect');
}

/** What one command works with, opened when first needed and closed when it ends. */
export class CliContext {
  readonly dataDir: string;
  private opened: LocalLibrary | null = null;
  private hubClient: HubClient | null = null;

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
    });
    return this.opened;
  }

  /** The Hub at HF_ENDPOINT (huggingface.co by default), with HF_TOKEN or the token file. */
  hub(): HubClient {
    this.hubClient ??= new HubClient({
      endpoint: this.io.env['HF_ENDPOINT'] || HF_ENDPOINT,
      token: hubTokenResolver({ env: this.io.env }),
    });
    return this.hubClient;
  }

  close(): void {
    this.opened?.close();
    this.opened = null;
  }
}
