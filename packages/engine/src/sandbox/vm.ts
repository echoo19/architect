import { WhereClauseSchema } from '@architect/shared';
import {
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from 'quickjs-emscripten';
import { z } from 'zod';
import { selectRows } from '../data/query';
import type { Row, TableSnapshot } from '../data/types';
import { LOAD_ERROR_NAME, PRELUDE } from './prelude';
import type { ChildOutcome, Limits, SandboxFailure, SandboxJob } from './protocol';

/**
 * QuickJS's own stack limit. It must trip before V8's native stack overflows underneath the
 * WebAssembly frames: at 512 KiB, deep recursion overflowed V8 first in measurements.
 */
export const MAX_STACK_BYTES = 256 * 1024;
/** Upper bound on a result's JSON, so a runaway result can't flood the engine. */
export const MAX_RESULT_CHARS = 1_000_000;
/** Time allowed for reading a result or error back out of the VM after the job's code ends. */
const EXTRACT_MS = 250;

export interface BlobReader {
  table(hash: string): TableSnapshot;
  text(hash: string): string;
}

const QuerySchema = z
  .strictObject({
    where: z.array(WhereClauseSchema).optional(),
    columns: z.array(z.string()).optional(),
    limit: z.number().int().min(0).optional(),
    offset: z.number().int().min(0).optional(),
  })
  .nullable();

/**
 * Runs one job in a fresh QuickJS runtime with the job's time and memory limits. Problems in the
 * job's code come back as failures. A throw from here means the VM itself broke.
 */
export function runJob(
  module: QuickJSWASMModule,
  job: SandboxJob,
  limits: Limits,
  blobs: BlobReader,
): ChildOutcome {
  const runtime = module.newRuntime({
    memoryLimitBytes: limits.memoryLimitBytes,
    maxStackSizeBytes: MAX_STACK_BYTES,
    interruptHandler: shouldInterruptAfterDeadline(Date.now() + limits.timeoutMs),
  });
  const vm = runtime.newContext();
  let outcome: ChildOutcome;
  try {
    outcome = execute(vm, job, limits, blobs);
  } catch (error) {
    try {
      vm.dispose();
      runtime.dispose();
    } catch {
      // A VM that broke mid-job may not tear down cleanly. The child exits after reporting the
      // original error, which releases everything, so that error is the one that matters.
    }
    throw error;
  }
  vm.dispose();
  runtime.dispose();
  return outcome;
}

function execute(
  vm: QuickJSContext,
  job: SandboxJob,
  limits: Limits,
  blobs: BlobReader,
): ChildOutcome {
  if (job.kind === 'code') return executeCode(vm, job, limits, blobs);
  if (job.kind === 'grep') return executeGrep(vm, job, limits, blobs);
  const file = job.kind === 'tool' ? `tools/${job.name}.js` : 'checker.js';
  const kit = installKit(vm, job, blobs);
  try {
    const loaded = vm.evalCode(job.kind === 'tool' ? job.code : job.source, file, {
      type: 'global',
    });
    if (loaded.error) return fail(vm, loaded.error, 'load', file, limits);
    release(loaded.value);

    const args =
      job.kind === 'tool'
        ? [JSON.stringify(job.args)]
        : [
            job.validator,
            JSON.stringify(job.params),
            JSON.stringify({
              answer: job.answer,
              finalText: job.finalText,
              toolCalls: job.toolCalls,
            }),
          ];
    const entry =
      job.kind === 'validator' ? 'runValidator' : job.loadOnly ? 'checkTool' : 'runTool';
    const result = callWithStrings(vm, kit, entry, job.kind === 'tool' && job.loadOnly ? [] : args);
    if (result.error) return fail(vm, result.error, 'run', file, limits);

    return jsonOutcome(vm, result.value);
  } finally {
    release(kit);
  }
}

type CodeJob = Extract<SandboxJob, { kind: 'code' }>;
type GrepJob = Extract<SandboxJob, { kind: 'grep' }>;

/** The file name code from `run` has in error messages and stack frames. */
const CODE_FILE = 'run.js';

/**
 * Runs the agent's code with `today`, `files`, `csv` and `print` installed, and hands back what
 * it printed and the value of its last expression. An error in the code is part of the result,
 * with what it printed before it stopped, so the agent can see both.
 */
function executeCode(
  vm: QuickJSContext,
  job: CodeJob,
  limits: Limits,
  blobs: BlobReader,
): ChildOutcome {
  const kit = installKit(vm, job, blobs);
  try {
    release(vm.unwrapResult(callWithStrings(vm, kit, 'startCode', [job.today])));
    const result = vm.evalCode(job.code, CODE_FILE, { type: 'global' });
    if (result.error) return stoppedCode(vm, kit, result.error, limits);
    extracting(vm);
    const finished = vm.callMethod(kit, 'finishCode', [result.value]);
    release(result.value);
    if (finished.error) return stoppedCode(vm, kit, finished.error, limits);
    return jsonOutcome(vm, finished.value);
  } finally {
    release(kit);
  }
}

/** The result of code that threw or was stopped: the error, and what it printed until then. */
function stoppedCode(
  vm: QuickJSContext,
  kit: QuickJSHandle,
  thrown: QuickJSHandle,
  limits: Limits,
): ChildOutcome {
  extracting(vm);
  const error = describeThrown(vm, thrown, 'run', CODE_FILE, limits);
  release(thrown);
  let output = { printed: '', cut: false };
  const read = vm.callMethod(kit, 'output', []);
  if (read.error) {
    release(read.error);
  } else {
    output = JSON.parse(vm.getString(read.value)) as typeof output;
    release(read.value);
  }
  return { ok: true, json: JSON.stringify({ ...output, value: null, error }) };
}

/** Searches the job's files line by line; a pattern that runs too long is stopped like code. */
function executeGrep(
  vm: QuickJSContext,
  job: GrepJob,
  limits: Limits,
  blobs: BlobReader,
): ChildOutcome {
  const kit = installKit(vm, job, blobs);
  try {
    const result = callWithStrings(vm, kit, 'grep', [
      job.pattern,
      job.ignoreCase ? 'i' : '',
      JSON.stringify(Object.keys(job.files)),
      String(job.limit),
      String(job.lineChars),
    ]);
    if (result.error) return fail(vm, result.error, 'run', 'grep', limits);
    return jsonOutcome(vm, result.value);
  } finally {
    release(kit);
  }
}

/** Reads a JSON string the job's code returned, refusing one too long to hand back. */
function jsonOutcome(vm: QuickJSContext, handle: QuickJSHandle): ChildOutcome {
  extracting(vm);
  const json = vm.getString(handle);
  release(handle);
  if (json.length > MAX_RESULT_CHARS) {
    return {
      ok: false,
      failure: {
        kind: 'invalid_result',
        message: `The result is ${json.length} characters of JSON; the limit is ${MAX_RESULT_CHARS}.`,
      },
    };
  }
  return { ok: true, json };
}

function callWithStrings(
  vm: QuickJSContext,
  target: QuickJSHandle,
  method: string,
  args: readonly string[],
): ReturnType<QuickJSContext['callMethod']> {
  const handles = args.map((arg) => vm.newString(arg));
  try {
    return vm.callMethod(target, method, handles);
  } finally {
    handles.forEach(release);
  }
}

/** Builds the host data functions and runs the prelude, which returns the entry points. */
function installKit(vm: QuickJSContext, job: SandboxJob, blobs: BlobReader): QuickJSHandle {
  const host = vm.newObject();
  try {
    for (const [name, fn] of Object.entries(hostFunctions(job, blobs))) {
      const handle = vm.newFunction(name, (...args) =>
        vm.newString(fn(...args.map((arg) => vm.getString(arg)))),
      );
      vm.setProp(host, name, handle);
      handle.dispose();
    }
    const factory = vm.unwrapResult(vm.evalCode(PRELUDE, 'sandbox-prelude.js', { type: 'global' }));
    try {
      return vm.unwrapResult(vm.callFunction(factory, vm.undefined, host));
    } finally {
      factory.dispose();
    }
  } finally {
    host.dispose();
  }
}

/** Data access for the job's code. Every function takes and returns strings (JSON for values). */
function hostFunctions(
  job: SandboxJob,
  blobs: BlobReader,
): Record<string, (...args: string[]) => string> {
  if (job.kind === 'code' || job.kind === 'grep') {
    return {
      readFile: (path = '') => {
        const hash = job.files[filePath(job.files, path)] as string;
        return JSON.stringify(blobs.text(hash));
      },
      listFiles: (folder = '') => JSON.stringify(listPaths(job.files, folder)),
    };
  }
  if (job.kind === 'tool') {
    return {
      readTable: (name = '', query = 'null') =>
        JSON.stringify(readRows(name, job.tables, blobs, query)),
      readText: (name = '') => {
        const hash = job.texts[fileName(job.texts, name, 'text file')] as string;
        return JSON.stringify(blobs.text(hash));
      },
      listFiles: () => JSON.stringify(job.files),
    };
  }
  return {
    readTable: (name = '', query = 'null') =>
      JSON.stringify(readRows(name, job.tables, blobs, query)),
    readOriginalTable: (name = '', query = 'null') =>
      JSON.stringify(readRows(name, job.originalTables, blobs, query)),
  };
}

function readRows(
  name: string,
  refs: Record<string, string>,
  blobs: BlobReader,
  queryJson: string,
): Row[] {
  const file = fileName(refs, name, 'table');
  const table = blobs.table(refs[file] as string);
  const parsed = QuerySchema.safeParse(JSON.parse(queryJson));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(
      `readTable takes options like { where, columns, limit, offset }. ${where}${issue?.message ?? ''}`,
    );
  }
  const query = parsed.data ?? {};
  const selected = selectRows(file, table, { where: query.where, columns: query.columns });
  const offset = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return selected.rows.slice(offset, end);
}

