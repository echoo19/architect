import { execFile } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { join } from 'node:path';
import { LocalRuntimeError } from './errors';

/**
 * The first llama.cpp release that runs Muse Glimmer (docs/MODELS.md). Every flag Architect
 * passes to llama-server is older than that.
 */
export const MIN_LLAMA_SERVER_BUILD = 10358;

/** How to start a server: its executable, and arguments that go before the server's own. */
export interface ServerCommand {
  file: string;
  /** Empty for llama-server itself; a script path when the executable is an interpreter (tests). */
  args: readonly string[];
}

export interface FoundServer {
  command: ServerCommand;
  /** Where it was found: the path in Settings, or the system PATH. */
  source: 'setting' | 'path';
}

export interface FindServerOptions {
  /** The path set in Settings: the executable, or the folder that holds it. */
  configured?: string | null;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
}

export function llamaServerFileName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'llama-server.exe' : 'llama-server';
}

function isRunnableFile(path: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    if (platform !== 'win32') accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** PATH, read the way the platform names it (Windows calls it Path and ignores case). */
function pathEntries(env: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const key =
    platform === 'win32' ? Object.keys(env).find((name) => name.toUpperCase() === 'PATH') : 'PATH';
  const value = key === undefined ? undefined : env[key];
  if (!value) return [];
  return value
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
    .filter((entry) => entry !== '');
}

/**
 * Finds llama-server: the path set in Settings when there is one, otherwise the first on PATH.
 * Nothing else is searched, so the app never depends on where one developer installed it.
 */
export function findLlamaServer(options: FindServerOptions = {}): FoundServer {
  const platform = options.platform ?? process.platform;
  const name = llamaServerFileName(platform);
  const configured = options.configured?.trim();
  if (configured) {
    let file = configured;
    try {
      if (statSync(configured).isDirectory()) file = join(configured, name);
    } catch {
      // Reported below as not found.
    }
    if (!isRunnableFile(file, platform)) {
      throw new LocalRuntimeError(
        'binary_not_found',
        `The llama-server set in Settings isn't at ${file}.`,
        'Choose the llama-server program from your llama.cpp folder in Settings, or clear the setting to use the one on PATH.',
      );
    }
    return { command: { file, args: [] }, source: 'setting' };
  }
  for (const directory of pathEntries(options.env ?? process.env, platform)) {
    const file = join(directory, name);
    if (isRunnableFile(file, platform)) return { command: { file, args: [] }, source: 'path' };
  }
  throw new LocalRuntimeError(
    'binary_not_found',
    "llama-server isn't installed, or isn't on PATH.",
    `Install llama.cpp (build ${MIN_LLAMA_SERVER_BUILD} or newer), then choose its llama-server in Settings or add its folder to PATH.`,
  );
}

export interface ServerVersion {
  build: number;
  /** The short commit the build reports, when it reports one. */
  commit: string | null;
}

/** Reads `version: 10472 (60eeeb6)` from what `--version` prints. */
export function parseServerVersion(output: string): ServerVersion | null {
  const match = /version:\s*b?(\d+)(?:\s*\(([0-9a-f]+)\))?/i.exec(output);
  if (!match?.[1]) return null;
  return { build: Number(match[1]), commit: match[2] ?? null };
}

/** Asks the server which build it is, and refuses one too old to run the model. */
export async function checkServerVersion(
  command: ServerCommand,
  timeoutMs = 30_000,
): Promise<ServerVersion> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile(
      command.file,
      [...command.args, '--version'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        const text = `${stdout}\n${stderr}`;
        // Some builds exit with a nonzero code after printing their version.
        if (error && parseServerVersion(text) === null) reject(error);
        else resolve(text);
      },
    );
  }).catch((error: unknown) => {
    throw new LocalRuntimeError(
      'binary_unusable',
      `llama-server at ${command.file} didn't start.`,
      "Check that the file is llama.cpp's llama-server for this computer, then choose it again in Settings.",
      { cause: error },
    );
  });
  const version = parseServerVersion(output);
  if (!version) {
    throw new LocalRuntimeError(
      'binary_unusable',
      `llama-server at ${command.file} didn't say which build it is.`,
      `Use an official llama.cpp release, build ${MIN_LLAMA_SERVER_BUILD} or newer.`,
    );
  }
  if (version.build < MIN_LLAMA_SERVER_BUILD) {
    throw new LocalRuntimeError(
      'binary_unusable',
      `llama-server is build ${version.build}, older than ${MIN_LLAMA_SERVER_BUILD}, the first that runs Muse Glimmer.`,
      `Update llama.cpp to build ${MIN_LLAMA_SERVER_BUILD} or newer.`,
    );
  }
  return version;
}
