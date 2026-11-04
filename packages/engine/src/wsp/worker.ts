import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { WspWorkerInfo, WspWorkerStatus } from '@architect/shared';
import { z } from 'zod';
import { writeFileAtomic } from '../data/atomic-write';

/*
 * The WSP worker's processes (decision 109): a Python environment Architect installs from pinned
 * packages, the kernel that runs one of Astra's programs, and the evaluator, the runner's own
 * process and the only one that runs the model. Each gets an environment with no keys, no proxy
 * that works and the Hub switched offline, and is killed whole when it overruns or is cancelled.
 */

export const WSP_WORKER_VERSION = 'wsp-worker/1';
const INSTALLED = 'installed.json';
const TORCH_INDEX = 'https://download.pytorch.org/whl/cpu';
const PYPI = 'https://pypi.org/simple';

export interface WspWorkerPaths {
  /** The worker's Python source and its requirements (`trainer/wsp`). */
  sourceDir: string;
  /** Where its environment is installed. */
  envDir: string;
}

export function pythonOf(envDir: string): string {
  return process.platform === 'win32'
    ? join(envDir, 'Scripts', 'python.exe')
    : join(envDir, 'bin', 'python');
}

function requirementsSha(paths: WspWorkerPaths): string {
  return createHash('sha256')
    .update(readFileSync(join(paths.sourceDir, 'requirements.txt')))
    .digest('hex');
}

/** SHA-256 over the worker's source files and requirements, in name order. */
export function workerSourceSha(sourceDir: string): string {
  const hash = createHash('sha256');
  for (const name of readdirSync(sourceDir).filter((n) => /\.(py|txt)$/.test(n)).sort()) {
    hash.update(`${name}\n`).update(readFileSync(join(sourceDir, name)));
  }
  return hash.digest('hex');
}

export function workerInfo(paths: WspWorkerPaths, python: string): WspWorkerInfo {
  const packages = readFileSync(join(paths.sourceDir, 'requirements.txt'), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
  return { version: WSP_WORKER_VERSION, python, packages, sourceSha256: workerSourceSha(paths.sourceDir) };
}

const InstalledSchema = z.object({ requirementsSha256: z.string(), python: z.string() });

/** Whether the environment matches the pinned packages. */
export function workerStatus(paths: WspWorkerPaths): WspWorkerStatus {
  if (!existsSync(join(paths.sourceDir, 'kernel.py'))) {
    return { status: 'unavailable', reason: "This build of Architect doesn't carry the WSP worker." };
  }
  const marker = join(paths.envDir, INSTALLED);
  if (existsSync(pythonOf(paths.envDir)) && existsSync(marker)) {
    const installed = InstalledSchema.safeParse(JSON.parse(readFileSync(marker, 'utf8')));
    if (installed.success && installed.data.requirementsSha256 === requirementsSha(paths)) {
      return { status: 'ready', python: installed.data.python };
    }
    return { status: 'needs-setup', reason: "The worker's packages changed; set it up again." };
  }
  return {
    status: 'needs-setup',
    reason: 'The worker needs Python packages: torch for the CPU, transformers and safetensors, about 400 MB.',
  };
}

/** Runs a program to its end, with its output; rejects with what it printed when it fails. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`${command} ended with ${code}: ${output.slice(-600)}`)),
    );
  });
}

async function found(command: string): Promise<boolean> {
  try {
    await run(command, ['--version'], process.env);
    return true;
  } catch {
    return false;
  }
}

/**
 * Installs the pinned packages into a new environment with uv, or with Python's venv and pip
 * when uv isn't on this computer. It downloads from PyTorch's CPU index and PyPI only.
 */
export async function setupWorker(paths: WspWorkerPaths): Promise<WspWorkerStatus> {
  const requirements = join(paths.sourceDir, 'requirements.txt');
  const python = pythonOf(paths.envDir);
  mkdirSync(paths.envDir, { recursive: true });
  if (await found('uv')) {
    await run('uv', ['venv', '--allow-existing', '--python', '3.12', paths.envDir], process.env);
    await run(
      'uv',
      [
        'pip', 'install', '--python', python, '-r', requirements,
        '--index-url', TORCH_INDEX, '--extra-index-url', PYPI, '--index-strategy', 'unsafe-best-match',
      ],
      process.env,
    );
  } else {
    const system = process.platform === 'win32' ? 'py' : 'python3';
    if (!(await found(system))) {
      return {
        status: 'unavailable',
        reason: 'Neither uv nor Python 3.12 is on this computer. Install uv (docs.astral.sh/uv), then set up the worker.',
      };
    }
    await run(system, [...(system === 'py' ? ['-3.12'] : []), '-m', 'venv', paths.envDir], process.env);
    await run(
      python,
      ['-m', 'pip', 'install', '-r', requirements, '--extra-index-url', TORCH_INDEX],
      process.env,
    );
  }
  const version = (await run(python, ['-c', 'import platform;print(platform.python_version())'], {})).trim();
  writeFileAtomic(
    join(paths.envDir, INSTALLED),
    JSON.stringify({ requirementsSha256: requirementsSha(paths), python: version }),
  );
  return workerStatus(paths);
}

/** CPU threads a worker may use: all but two, at least one. */
export function workerThreads(): number {
  return Math.max(1, cpus().length - 2);
}

export function totalMemoryGb(): number {
  return totalmem() / 1024 ** 3;
}

/**
 * The environment a worker process gets: what Windows or the C library needs to start, the
 * session's own temporary folder, the Hub offline and a proxy that answers nothing. No key, no
 * token and none of the app's own variables.
 */
export function workerEnvironment(tempDir: string): NodeJS.ProcessEnv {
  mkdirSync(tempDir, { recursive: true });
  const keep = ['SYSTEMROOT', 'SystemRoot', 'WINDIR', 'windir', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'];
  const env: NodeJS.ProcessEnv = {};
  for (const name of keep) if (process.env[name] !== undefined) env[name] = process.env[name];
  const root = process.env['SYSTEMROOT'] ?? process.env['SystemRoot'];
  env['PATH'] = process.platform === 'win32' && root ? join(root, 'System32') : '/usr/bin:/bin';
  return {
    ...env,
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
    HOME: tempDir,
    USERPROFILE: tempDir,
    HF_HOME: join(tempDir, 'hf'),
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    HTTP_PROXY: 'http://127.0.0.1:9',
    HTTPS_PROXY: 'http://127.0.0.1:9',
    ALL_PROXY: 'http://127.0.0.1:9',
    NO_PROXY: '',
    WSP_THREADS: String(workerThreads()),
  };
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }).on('error', () => undefined);
  } else {
    child.kill('SIGKILL');
  }
}

