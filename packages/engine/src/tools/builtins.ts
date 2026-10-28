import type {
  BuiltinToolName,
  JsonValue,
  RowDiff,
  TableView,
  WriteRecord,
  WriteToolName,
} from '@architect/shared';
import { SaveError } from '../data/errors';
import type { AgentFiles, PlannedChange } from '../files/agent-files';
import { globMatcher } from '../files/glob';
import { agentPath, isWithin } from '../files/paths';
import { linesOf } from '../files/text';
import type { Sandbox } from '../sandbox/types';
import { parseArguments } from './arguments';
import { ToolError } from './errors';
import { globList, GREP_LINE_CHARS, grepList, listing, readPage, runOutput } from './format';
import { DEFAULT_GREP_MATCHES, DEFAULT_READ_LINES } from './specs';

/** A change waiting for the user's decision in the workspace. */
export interface PendingWrite {
  tool: WriteToolName;
  /** The file it changes, e.g. `data/invoices.csv`. */
  path: string;
  /** e.g. "Add 1 row to data/invoices.csv" */
  summary: string;
  patch: string;
  /** For a table, the rows the change adds, removes and changes. */
  rows?: RowDiff;
}

export type WriteDecision = 'approve' | 'deny';

/**
 * Asks the user to approve a change. Absent in task mode, where changes go straight to the
 * attempt's scratch copy of the files.
 */
export interface ApproveWrite {
  (change: PendingWrite, signal?: AbortSignal): Promise<WriteDecision>;
  /**
   * An approved change couldn't be saved. Shows why, and resolves true when the user asks to try
   * again; false gives up, and the call fails with the reason. Without it, the call fails at once.
   */
  saveFailed?(change: PendingWrite, reason: string, signal?: AbortSignal): Promise<boolean>;
}

export interface ExecutorResult {
  value: JsonValue;
  /** Set when the call read one of the agent's skills. */
  loadedSkill?: string;
  /** The change a write tool made or asked for. */
  change?: WriteRecord;
  /** The rows a read of a table showed. */
  table?: TableView;
}

export type Executor = (args: unknown, signal?: AbortSignal) => Promise<ExecutorResult>;

interface BuiltinDeps {
  files: AgentFiles;
  sandbox: Sandbox;
  /** The working date, which `run` code sees as `today`. */
  today: string;
  approveWrite?: ApproveWrite;
  budget: number;
}

const SKILL_FILE = /^skills\/([^/]+)\/SKILL\.md$/;
/** Rows a read of a table keeps for people to see; the agent sees what fits its budget. */
const TABLE_VIEW_ROWS = 200;

