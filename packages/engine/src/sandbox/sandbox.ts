import { fork, type ChildProcess } from 'node:child_process';
import { dirname, extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { JsonValueSchema, type HarnessTool, type JsonValue } from '@architect/shared';
import type { Row, TableSnapshot } from '../data/types';
import {
  ChildMessageSchema,
  contentHash,
  type ChildMessage,
  type ChildOutcome,
  type Limits,
  type RunRequest,
  type SandboxFailure,
  type SandboxJob,
} from './protocol';
import type { Sandbox, SandboxData, SandboxOutcome, ValidatorContext } from './types';

export const DEFAULT_TIMEOUT_MS = 2_000;
export const DEFAULT_MEMORY_LIMIT_BYTES = 64 * 1024 * 1024;
/** How long past a job's own time limit the engine waits before it treats the child as hung. */
const WATCHDOG_GRACE_MS = 2_000;
/** Generous because a TypeScript entry is compiled on start, which is slow on a busy machine. */
const START_TIMEOUT_MS = 20_000;
const STOP_TIMEOUT_MS = 2_000;
const STDERR_TAIL_CHARS = 2_000;

export interface SandboxOptions {
  /**
   * The child process entry. Defaults to `child.ts` (run through tsx) or `child.js` next to this
   * module; a bundled app passes its built entry here.
   */
  entryPath?: string;
  /** Time limit for each tool call or validator run. */
  timeoutMs?: number;
  /** Memory limit for each run's QuickJS heap. */
  memoryLimitBytes?: number;
}

export function createSandbox(options: SandboxOptions = {}): Sandbox {
  const limits: Limits = {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    memoryLimitBytes: options.memoryLimitBytes ?? DEFAULT_MEMORY_LIMIT_BYTES,
  };
  if (!Number.isSafeInteger(limits.timeoutMs) || limits.timeoutMs <= 0) {
    throw new Error('timeoutMs must be a positive whole number.');
  }
  if (!Number.isSafeInteger(limits.memoryLimitBytes) || limits.memoryLimitBytes <= 0) {
    throw new Error('memoryLimitBytes must be a positive whole number.');
  }
  return new ProcessSandbox(options.entryPath ?? defaultEntryPath(), limits);
}

/**
 * Runs jobs one at a time in a single child process, starting a new child whenever the last one
 * died or was stopped.
 */
class ProcessSandbox implements Sandbox {
  private child: SandboxProcess | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private readonly snapshots = new SnapshotHashes();

  constructor(
    private readonly entryPath: string,
    private readonly limits: Limits,
  ) {}

  runTool(
    tool: Pick<HarnessTool, 'name' | 'code'>,
    args: Record<string, JsonValue>,
    data: SandboxData,
  ): Promise<SandboxOutcome> {
    const blobs = new RequestBlobs(this.snapshots);
    return this.enqueue(
      `tool ${tool.name}`,
      {
        kind: 'tool',
        name: tool.name,
        code: tool.code,
        args,
        files: data.files.map((file) => ({ ...file })),
        tables: blobs.tables(data.tables),
        texts: blobs.texts(data.texts),
      },
      blobs,
    );
  }

  runValidator(
    source: string,
    validator: string,
    params: Record<string, JsonValue>,
    context: ValidatorContext,
  ): Promise<SandboxOutcome> {
    const blobs = new RequestBlobs(this.snapshots);
    return this.enqueue(
      `validator ${validator}`,
      {
        kind: 'validator',
        source,
        validator,
        params,
        tables: blobs.tables(context.tables),
        originalTables: blobs.tables(context.originalTables),
        answer: context.answer,
        finalText: context.finalText,
        toolCalls: context.toolCalls.map((call) => ({
          name: call.name,
          arguments: call.arguments,
        })),
      },
      blobs,
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    await child?.stop();
  }

  private enqueue(label: string, job: SandboxJob, blobs: RequestBlobs): Promise<SandboxOutcome> {
    if (this.disposed) return Promise.reject(new Error('This sandbox has been disposed.'));
    const result = this.queue.then(() => this.execute(label, job, blobs));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async execute(
    label: string,
    job: SandboxJob,
    blobs: RequestBlobs,
  ): Promise<SandboxOutcome> {
    if (this.disposed) throw new Error('This sandbox has been disposed.');
    if (!this.child?.alive) {
      let started: SandboxProcess;
      try {
        started = await SandboxProcess.start(this.entryPath);
      } catch (error) {
        return failed('crashed', `The sandbox process could not start: ${errorText(error)}.`);
      }
      if (this.disposed) {
        await started.stop();
        throw new Error('This sandbox has been disposed.');
      }
      this.child = started;
    }
    return this.child.run(label, job, this.limits, blobs);
  }
}

type ChildEvent = { type: 'message'; message: ChildMessage } | { type: 'exit'; detail: string };

/** One sandbox child process and the strictly sequential conversation with it. */
class SandboxProcess {
  private waiter: ((event: ChildEvent) => void) | null = null;
  private exitDetail: string | null = null;
  private killed = false;
  private stderrTail = '';
  private nextId = 1;
  /** Content hashes the child has been sent and, as far as we know, still holds. */
  private readonly known = new Set<string>();

  private constructor(private readonly child: ChildProcess) {
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_CHARS);
    });
    child.on('message', (raw: unknown) => {
      const parsed = ChildMessageSchema.safeParse(raw);
      if (parsed.success) {
        this.deliver({ type: 'message', message: parsed.data });
        return;
      }
      this.kill();
      this.deliver({ type: 'exit', detail: 'it sent a malformed message' });
    });
    child.on('exit', (code, signal) => {
      this.exitDetail ??= signal ? `stopped by ${signal}` : `exit code ${code ?? 'unknown'}`;
      this.deliver({ type: 'exit', detail: this.exitDetail });
    });
    child.on('error', (error) => {
      this.exitDetail ??= error.message;
      this.kill();
      this.deliver({ type: 'exit', detail: error.message });
    });
    // An idle sandbox must never keep the engine's process alive on its own.
    child.unref();
    child.channel?.unref();
    unrefStream(child.stderr);
  }

  static async start(entryPath: string): Promise<SandboxProcess> {
    const child = fork(entryPath, [], {
      cwd: dirname(entryPath),
      env: childEnvironment(),
      execArgv: /\.[cm]?ts$/.test(entryPath) ? ['--import', 'tsx'] : [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
      windowsHide: true,
    });
    const sandboxProcess = new SandboxProcess(child);
    const event = await sandboxProcess.next(START_TIMEOUT_MS);
    if (event !== 'timeout' && event.type === 'message' && event.message.type === 'ready') {
      return sandboxProcess;
    }
    sandboxProcess.kill();
    if (event === 'timeout') {
      throw new Error(`it did not start within ${START_TIMEOUT_MS / 1000} s`);
    }
    if (event.type === 'exit') {
      throw new Error(`it exited (${event.detail})${sandboxProcess.lastError()}`);
    }
    throw new Error('it sent an unexpected first message');
  }

  get alive(): boolean {
    return !this.killed && this.exitDetail === null;
  }

  async run(
    label: string,
    job: SandboxJob,
    limits: Limits,
    blobs: RequestBlobs,
  ): Promise<SandboxOutcome> {
    const id = this.nextId++;
    let content = blobs.content(blobs.hashes.filter((hash) => !this.known.has(hash)));
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (!this.alive || !this.child.connected) {
        return failed(
          'crashed',
          `The sandbox process was gone before the ${label} could run. It restarts on the next call.`,
        );
      }
      const request: RunRequest = { type: 'run', id, job, limits, blobs: content };
      this.child.send(request);
      const event = await this.next(limits.timeoutMs + WATCHDOG_GRACE_MS);
      if (event === 'timeout') {
        this.kill();
        return failed(
          'timeout',
          `The ${label} did not finish within ${limits.timeoutMs} ms, so its sandbox process was stopped.`,
        );
      }
      if (event.type === 'exit') {
        return failed(
          'crashed',
          `The sandbox process stopped while running the ${label} (${event.detail}${this.lastError()}). It restarts on the next call.`,
        );
      }
      const message = event.message;
      if (message.type === 'missing' && message.id === id && attempt === 1) {
        message.hashes.forEach((hash) => this.known.delete(hash));
        content = blobs.content(message.hashes);
        continue;
      }
      if (message.type === 'result' && message.id === id) {
        blobs.hashes.forEach((hash) => this.known.add(hash));
        return toOutcome(message.outcome);
      }
      break;
    }
    this.kill();
    return failed('crashed', 'The sandbox process answered out of turn, so it was restarted.');
  }

  async stop(): Promise<void> {
    if (this.exitDetail !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, STOP_TIMEOUT_MS);
      this.child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      this.kill();
    });
  }

  private next(timeoutMs: number): Promise<ChildEvent | 'timeout'> {
    if (this.exitDetail !== null) return Promise.resolve({ type: 'exit', detail: this.exitDetail });
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiter = null;
        resolve('timeout');
      }, timeoutMs);
      this.waiter = (event) => {
        clearTimeout(timer);
        resolve(event);
      };
    });
  }

  private deliver(event: ChildEvent): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.(event);
  }

  private kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.child.kill('SIGKILL');
  }

  private lastError(): string {
    const line = this.stderrTail
      .split('\n')
      .map((text) => text.trim())
      .filter(Boolean)
      .at(-1);
    return line ? `: ${line.slice(0, 300)}` : '';
  }
}