/**
 * The file a name refers to: the name itself, or the one file whose name without its extension
 * it is, so a tool that asks for "jobs" gets jobs.csv. A tool's code can't correct itself the
 * way the student does after an error, so an unambiguous short name is accepted, and so is the
 * file's path in the agent's folder, "data/jobs.csv".
 */
function fileName(refs: Record<string, string>, raw: string, kind: string): string {
  const name = raw.startsWith('data/') ? raw.slice('data/'.length) : raw;
  if (Object.hasOwn(refs, name)) return name;
  const names = Object.keys(refs);
  const stems = names.filter((file) => file.replace(/\.[^.]+$/, '') === name);
  if (stems.length === 1) return stems[0] as string;
  throw new Error(
    names.length === 0
      ? `There is no ${kind} called "${name}"; this job has none.`
      : `There is no ${kind} called "${name}". The ${kind}s are: ${names.join(', ')}.`,
  );
}

function fail(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  phase: 'load' | 'run',
  file: string,
  limits: Limits,
): ChildOutcome {
  extracting(vm);
  const failure = describeThrown(vm, handle, phase, file, limits);
  release(handle);
  return { ok: false, failure };
}

function describeThrown(
  vm: QuickJSContext,
  handle: QuickJSHandle,
  phase: 'load' | 'run',
  file: string,
  limits: Limits,
): SandboxFailure {
  const kind = phase === 'load' ? 'load' : 'error';
  const memory: SandboxFailure = {
    kind: 'memory',
    message: `It used more than ${Math.round(limits.memoryLimitBytes / 1024 / 1024)} MB of memory and was stopped.`,
  };
  const type = vm.typeof(handle);
  let thrown: unknown;
  try {
    thrown = vm.dump(handle);
  } catch {
    return { kind, message: 'It threw a value that could not be read back.' };
  }
  if (isErrorLike(thrown)) {
    if (thrown.name === 'InternalError' && thrown.message === 'interrupted') {
      return {
        kind: 'timeout',
        message: `It ran longer than ${limits.timeoutMs} ms and was stopped.`,
      };
    }
    if (thrown.message === 'out of memory') return memory;
    if (thrown.name === LOAD_ERROR_NAME) return { kind: 'load', message: thrown.message };
    const text =
      thrown.message === 'stack overflow'
        ? 'InternalError: stack overflow (the code recursed too deeply)'
        : `${thrown.name}: ${thrown.message}`;
    const at = locate(thrown.stack, file);
    return { kind, message: at ? `${text} (${at})` : text };
  }
  // Out of memory can leave an error object that can no longer be read back.
  if (type === 'object' && thrown === '') return memory;
  return { kind, message: `It threw ${preview(thrown)}.` };
}

