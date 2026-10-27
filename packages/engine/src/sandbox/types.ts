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

/**
 * Runs mentor-written tools and job checker modules in QuickJS inside a child process, with no
 * clock, no randomness, no I/O and only the data passed in. Failures come back as outcomes,
 * never as exceptions.
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
  dispose(): Promise<void>;
}