/** Table snapshot hashes, remembered by array identity because frozen snapshots never change. */
class SnapshotHashes {
  private readonly known = new WeakMap<
    readonly Row[],
    { columns: readonly string[]; hash: string }
  >();

  hash(snapshot: TableSnapshot): { hash: string; json: () => string } {
    const cached = this.known.get(snapshot.rows);
    if (cached && cached.columns === snapshot.columns) {
      return { hash: cached.hash, json: () => tableJson(snapshot) };
    }
    const json = tableJson(snapshot);
    const hash = contentHash(json);
    if (Object.isFrozen(snapshot.rows)) {
      this.known.set(snapshot.rows, { columns: snapshot.columns, hash });
    }
    return { hash, json: () => json };
  }
}

/** The data one request refers to, by hash, with its content ready in case the child lacks it. */
class RequestBlobs {
  private readonly contents = new Map<string, () => string>();

  constructor(private readonly snapshots: SnapshotHashes) {}

  tables(tables: Readonly<Record<string, TableSnapshot>>): Record<string, string> {
    return mapValues(tables, (snapshot) => {
      const { hash, json } = this.snapshots.hash(snapshot);
      this.contents.set(hash, json);
      return hash;
    });
  }

  texts(texts: Readonly<Record<string, string>>): Record<string, string> {
    return mapValues(texts, (text) => {
      const hash = contentHash(text);
      this.contents.set(hash, () => text);
      return hash;
    });
  }