function isErrorLike(value: unknown): value is { name: string; message: string; stack?: unknown } {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { name?: unknown; message?: unknown };
  return typeof candidate.name === 'string' && typeof candidate.message === 'string';
}

/**
 * The first stack frame in the job's own file, e.g. `tools/invoice_total.js:3:14`. Runtime
 * errors write it in parentheses, syntax errors as `at tools/x.js:2:13`.
 */
function locate(stack: unknown, file: string): string | null {
  if (typeof stack !== 'string') return null;
  const start = stack.indexOf(`${file}:`);
  if (start < 0) return null;
  return /^[^\s)]+/.exec(stack.slice(start))?.[0] ?? null;
}

function preview(value: unknown): string {
  const text = (value === undefined ? 'undefined' : JSON.stringify(value)) ?? String(value);
  return text.length > 200 ? `${text.slice(0, 200)}…` : text;
}

/** After the job's code ends, give reading results back a short deadline of its own. */
function extracting(vm: QuickJSContext): void {
  vm.runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + EXTRACT_MS));
}

function release(handle: QuickJSHandle): void {
  if (handle.alive) handle.dispose();
}

/** A path the code gave, as a path in the agent's folder; one that climbs out is refused. */
function cleanPath(raw: string): string {
  const parts = raw
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (parts.includes('..')) {
    throw new Error(`"${raw}" climbs out of the folder with "..". Paths are like data/orders.csv.`);
  }
  return parts.join('/');
}

function filePath(refs: Record<string, string>, raw: string): string {
  const path = cleanPath(raw);
  if (Object.hasOwn(refs, path)) return path;
  const folder = path.slice(0, path.lastIndexOf('/') + 1);
  const near = Object.keys(refs)
    .filter((file) => file.startsWith(folder))
    .slice(0, 20);
  const hint = near.length > 0 ? ` Files there: ${near.join(', ')}.` : '';
  throw new Error(`files.read: there is no file "${raw}".${hint}`);
}

/** The paths of the files in a folder and the folders inside it, in path order. */
function listPaths(refs: Record<string, string>, raw: string): string[] {
  const folder = cleanPath(raw);
  const paths = Object.keys(refs)
    .filter((path) => folder === '' || path.startsWith(`${folder}/`))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (paths.length === 0 && folder !== '') {
    throw new Error(`files.list: there is no folder "${raw}".`);
  }
  return paths;
}