export function builtinExecutors(deps: BuiltinDeps): Record<BuiltinToolName, Executor> {
  const { files, sandbox, budget } = deps;

  async function change(plan: PlannedChange, signal?: AbortSignal): Promise<ExecutorResult> {
    if (!plan.changes) return { value: plan.done };
    const record = (applied: boolean): WriteRecord => ({
      path: plan.path,
      op: plan.op,
      patch: plan.patch,
      ...(plan.rows === undefined ? {} : { rows: plan.rows }),
      applied,
    });
    const approver = deps.approveWrite;
    if (!approver) {
      await files.apply(plan);
      return { value: plan.done, change: record(true) };
    }
    const pending: PendingWrite = {
      tool: plan.op,
      path: plan.path,
      summary: plan.summary,
      patch: plan.patch,
      ...(plan.rows === undefined ? {} : { rows: plan.rows }),
    };
    const decision = await untilAborted(approver(pending, signal), signal);
    if (decision !== 'approve') {
      return {
        value: `The user declined this change, so nothing was written: ${plan.summary}.`,
        change: record(false),
      };
    }
    // Saving can fail after the user said yes (another program holds the file, say). Nothing was
    // written then, so the approver may show why and let the user try again.
    for (;;) {
      try {
        await files.apply(plan);
        return { value: plan.done, change: record(true) };
      } catch (error) {
        if (!(error instanceof SaveError) || !approver.saveFailed) throw error;
        const again = await untilAborted(
          approver.saveFailed(pending, error.message, signal),
          signal,
        );
        if (!again) throw error;
      }
    }
  }

  return {
    async read(args) {
      const { path, offset = 1, limit = DEFAULT_READ_LINES } = parseArguments('read', args);
      const clean = agentPath(path);
      const text = files.read(clean);
      const page = readPage(clean, text, offset, limit, budget);
      const skill = SKILL_FILE.exec(clean)?.[1];
      const table = tableView(files, clean, text, page.from, page.to);
      return {
        value: page.content,
        ...(skill === undefined ? {} : { loadedSkill: skill }),
        ...(table === undefined ? {} : { table }),
      };
    },
    async ls(args) {
      const { path = '' } = parseArguments('ls', args);
      return { value: listing(files, agentPath(path), budget) };
    },
    async glob(args) {
      const { pattern } = parseArguments('glob', args);
      const matches = globMatcher(pattern);
      const paths = files
        .list()
        .map((file) => file.path)
        .filter(matches);
      return { value: globList(pattern, paths) };
    },
    async grep(args) {
      const {
        pattern,
        path = '',
        glob,
        ignore_case: ignoreCase = false,
        limit,
      } = parseArguments('grep', args);
      const invalid = patternProblem(pattern, ignoreCase ? 'i' : '');
      if (invalid !== null) {
        throw new ToolError(`The pattern isn't a regular expression: ${invalid}`);
      }
      const scope = agentPath(path);
      if (scope !== '' && !files.file(scope) && !files.isFolder(scope)) files.read(scope);
      const inScope = (file: string) => file === scope || isWithin(file, scope);
      const matchesGlob = glob === undefined ? () => true : globMatcher(glob);
      const texts = files.texts();
      const searched = Object.fromEntries(
        files
          .list()
          .map((file) => file.path)
          .filter((file) => inScope(file) && matchesGlob(file))
          .map((file) => [file, texts[file] ?? '']),
      );
      const outcome = await sandbox.grep({
        pattern,
        ignoreCase,
        files: searched,
        limit: limit ?? DEFAULT_GREP_MATCHES,
        lineChars: GREP_LINE_CHARS,
      });
      if (!outcome.ok) {
        throw new ToolError(
          outcome.failure.kind === 'timeout'
            ? 'The search ran too long and was stopped. Try a simpler pattern, or search fewer files.'
            : `The search failed: ${outcome.failure.message}`,
        );
      }
      const where = scope === '' ? 'any file' : scope;
      return { value: grepList(outcome.matches, outcome.total, where, budget) };
    },
    async write(args, signal) {
      const { path, content } = parseArguments('write', args);
      return change(files.plan('write', path, content), signal);
    },
    async edit(args, signal) {
      const {
        path,
        old_string: before,
        new_string: after,
        replace_all: all = false,
      } = parseArguments('edit', args);
      const clean = agentPath(path);
      const text = files.read(clean);
      if (before === '') {
        throw new ToolError(
          'old_string is empty. To add text, use append, or give the text around where it goes.',
        );
      }
      if (before === after) {
        throw new ToolError('old_string and new_string are the same, so nothing would change.');
      }
      const target = before.replace(/\r\n?/g, '\n');
      const found = text.split(target).length - 1;
      if (found === 0) {
        throw new ToolError(
          `old_string isn't in ${clean}. Read the file and copy the text exactly, with its spaces and line breaks.`,
        );
      }
      if (found > 1 && !all) {
        throw new ToolError(
          `old_string is in ${clean} ${found} times. Give more of the text around it so it matches once, or set replace_all to change all ${found}.`,
        );
      }
      const replacement = after.replace(/\r\n?/g, '\n');
      const next = all
        ? text.split(target).join(replacement)
        : text.replace(target, () => replacement);
      return change(files.plan('edit', clean, next), signal);
    },
    async append(args, signal) {
      const { path, text: added } = parseArguments('append', args);
      if (added.trim() === '') throw new ToolError('text is empty, so there is nothing to add.');
      const clean = agentPath(path);
      const exists = files.file(clean) !== undefined;
      const text = exists ? files.read(clean) : '';
      const joined = text === '' || text.endsWith('\n') ? text : `${text}\n`;
      const tail = added.replace(/\r\n?/g, '\n');
      return change(
        files.plan('append', clean, `${joined}${tail}${tail.endsWith('\n') ? '' : '\n'}`),
        signal,
      );
    },
    async run(args) {
      const { code } = parseArguments('run', args);
      if (code.trim() === '') throw new ToolError('code is empty, so there is nothing to run.');
      const outcome = await sandbox.runCode({ code, files: files.texts(), today: deps.today });
      if (!outcome.ok) throw new ToolError(`The code couldn't run: ${outcome.failure.message}`);
      if (outcome.error) {
        const printed = outcome.printed.trimEnd();
        throw new ToolError(
          printed === ''
            ? outcome.error.message
            : `${outcome.error.message}\nIt printed this before it stopped:\n${printed}`,
        );
      }
      return { value: runOutput(outcome.printed, outcome.cut, outcome.value, budget) };
    },
  };
}

/**
 * The rows a read of a table showed, when each of its lines holds one row: the data lines
 * between `from` and `to`, line 1 being the header.
 */
function tableView(
  files: AgentFiles,
  path: string,
  text: string,
  from: number,
  to: number,
): TableView | undefined {
  const table = files.tableAt(path);
  if (!table || to < 2 || table.rows.length !== linesOf(text).length - 1) return undefined;
  const rows = table.rows
    .slice(Math.max(0, from - 2), to - 1)
    .slice(0, TABLE_VIEW_ROWS)
    .map((row) => table.columns.map((column) => row[column] ?? null));
  return { columns: [...table.columns], rows, total: table.rows.length };
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

/** Why a pattern isn't a regular expression, or null when it is. Compiling one is quick and safe. */
function patternProblem(pattern: string, flags: string): string | null {
  try {
    RegExp(pattern, flags);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
