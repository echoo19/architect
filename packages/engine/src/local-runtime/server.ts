import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  type WriteStream,
} from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { AdapterError } from '@architect/shared';
import { z } from 'zod';
import type { ServerCommand } from './binary';
import { writeFileAtomic } from '../data/atomic-write';
import { LocalRuntimeError } from './errors';
import { findFreePort } from './gpu';
import { isAlive } from './pids';

/** What one llama-server process is started with. Two launches that are equal share a process. */
export interface LlamaServerLaunch {
  command: ServerCommand;
  /** The base model's GGUF file. */
  modelPath: string;
  /** The model name the server answers to. */
  alias: string;
  /**
   * GGUF LoRA adapters. They load with scale 0, and each request sets every scale by position,
   * so one server measures a candidate with and without its adapter.
   */
  adapters: readonly string[];
  /**
   * What each adapter file holds, in the same order: its sha256, or its size and time when no
   * sha256 is known. A file replaced at the same path makes another launch, so the server
   * restarts instead of serving the adapter it loaded before.
   */
  adapterFiles?: readonly string[];
  contextSize: number;
  gpuLayers: number;
  /** The quiet-mode CPU thread cap; the server's own default when absent. */
  threads?: number;
}

export interface LlamaServerOptions {
  /** Where the server's key, its process record and its logs go, under the app's data folder. */
  runtimeDir: string;
  /** Stop after this long with no request in flight. Default 10 minutes. */
  idleStopMs?: number;
  /** The longest the model may take to load. Default 5 minutes. */
  startupTimeoutMs?: number;
  /** Runs before every start; the runtime frees the GPU from Ollama's models here. */
  beforeStart?: (signal?: AbortSignal) => Promise<void>;
  /** Log lines kept in memory for error messages. Default 200. */
  keepLines?: number;
  /** Log files kept on disk, newest first. Default 5. */
  keepLogFiles?: number;
}

export type ServerState = 'stopped' | 'starting' | 'ready' | 'stopping';

export interface ServerStatus {
  state: ServerState;
  pid: number | null;
  port: number | null;
  startedAt: string | null;
  /** Why the last start, or the last run, ended badly. */
  lastError: string | null;
  logFile: string | null;
}

export interface RunningServer {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  apiKey: string;
  /** The adapters in load order: a request's `lora` ids index this list. */
  adapters: readonly string[];
}

const RecordSchema = z.object({
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  apiKey: z.string().min(1),
  startedAt: z.string(),
});

const LoraListSchema = z.array(z.object({ id: z.number().int(), path: z.string() }));

const PORT_TAKEN = /couldn't bind|failed to bind|address already in use|bind failed/i;
const OUT_OF_MEMORY =
  /out of memory|cudaMalloc failed|failed to allocate|unable to allocate|OutOfDeviceMemory/i;
/** llama.cpp's words when it refuses an adapter (llama-adapter.cpp and common). */
const ADAPTER_FAILED =
  /failed to load lora|lora tensor|lora arch|lora_a tensor|incorrect shape|expect general\.type to be 'adapter'|expect adapter\.type/i;
const MODEL_FAILED =
  /failed to load model|error loading model|unknown model architecture|gguf_init/i;

class PortTaken extends Error {}

/** The flags Architect starts llama-server with. Every adapter loads unapplied. */
export function serverArgs(
  launch: LlamaServerLaunch,
  port: number,
  keyFile: string,
  sleepSeconds: number,
): string[] {
  const args = [
    '--model',
    launch.modelPath,
    '--alias',
    launch.alias,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--api-key-file',
    keyFile,
    '--jinja',
    '--n-gpu-layers',
    String(launch.gpuLayers),
    '--ctx-size',
    String(launch.contextSize),
    '--parallel',
    '1',
    '--no-webui',
    '--offline',
    // A backstop for a server this app can no longer stop: it unloads the model when idle.
    '--sleep-idle-seconds',
    String(sleepSeconds),
  ];
  for (const adapter of launch.adapters) args.push('--lora', adapter);
  if (launch.adapters.length > 0) args.push('--lora-init-without-apply');
  if (launch.threads !== undefined) {
    args.push('--threads', String(launch.threads), '--threads-batch', String(launch.threads));
  }
  return args;
}

function fingerprintOf(launch: LlamaServerLaunch): string {
  return createHash('sha256').update(JSON.stringify(launch)).digest('hex');
}

/** The environment without llama.cpp's own `LLAMA_ARG_*` defaults, which would change the launch. */
function serverEnv(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith('LLAMA_ARG_')),
  );
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);

