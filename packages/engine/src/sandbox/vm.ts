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
    const result = callWithStrings(vm, kit, job.kind === 'tool' ? 'runTool' : 'runValidator', args);
    if (result.error) return fail(vm, result.error, 'run', file, limits);

    extracting(vm);
    const json = vm.getString(result.value);
    release(result.value);
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
  } finally {
    release(kit);
  }
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
  if (job.kind === 'tool') {
    return {
      readTable: (name = '', query = 'null') =>
        JSON.stringify(readRows(name, job.tables, blobs, query)),
      readText: (name = '') => {
        const hash = lookup(job.texts, name, 'text file');
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
  const table = blobs.table(lookup(refs, name, 'table'));
  const parsed = QuerySchema.safeParse(JSON.parse(queryJson));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
    throw new Error(
      `readTable takes options like { where, columns, limit, offset }. ${where}${issue?.message ?? ''}`,
    );
  }
  const query = parsed.data ?? {};
  const selected = selectRows(name, table, { where: query.where, columns: query.columns });
  const offset = query.offset ?? 0;
  const end = query.limit === undefined ? undefined : offset + query.limit;
  return selected.rows.slice(offset, end);
}

function lookup(refs: Record<string, string>, name: string, kind: string): string {
  if (!Object.hasOwn(refs, name)) {
    const names = Object.keys(refs);
    throw new Error(
      names.length === 0
        ? `There is no ${kind} called "${name}"; this job has none.`
        : `There is no ${kind} called "${name}". The ${kind}s are: ${names.join(', ')}.`,
    );
  }
  return refs[name] as string;
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

/** The first stack frame in the job's own file, e.g. `tools/invoice_total.js:3:14`. */
function locate(stack: unknown, file: string): string | null {
  if (typeof stack !== 'string') return null;
  const marker = `(${file}:`;
  const line = stack.split('\n').find((frame) => frame.includes(marker));
  if (!line) return null;
  const start = line.indexOf(marker) + 1;
  return line.slice(start, line.indexOf(')', start));
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