  get hashes(): string[] {
    return [...this.contents.keys()];
  }

  content(hashes: readonly string[]): Record<string, string> {
    return Object.fromEntries(
      hashes.flatMap((hash) => {
        const content = this.contents.get(hash);
        return content ? [[hash, content()] as const] : [];
      }),
    );
  }
}

function toOutcome(outcome: ChildOutcome): SandboxOutcome {
  if (!outcome.ok) return { ok: false, failure: outcome.failure };
  const parsed = JsonValueSchema.safeParse(JSON.parse(outcome.json));
  return parsed.success
    ? { ok: true, value: parsed.data }
    : failed('invalid_result', 'The result was not plain JSON data.');
}

function failed(kind: SandboxFailure['kind'], message: string): SandboxOutcome {
  return { ok: false, failure: { kind, message } };
}

function defaultEntryPath(): string {
  const here = fileURLToPath(import.meta.url);
  return join(dirname(here), `child${extname(here)}`);
}

/**
 * Nothing from the engine's environment is passed on, so no key or token can reach job code.
 * On Windows, libuv still adds the variables every process needs (SYSTEMROOT, TEMP, PATH...).
 */
function childEnvironment(): NodeJS.ProcessEnv {
  // Local-time methods inside QuickJS follow the process time zone; UTC makes them machine-independent.
  const env: NodeJS.ProcessEnv = { TZ: 'UTC' };
  // Inside Electron, process.execPath is the Electron binary; this makes the child plain Node.
  if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
  return env;
}

function unrefStream(stream: Readable | null): void {
  if (stream && 'unref' in stream && typeof stream.unref === 'function') stream.unref();
}

function tableJson(snapshot: TableSnapshot): string {
  return JSON.stringify({ columns: snapshot.columns, rows: snapshot.rows });
}

function mapValues<T>(
  record: Readonly<Record<string, T>>,
  fn: (value: T) => string,
): Record<string, string> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, fn(value)]));
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
