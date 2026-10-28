import type { HarnessTool, JsonValue } from '@architect/shared';
import type { FileInfo, TableSnapshot } from '../data/types';
import type { SandboxFailure } from './protocol';

export type { SandboxFailure } from './protocol';

export type SandboxOutcome =
  { ok: true; value: JsonValue } | { ok: false; failure: SandboxFailure };

/** The data a harness tool may read: the job's declared files as they are right now. */
export interface SandboxData {
  files: readonly FileInfo[];
  tables: Readonly<Record<string, TableSnapshot>>;
  texts: Readonly<Record<string, string>>;
}

/** What an end-state validator sees: the attempt's end state, the original data and the reply. */
export interface ValidatorContext {
  tables: Readonly<Record<string, TableSnapshot>>;
  originalTables: Readonly<Record<string, TableSnapshot>>;
  answer: JsonValue | null;
  finalText: string;
  toolCalls: readonly { name: string; arguments: Record<string, JsonValue> }[];
}

/** JavaScript the agent sent to `run`. */
export interface CodeRequest {
  code: string;
  /** Every file the code may read, by its path in the agent's folder. */
  files: Readonly<Record<string, string>>;
  /** The working date, YYYY-MM-DD, which the code sees as `today`. */
  today: string;
}

/**
 * What code printed and the JSON of its last expression's value, null when that was undefined.
 * `error` says why the code stopped, when it threw, ran too long or ran out of memory; what it
 * printed until then is kept.
 */
export type CodeOutcome =
  | { ok: true; printed: string; cut: boolean; value: string | null; error?: SandboxFailure }
  | { ok: false; failure: SandboxFailure };

/** A regular expression search, line by line, for the agent's `grep`. */
export interface GrepRequest {
  pattern: string;
  ignoreCase: boolean;
  /** The files to search, in order, by path. */
  files: Readonly<Record<string, string>>;
  /** Matching lines to return; the rest are counted. */
  limit: number;
  /** Characters kept of a long matching line. */
  lineChars: number;
}

export interface GrepMatch {
  path: string;
  line: number;
  text: string;
}

export type GrepOutcome =
  { ok: true; matches: GrepMatch[]; total: number } | { ok: false; failure: SandboxFailure };

/**
 * Runs mentor-written tools, job checker modules, the agent's `run` code and `grep` searches in
 * QuickJS inside a child process, with no clock, no randomness, no I/O and only the data passed
 * in. Failures come back as outcomes, never as exceptions.
 */
export interface Sandbox {
  runTool(
    tool: Pick<HarnessTool, 'name' | 'code'>,
    args: Record<string, JsonValue>,
    data: SandboxData,
  ): Promise<SandboxOutcome>;
  runValidator(
    source: string,
    validator: string,
    params: Record<string, JsonValue>,
    context: ValidatorContext,
  ): Promise<SandboxOutcome>;
  /**
   * Loads a tool's code, which runs its top level only, and checks that it defines `run`. The
   * tool itself isn't called and sees no data. Succeeds with null.
   */
  checkTool(tool: Pick<HarnessTool, 'name' | 'code'>): Promise<SandboxOutcome>;
  /** Runs the agent's code with read-only access to its files. */
  runCode(request: CodeRequest): Promise<CodeOutcome>;
  grep(request: GrepRequest): Promise<GrepOutcome>;
  dispose(): Promise<void>;
}
