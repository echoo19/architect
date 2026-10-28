import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  addGraduate,
  openEngineStore,
  startFakeOllama,
  STATED_MACHINE,
  THIS_MACHINE,
  type FakeOllama,
  type GraduateFixture,
  type GraduateOptions,
  type ScriptedTurn,
} from '@architect/engine/testing';
import { runCli } from '../src/cli';
import type { CliIo } from '../src/io';

export const CLI_BIN = fileURLToPath(new URL('../bin/architect.mjs', import.meta.url));

const cleanups: (() => Promise<void>)[] = [];

/** Runs every cleanup registered since the last call, newest first. */
export async function cleanUp(): Promise<void> {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
}

export async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `architect-cli-${prefix}-`));
  cleanups.push(() => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }));
  return dir;
}

/**
 * An environment that points the command at a data folder of the test's own, and at a Hugging
 * Face folder with no token, so it never reads the developer's.
 */
export async function testEnv(extra: Record<string, string> = {}): Promise<NodeJS.ProcessEnv> {
  const dataDir = await tempDir('data');
  const hfHome = await tempDir('hf');
  return { ARCHITECT_USER_DATA: dataDir, HF_HOME: hfHome, ...extra };
}

export interface Machine {
  env: NodeJS.ProcessEnv;
  dataDir: string;
  model: FakeOllama;
  graduate: GraduateFixture;
}

/** A computer with Architect's data folder holding one graduate, whose model plays `script`. */
export async function machineWith(
  script: ScriptedTurn[],
  options: Partial<Omit<GraduateOptions, 'id' | 'baseUrl'>> = {},
): Promise<Machine> {
  const env = await testEnv();
  const dataDir = env['ARCHITECT_USER_DATA'] ?? '';
  await mkdir(dataDir, { recursive: true });
  const model = await startFakeOllama(script);
  cleanups.push(() => model.close());
  const store = openEngineStore(join(dataDir, 'architect.db'));
  try {
    const graduate = await addGraduate(dataDir, store, {
      id: 'grd_desk',
      baseUrl: model.url,
      ...options,
    });
    return { env, dataDir, model, graduate };
  } finally {
    store.close();
  }
}

export interface Captured {
  code: number;
  stdout: string;
  stderr: string;
  guards: number;
}

export interface InProcessOptions {
  env: NodeJS.ProcessEnv;
  cwd?: string;
  /** What stdin holds: text, or a stream the test writes to. */
  stdin?: string | Readable;
  terminal?: boolean;
  /** Called with a function that presses Ctrl+C, once the command is running. */
  interruptWith?(press: () => void): void;
  /** Called with stdout so far whenever it grows. */
  onStdout?(text: string): void;
  onStderr?(text: string): void;
  /** A stand-in llama-server for versions with an adapter. */
  llamaServerCommand?: CliIo['llamaServerCommand'];
  /** The computer the installation checks see: THIS_MACHINE unless a test names another. */
  machine?: CliIo['machine'];
}

/**
 * Runs the command in this process with captured streams and a counting stand-in for the guard,
 * on THIS_MACHINE (or the computer a test names) rather than the one running the tests.
 */
export async function cli(argv: string[], options: InProcessOptions): Promise<Captured> {
  let stdout = '';
  let stderr = '';
  let guards = 0;
  const listeners = new Set<() => void>();
  const stdin =
    options.stdin === undefined
      ? Readable.from([])
      : typeof options.stdin === 'string'
        ? Readable.from([options.stdin])
        : options.stdin;
  const io: CliIo = {
    stdout: {
      write(text) {
        stdout += text;
        options.onStdout?.(stdout);
      },
    },
    stderr: {
      write(text) {
        stderr += text;
        options.onStderr?.(stderr);
      },
    },
    stdin,
    terminal: options.terminal ?? false,
    env: options.env,
    cwd: options.cwd ?? process.cwd(),
    onInterrupt(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    installGuard() {
      guards += 1;
    },
    ...(options.llamaServerCommand === undefined
      ? {}
      : { llamaServerCommand: options.llamaServerCommand }),
    machine: options.machine ?? THIS_MACHINE,
  };
  options.interruptWith?.(() => {
    for (const listener of listeners) listener();
  });
  const code = await runCli(argv, io);
  return { code, stdout, stderr, guards };
}

/** A stream to type into, as a person at a terminal would. */
export function keyboard(): PassThrough {
  return new PassThrough();
}

export interface Spawned {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the real `architect` process, as `pnpm architect` does, with only the given environment.
 * It is on the computer running the tests unless `machine` names another for its installation
 * checks, which a test that depends on them does.
 */
export function spawnCli(
  argv: string[],
  options: {
    env: NodeJS.ProcessEnv;
    cwd?: string;
    stdin?: string;
    execArgv?: string[];
    machine?: CliIo['machine'];
  },
): Promise<Spawned> {
  const { machine } = options;
  const execArgv = [
    ...(machine === undefined ? [] : ['--import', 'tsx', '--import', STATED_MACHINE]),
    ...(options.execArgv ?? []),
  ];
  const env =
    machine === undefined
      ? options.env
      : { ...options.env, ARCHITECT_TEST_MACHINE: JSON.stringify(machine) };
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [...execArgv, CLI_BIN, ...argv], {
      cwd: options.cwd ?? process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(options.stdin ?? '');
  });
}