/** The record of the process a server folder last started: where it listens, and its key. */
const RECORD_FILE = 'server.json';

/**
 * Stops a llama-server that a process left running in `runtimeDir`, and waits until it has gone.
 * Only a server that answers to the key its folder's record names is Architect's to stop: a port
 * reused by another program, or a key that no longer answers, leaves everything as it is. The
 * next start in the same folder calls this, and so does a process that takes the GPU over from a
 * holder that died (decision 046).
 */
export async function stopServerLeftIn(runtimeDir: string): Promise<void> {
  let saved: z.infer<typeof RecordSchema>;
  try {
    saved = RecordSchema.parse(JSON.parse(await readFile(join(runtimeDir, RECORD_FILE), 'utf8')));
  } catch {
    return;
  }
  try {
    const response = await fetch(`http://127.0.0.1:${saved.port}/lora-adapters`, {
      headers: { authorization: `Bearer ${saved.apiKey}` },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return;
    process.kill(saved.pid);
  } catch {
    // Nothing answers there with that key, or it has just gone: nothing of ours is left to stop.
    return;
  }
  const deadline = Date.now() + 10_000;
  while (isAlive(saved.pid) && Date.now() < deadline) {
    await new Promise((done) => setTimeout(done, 100));
  }
}

/**
 * One llama-server process on 127.0.0.1, started when a student needs it and stopped when it has
 * been idle for a while. It answers only requests that carry the key it was started with, so a
 * web page in a browser on the same computer can't use it.
 */
export class LlamaServer {
  private readonly idleStopMs: number;
  private readonly startupTimeoutMs: number;
  private child: ChildProcess | null = null;
  private running: RunningServer | null = null;
  private fingerprint: string | null = null;
  private starting: {
    fingerprint: string;
    promise: Promise<RunningServer>;
    abort: AbortController;
  } | null = null;
  private stopping: Promise<void> | null = null;
  private state: ServerState = 'stopped';
  /** Requests in flight; the server neither idles out nor restarts under one. */
  private holds = 0;
  /** Stop as soon as the last request in flight ends, not after an idle spell. */
  private stopWhenReleased = false;
  private idleTimer: NodeJS.Timeout | null = null;
  private lines: string[] = [];
  private log: WriteStream | null = null;
  private logFile: string | null = null;
  private lastError: string | null = null;
  private port: number | null = null;
  private startedAt: string | null = null;
  private reaped = false;
  private exitHook: (() => void) | null = null;
  /** The key this manager last gave a server; its files are removed only while they hold it. */
  private ownKey: string | null = null;

  constructor(private readonly options: LlamaServerOptions) {
    this.idleStopMs = options.idleStopMs ?? 10 * 60_000;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 5 * 60_000;
  }

  private get recordFile(): string {
    return join(this.options.runtimeDir, RECORD_FILE);
  }

  private get keyFile(): string {
    return join(this.options.runtimeDir, 'server.key');
  }

  status(): ServerStatus {
    return {
      state: this.state,
      pid: this.child?.pid ?? null,
      port: this.port,
      startedAt: this.startedAt,
      lastError: this.lastError,
      logFile: this.logFile,
    };
  }

  recentLog(): string[] {
    return [...this.lines];
  }

  /**
   * The running server for this launch: started if none runs, reused if one runs with the same
   * launch, restarted if one runs with another launch and no request is in flight.
   */
  ensure(launch: LlamaServerLaunch, signal?: AbortSignal): Promise<RunningServer> {
    return this.obtain(launch, signal, false);
  }

  /**
   * The running server for this launch, held for one request: it neither idles out nor restarts
   * for another launch until `release` is called. The hold is taken in the same step that hands
   * the server over, so nothing can stop it in between.
   */
  async acquire(
    launch: LlamaServerLaunch,
    signal?: AbortSignal,
  ): Promise<{ server: RunningServer; release: () => void }> {
    const server = await this.obtain(launch, signal, true);
    return { server, release: this.releaser() };
  }

  /** Holds the running server, as `acquire` does, for a caller that already has it. */
  hold(): () => void {
    if (!this.running || this.state !== 'ready') {
      throw new LocalRuntimeError(
        'start_failed',
        'The local model server is not running.',
        'Try again; the next request starts it.',
      );
    }
    this.holds += 1;
    this.clearIdle();
    return this.releaser();
  }

  /** Stops the server now, which frees the GPU. A start under way is called off. */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.clearIdle();
    this.stopWhenReleased = false;
    const starting = this.starting;
    if (!starting && !this.child) return Promise.resolve();
    this.stopping = (async () => {
      try {
        if (starting) {
          starting.abort.abort();
          await starting.promise.catch(() => undefined);
        }
        const child = this.child;
        if (child) {
          this.state = 'stopping';
          await terminate(child);
        }
      } finally {
        this.cleanUp();
        this.stopping = null;
      }
    })();
    return this.stopping;
  }

  /** Stops the server once no request is in flight: now, if none is. */
  stopWhenIdle(): Promise<void> {
    if (this.holds === 0) return this.stop();
    this.stopWhenReleased = true;
    return Promise.resolve();
  }

  private releaser(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds -= 1;
      if (this.holds > 0) return;
      if (!this.stopWhenReleased) {
        this.armIdle();
        return;
      }
      this.stop().catch((error: unknown) => {
        this.lastError = `Stopping the server failed: ${String(error)}`;
      });
    };
  }

  private async obtain(
    launch: LlamaServerLaunch,
    signal: AbortSignal | undefined,
    hold: boolean,
  ): Promise<RunningServer> {
    const fingerprint = fingerprintOf(launch);
    for (;;) {
      if (signal?.aborted) throw aborted();
      if (this.stopping) {
        await this.stopping;
        continue;
      }
      const starting = this.starting;
      if (starting) {
        try {
          await settleOrAbort(starting.promise, signal);
        } catch (error) {
          // A failed start of this launch is this caller's failure too; another launch's isn't.
          if (starting.fingerprint === fingerprint || signal?.aborted) throw error;
        }
        continue;
      }
      if (this.running && this.state === 'ready') {
        if (this.fingerprint === fingerprint) {
          if (hold) {
            this.holds += 1;
            this.clearIdle();
          } else if (this.holds === 0) {
            this.armIdle();
          }
          return this.running;
        }
        if (this.holds > 0) {
          throw new LocalRuntimeError(
            'busy',
            'The local model server is answering another request with other adapters.',
            'Wait for the current reply to finish, then try again.',
          );
        }
        await this.stop();
        continue;
      }
      this.begin(launch, fingerprint);
    }
  }

  /**
   * Starts the server in the background. Every caller waits for the start the same way, and none
   * of their signals can call it off for the others: only `stop` can.
   */
  private begin(launch: LlamaServerLaunch, fingerprint: string): void {
    const abort = new AbortController();
    const promise = this.start(launch, fingerprint, abort.signal);
    const entry = { fingerprint, promise, abort };
    this.starting = entry;
    void promise
      .then(
        () => {
          if (this.holds === 0) this.armIdle();
        },
        () => undefined,
      )
      .finally(() => {
        if (this.starting === entry) this.starting = null;
      });
  }

  private armIdle(): void {
    this.clearIdle();
    if (this.state !== 'ready') return;
    this.idleTimer = setTimeout(() => {
      this.stop().catch((error: unknown) => {
        this.lastError = `Stopping the idle server failed: ${String(error)}`;
      });
    }, this.idleStopMs);
    this.idleTimer.unref();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private cleanUp(): void {
    this.clearIdle();
    if (this.exitHook) process.off('exit', this.exitHook);
    this.exitHook = null;
    this.child = null;
    this.running = null;
    this.fingerprint = null;
    this.port = null;
    this.startedAt = null;
    this.state = 'stopped';
    this.log?.end();
    this.log = null;
    this.removeOwnFiles();
  }

  /**
   * Removes the key and process record this manager wrote, and only those: after a restart they
   * may already belong to the next process.
   */
  private removeOwnFiles(): void {
    const key = this.ownKey;
    this.ownKey = null;
    if (key === null) return;
    const read = (file: string) => {
      try {
        return readFileSync(file, 'utf8');
      } catch {
        return null;
      }
    };
    if (read(this.keyFile)?.trim() === key) rmSync(this.keyFile, { force: true });
    let saved: unknown = null;
    try {
      saved = JSON.parse(read(this.recordFile) ?? 'null');
    } catch {
      // Not a record this manager wrote.
    }
    const record = RecordSchema.safeParse(saved);
    if (record.success && record.data.apiKey === key) rmSync(this.recordFile, { force: true });
  }

  /** Stops a child that never became the running server, and forgets it. */
  private async discard(child: ChildProcess): Promise<void> {
    await terminate(child);
    if (this.child === child) this.cleanUp();
  }

  private record(line: string): void {
    this.lines.push(line);
    const keep = this.options.keepLines ?? 200;
    if (this.lines.length > keep) this.lines.splice(0, this.lines.length - keep);
    this.log?.write(`${line}\n`);
  }

  /**
   * A server a crashed app left running holds the GPU. If it answers to the key this app saved
   * for it, it is ours: stop it and wait until it has gone.
   */
  private async reapOrphan(): Promise<void> {
    await stopServerLeftIn(this.options.runtimeDir);
    rmSync(this.recordFile, { force: true });
  }

  private async start(
    launch: LlamaServerLaunch,
    fingerprint: string,
    signal: AbortSignal,
  ): Promise<RunningServer> {
    this.clearIdle();
    this.state = 'starting';
    this.lastError = null;
    try {
      for (const adapter of launch.adapters) {
        if (adapter.includes(',')) {
          throw new LocalRuntimeError(
            'adapter_unusable',
            `The adapter's path has a comma in it, which llama-server reads as a list: ${adapter}`,
            'Move the app data folder to a path without commas.',
          );
        }
      }
      mkdirSync(join(this.options.runtimeDir, 'logs'), { recursive: true });
      if (!this.reaped) {
        this.reaped = true;
        await this.reapOrphan();
      }
      await this.options.beforeStart?.(signal);
      if (signal.aborted) throw aborted();
      for (let attempt = 1; ; attempt++) {
        this.state = 'starting';
        try {
          const running = await this.launchOnce(launch, signal);
          this.fingerprint = fingerprint;
          return running;
        } catch (error) {
          if (!(error instanceof PortTaken) || attempt === 3) throw error;
        }
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      const child = this.child;
      if (child) await terminate(child);
      this.cleanUp();
      throw error instanceof PortTaken
        ? new LocalRuntimeError(
            'start_failed',
            'llama-server could not get a port on 127.0.0.1.',
            'Close programs that hold many local ports, then try again.',
            { log: this.recentLog().slice(-8) },
          )
        : error;
    }
  }

  private openLog(): string {
    const dir = join(this.options.runtimeDir, 'logs');
    const keep = this.options.keepLogFiles ?? 5;
    const old = readdirSync(dir)
      .filter((name) => name.startsWith('llama-server-') && name.endsWith('.log'))
      .sort()
      .reverse();
    for (const name of old.slice(Math.max(0, keep - 1))) rmSync(join(dir, name), { force: true });
    const file = join(dir, `llama-server-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
    this.log = createWriteStream(file, { flags: 'a' });
    this.logFile = file;
    this.lines = [];
    return file;
  }

  private async launchOnce(launch: LlamaServerLaunch, signal: AbortSignal): Promise<RunningServer> {
    const port = await findFreePort();
    // A fresh key for every process, kept in a file so it never shows in a process list.
    const apiKey = randomBytes(24).toString('hex');
    this.ownKey = apiKey;
    await writeFile(this.keyFile, `${apiKey}\n`, { mode: 0o600 });
    const sleepSeconds = Math.ceil(this.idleStopMs / 1000) + 60;
    const args = [...launch.command.args, ...serverArgs(launch, port, this.keyFile, sleepSeconds)];
    this.openLog();
    this.record(`# ${new Date().toISOString()} ${launch.command.file} ${args.join(' ')}`);

    const child = spawn(launch.command.file, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: serverEnv(),
    });
    this.child = child;
    this.port = port;
    this.startedAt = new Date().toISOString();
    const kill = () => child.kill();
    this.exitHook = kill;
    process.on('exit', kill);
    for (const stream of [child.stdout, child.stderr]) {
      let partial = '';
      stream?.setEncoding('utf8');
      stream?.on('data', (chunk: string) => {
        const pieces = (partial + chunk).split(/\r?\n/);
        partial = pieces.pop() ?? '';
        for (const line of pieces) if (line.trim() !== '') this.record(line);
      });
    }
    const exited = new Promise<string>((done) => {
      child.once('error', (error) => done(`it could not be started: ${error.message}`));
      child.once('exit', (code, killedBy) =>
        done(killedBy ? `it was stopped by ${killedBy}` : `it exited with code ${code ?? 'none'}`),
      );
    });
    if (child.pid !== undefined) {
      writeFileAtomic(
        this.recordFile,
        JSON.stringify({ pid: child.pid, port, apiKey, startedAt: this.startedAt }),
      );
    }

    const url = `http://127.0.0.1:${port}`;
    const outcome = await this.waitUntilReady(url, exited, signal);
    if (outcome.kind !== 'ready') {
      await this.discard(child);
      throw this.startFailure(outcome);
    }

    const adapters = await this.loadedAdapters(url, apiKey);
    const missing = launch.adapters.filter(
      (path, id) => !adapters.some((entry) => entry.id === id && samePath(entry.path, path)),
    );
    if (missing.length > 0 || adapters.length !== launch.adapters.length) {
      await this.discard(child);
      throw new LocalRuntimeError(
        'adapter_unusable',
        'llama-server did not load the adapters it was given.',
        'Check the adapter files, then try again.',
        { log: this.recentLog().slice(-8) },
      );
    }
    if (signal.aborted) {
      await this.discard(child);
      throw aborted();
    }

    this.running = { url, apiKey, adapters: [...launch.adapters] };
    this.state = 'ready';
    void exited.then((how) => {
      // A stop this app asked for is not news.
      if (this.child !== child || this.state === 'stopping') return;
      this.lastError = `The local model server stopped on its own: ${how}.`;
      this.cleanUp();
    });
    return this.running;
  }

  private async loadedAdapters(url: string, apiKey: string) {
    const response = await fetch(`${url}/lora-adapters`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return [];
    const parsed = LoraListSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : [];
  }

  private async waitUntilReady(
    url: string,
    exited: Promise<string>,
    signal?: AbortSignal,
  ): Promise<
    { kind: 'ready' } | { kind: 'exited'; how: string } | { kind: 'timeout' } | { kind: 'aborted' }
  > {
    const end: { how: string | null } = { how: null };
    void exited.then((how) => {
      end.how = how;
    });
    const deadline = Date.now() + this.startupTimeoutMs;
    for (;;) {
      if (end.how !== null) return { kind: 'exited', how: end.how };
      if (signal?.aborted) return { kind: 'aborted' };
      if (Date.now() >= deadline) return { kind: 'timeout' };
      try {
        const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(2000) });
        if (response.ok) {
          const body = (await response.json()) as { status?: unknown };
          if (body.status === 'ok') return { kind: 'ready' };
        }
      } catch {
        // Not listening yet.
      }
      await Promise.race([new Promise((done) => setTimeout(done, 200)), exited]);
    }
  }

  private startFailure(
    outcome: { kind: 'exited'; how: string } | { kind: 'timeout' } | { kind: 'aborted' },
  ): Error {
    const log = this.recentLog().slice(-8);
    // Only the server's own lines count; the first line is the command this app ran.
    const text = this.recentLog()
      .filter((line) => !line.startsWith('# '))
      .join('\n');
    if (outcome.kind === 'aborted') {
      return aborted();
    }
    if (outcome.kind === 'timeout') {
      return new LocalRuntimeError(
        'start_failed',
        `llama-server did not become ready within ${Math.round(this.startupTimeoutMs / 1000)} seconds.`,
        'Close other programs that use the GPU or memory, then try again.',
        { log },
      );
    }
    if (PORT_TAKEN.test(text)) return new PortTaken(text);
    if (OUT_OF_MEMORY.test(text)) {
      return new LocalRuntimeError(
        'out_of_memory',
        "The model doesn't fit in the memory that's free.",
        'Close other programs that use the GPU, or choose a smaller build of the model.',
        { log },
      );
    }
    if (ADAPTER_FAILED.test(text)) {
      return new LocalRuntimeError(
        'adapter_unusable',
        'llama-server refused the adapter.',
        'The adapter may be for another build of the model. Train it again for this one.',
        { log },
      );
    }
    if (MODEL_FAILED.test(text)) {
      return new LocalRuntimeError(
        'model_unusable',
        "llama-server couldn't load the model.",
        'Update llama.cpp, or reinstall the model in Settings › Models.',
        { log },
      );
    }
    return new LocalRuntimeError(
      'start_failed',
      `llama-server stopped before it was ready: ${outcome.how}.`,
      'Check the server log below, then try again.',
      { log },
    );
  }
}

function exitWithin(child: ChildProcess, ms: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((done) => {
    const timer = setTimeout(() => done(false), ms);
    child.once('exit', () => {
      clearTimeout(timer);
      done(true);
    });
  });
}

/** Ends a child process, politely and then for good. One that never started has nothing to end. */
async function terminate(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  if (!(await exitWithin(child, 5000))) {
    child.kill('SIGKILL');
    await exitWithin(child, 5000);
  }
}

const aborted = () => new AdapterError('aborted', 'Starting the local model server was stopped.');

/** Waits for a promise, or rejects as soon as the signal aborts; the promise itself runs on. */
function settleOrAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(aborted());
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
