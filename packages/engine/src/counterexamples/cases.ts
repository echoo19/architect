import type { CaseTable, HarnessTool, JsonValue } from '@architect/shared';
import { contentHash } from '../sandbox/protocol';
import type { Sandbox, SandboxData, SandboxOutcome } from '../sandbox/types';
import type { CaseData } from './reduce';

/** The tables and texts a helper call was given, as a case. */
export function caseOf(data: SandboxData): CaseData {
  return {
    tables: Object.fromEntries(
      Object.entries(data.tables).map(([name, table]) => [
        name,
        { columns: [...table.columns], rows: table.rows.map((row) => ({ ...row })) },
      ]),
    ),
    texts: { ...data.texts },
  };
}

/** A case as the sandbox hands data to a helper: every file read-only, described as it is. */
export function sandboxDataOf(data: CaseData): SandboxData {
  return {
    files: [
      ...Object.entries(data.tables).map(([name, table]: [string, CaseTable]) => ({
        name,
        kind: 'table' as const,
        access: 'read' as const,
        rows: table.rows.length,
        columns: [...table.columns],
      })),
      ...Object.keys(data.texts).map((name) => ({
        name,
        kind: 'text' as const,
        access: 'read' as const,
      })),
    ],
    tables: data.tables,
    texts: data.texts,
  };
}

/** sha256 of a case: its tables and texts, keys in order. */
export function caseHash(data: CaseData): string {
  const sorted = <T>(record: Record<string, T>) =>
    Object.keys(record)
      .sort()
      .map((key) => [key, record[key]] as const);
  return contentHash(JSON.stringify({ tables: sorted(data.tables), texts: sorted(data.texts) }));
}

export function codeHash(code: string): string {
  return contentHash(code);
}

/** Runs a helper on a case in the sandbox. */
export function runOnCase(
  sandbox: Sandbox,
  tool: Pick<HarnessTool, 'name' | 'code'>,
  args: Record<string, JsonValue>,
  data: CaseData,
): Promise<SandboxOutcome> {
  return sandbox.runTool(tool, args, sandboxDataOf(data));
}