/* The kernel */

export const KernelResultSchema = z.object({
  status: z.enum(['ok', 'error']),
  error: z.string().nullable(),
  output: z.string(),
  edits: z.object({ files: z.record(z.string(), z.string()) }).nullable(),
  reads: z.array(z.object({ name: z.string(), texts: z.array(z.string()), layers: z.array(z.number().int()) })),
  refused: z.array(z.string()),
});
export type KernelResult = z.infer<typeof KernelResultSchema>;

export interface KernelRequest {
  base: string;
  program: string;
  incumbent: string | null;
  out: string;
  scratch: string;
  reads: string;
  practice: unknown[];
  memoryBytes: number;
}

export type KernelOutcome =
  | { kind: 'done'; result: KernelResult; seconds: number }
  | { kind: 'timeout'; seconds: number; stderr: string }
  | { kind: 'failed'; reason: string; seconds: number };

/** Runs one program in a kernel process of its own, killed at its time limit or a cancel. */
export function runKernel(
  paths: WspWorkerPaths,
  request: KernelRequest,
  requestFile: string,
  options: { timeoutMs: number; tempDir: string; signal?: AbortSignal },
): Promise<KernelOutcome> {
  for (const dir of [request.scratch, request.out, request.reads]) mkdirSync(dir, { recursive: true });
  writeFileSync(requestFile, JSON.stringify(request));
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(
      pythonOf(paths.envDir),
      ['-I', '-B', join(paths.sourceDir, 'kernel.py'), requestFile],
      { cwd: request.scratch, env: workerEnvironment(options.tempDir), windowsHide: true },
    );
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr = (stderr + chunk.toString()).slice(-4_000)));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, options.timeoutMs);
    const abort = () => killTree(child);
    options.signal?.addEventListener('abort', abort, { once: true });
    const seconds = () => (Date.now() - started) / 1000;
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ kind: 'failed', reason: error.message, seconds: seconds() });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      if (timedOut) return resolve({ kind: 'timeout', seconds: seconds(), stderr });
      if (options.signal?.aborted) return resolve({ kind: 'failed', reason: 'Cancelled.', seconds: seconds() });
      if (stderr.includes('WSP_MEMORY_LIMIT')) {
        return resolve({ kind: 'failed', reason: 'The program went over its memory limit.', seconds: seconds() });
      }
      const line = stdout.trim().split('\n').pop() ?? '';
      const parsed = (() => {
        try {
          return KernelResultSchema.safeParse(JSON.parse(line));
        } catch {
          return null;
        }
      })();
      if (code !== 0 || parsed === null || !parsed.success) {
        return resolve({
          kind: 'failed',
          reason: `The kernel ended with ${code}: ${stderr.trim().split('\n').slice(-3).join(' ')}`,
          seconds: seconds(),
        });
      }
      resolve({ kind: 'done', result: parsed.data, seconds: seconds() });
    });
  });
}

