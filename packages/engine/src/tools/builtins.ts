import type { BuiltinToolName, Harness, JsonValue, RowDiff } from '@architect/shared';
import type { PlannedWrite, TableStore } from '../data/table-store';
import type { FileInfo } from '../data/types';
import { parseArguments } from './arguments';
import { calculate } from './calculator';
import { ToolError } from './errors';
import { fitTable, fitText } from './results';

/** A write waiting for the user's decision in the workspace. */
export interface PendingWrite {
  tool: 'append_rows' | 'update_rows';
  file: string;
  /** e.g. "Append 1 row to invoices.csv" */
  summary: string;
  diff: RowDiff;
}

export type WriteDecision = 'approve' | 'deny';

/**
 * Asks the user to approve a write. Absent in task mode, where writes go straight to the
 * attempt's scratch data.
 */
export type ApproveWrite = (change: PendingWrite, signal?: AbortSignal) => Promise<WriteDecision>;

export interface ExecutorResult {
  value: JsonValue;
  /** Set when the call loaded a skill. */
  loadedSkill?: string;
}

export type Executor = (args: unknown, signal?: AbortSignal) => Promise<ExecutorResult>;

interface BuiltinDeps {
  harness: Harness;
  store: TableStore;
  approveWrite?: ApproveWrite;
  budget: number;
}

export function builtinExecutors(deps: BuiltinDeps): Record<BuiltinToolName, Executor> {
  const { harness, store, budget } = deps;

  async function write(tool: PendingWrite['tool'], plan: PlannedWrite, signal?: AbortSignal) {
    if (plan.changed > 0) {
      if (deps.approveWrite) {
        const change = { tool, file: plan.file, summary: plan.summary, diff: plan.diff };
        const decision = await untilAborted(deps.approveWrite(change, signal), signal);
        if (decision !== 'approve') {
          return {
            file: plan.file,
            declined: true,
            message: `The user declined this change, so nothing was written: ${plan.summary}.`,
          };
        }
      }
      store.apply(plan);
      if (store.mode === 'live') save(store);
    }
    if (plan.kind === 'append') return { file: plan.file, appended: plan.changed };
    const result: Record<string, JsonValue> = {
      file: plan.file,
      matched: plan.matched,
      changed: plan.changed,
    };
    if (plan.changed === 0) result.note = `${plan.summary}.`;
    return result;
  }

  return {
    async list_files(args) {
      parseArguments('list_files', args);
      return { value: { files: store.listFiles().map(fileInfoJson) } };
    },
    async read_table(args) {
      const { file, where, columns, limit, offset = 0 } = parseArguments('read_table', args);
      const result = store.read(file, { where, columns, limit, offset });
      return { value: fitTable(file, result, offset, budget) };
    },
    async read_text(args) {
      const { file, offset = 0 } = parseArguments('read_text', args);
      return { value: fitText(file, store.readText(file), offset, budget) };
    },
    async calculate(args) {
      const { expression } = parseArguments('calculate', args);
      return { value: { result: calculate(expression) } };
    },
    async append_rows(args, signal) {
      const { file, rows } = parseArguments('append_rows', args);
      return { value: await write('append_rows', store.planAppend(file, rows), signal) };
    },
    async update_rows(args, signal) {
      const { file, where, set } = parseArguments('update_rows', args);
      return { value: await write('update_rows', store.planUpdate(file, where, set), signal) };
    },
    async load_skill(args) {
      const { name } = parseArguments('load_skill', args);
      const wanted = name.trim().toLowerCase();
      const skill =
        harness.skills.find((candidate) => candidate.slug === wanted) ??
        harness.skills.find((candidate) => candidate.name.trim().toLowerCase() === wanted);
      if (!skill) {
        const names = harness.skills.map((candidate) => `${candidate.slug} (${candidate.name})`);
        throw new ToolError(
          names.length === 0
            ? 'There are no skills to load.'
            : `There is no skill called "${name}". The skills are: ${names.join(', ')}.`,
        );
      }
      return {
        value: { slug: skill.slug, name: skill.name, body: skill.body },
        loadedSkill: skill.slug,
      };
    },
  };
}

/** Saves an approved write right away; if that fails, the change is dropped and reported. */
function save(store: TableStore): void {
  try {
    store.commit();
  } catch (error) {
    store.discard();
    const reason = error instanceof Error ? error.message : String(error);
    throw new ToolError(`The change couldn't be saved, so nothing was written: ${reason}`);
  }
}

function fileInfoJson(info: FileInfo): JsonValue {
  const value: Record<string, JsonValue> = {
    name: info.name,
    kind: info.kind,
    access: info.access,
  };
  if (info.description !== undefined) value.description = info.description;
  if (info.rows !== undefined) value.rows = info.rows;
  if (info.columns !== undefined) value.columns = info.columns;
  return value;
}

/** Waits for a promise, but gives up as soon as the signal aborts (e.g. the user stops the chat). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}