/* The evaluator */

const ReadySchema = z.object({
  ready: z.boolean(),
  error: z.string().optional(),
  python: z.string().optional(),
  torch: z.string().optional(),
  transformers: z.string().optional(),
  parameters: z.number().optional(),
});

/** The runner's evaluator: one process per experiment, answering one request at a time. */
export class EvaluatorProcess {
  private child: ChildProcess | null = null;
  private pending = new Map<number, (reply: Record<string, unknown>) => void>();
  private next = 1;
  private stderr = '';
  private failure: string | null = null;
  info: z.infer<typeof ReadySchema> | null = null;

  constructor(
    private readonly paths: WspWorkerPaths,
    private readonly base: string,
    private readonly session: string,
    private readonly memoryBytes: number,
  ) {}

  async start(): Promise<void> {
    const child = spawn(
      pythonOf(this.paths.envDir),
      ['-I', '-B', join(this.paths.sourceDir, 'evaluator.py'), this.base, this.session],
      {
        cwd: this.session,
        env: { ...workerEnvironment(join(this.session, 'tmp')), WSP_MEMORY_BYTES: String(this.memoryBytes) },
        windowsHide: true,
      },
    );
    this.child = child;
    child.stderr!.on('data', (chunk: Buffer) => (this.stderr = (this.stderr + chunk.toString()).slice(-4_000)));
    const lines = createInterface({ input: child.stdout! });
    const ready = new Promise<z.infer<typeof ReadySchema>>((resolve, reject) => {
      let first = true;
      lines.on('line', (line) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return;
        }
        if (first) {
          first = false;
          const parsed = ReadySchema.safeParse(message);
          if (!parsed.success || !parsed.data.ready) {
            reject(new Error(`The evaluator couldn't load the model: ${parsed.success ? parsed.data.error : line}`));
          } else resolve(parsed.data);
          return;
        }
        const id = Number(message['id']);
        const settle = this.pending.get(id);
        this.pending.delete(id);
        settle?.(message);
      });
      child.on('close', (code) => {
        this.failure = this.stderr.includes('WSP_MEMORY_LIMIT')
          ? 'The evaluator went over its memory limit.'
          : `The evaluator stopped (${code}): ${this.stderr.trim().split('\n').slice(-2).join(' ')}`;
        if (first) reject(new Error(this.failure));
        for (const settle of this.pending.values()) settle({ ok: false, error: this.failure });
        this.pending.clear();
        this.child = null;
      });
      child.on('error', reject);
    });
    this.info = await ready;
  }

  /** Sends one request and waits for its reply; rejects with the evaluator's reason. */
  async request<T>(op: string, payload: Record<string, unknown>, schema: z.ZodType<T>): Promise<T> {
    if (this.child === null) throw new Error(this.failure ?? 'The evaluator is not running.');
    const id = this.next++;
    const reply = await new Promise<Record<string, unknown>>((resolve) => {
      this.pending.set(id, resolve);
      this.child!.stdin!.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    });
    if (reply['ok'] !== true) throw new Error(String(reply['error'] ?? 'The evaluator failed.'));
    return schema.parse(reply);
  }

  close(): void {
    if (this.child !== null) killTree(this.child);
    this.child = null;
  }
}
