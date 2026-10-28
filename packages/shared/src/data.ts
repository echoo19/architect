import { z } from 'zod';

export const DataFileSchema = z.object({
  /** File name relative to the job's data folder, e.g. `invoices.csv`. The agent sees `data/<name>`. */
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/),
  kind: z.enum(['table', 'text']),
  access: z.enum(['read', 'write']),
  description: z.string().optional(),
});
export type DataFile = z.infer<typeof DataFileSchema>;

export type CellValue = string | number | boolean | null;
export type TableRow = Record<string, CellValue>;

/** A row filter for `ctx.readTable` in harness tools. */
export const WhereClauseSchema = z.object({
  column: z.string().min(1),
  op: z.enum(['=', '!=', '>', '>=', '<', '<=', 'contains', 'in']),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(z.union([z.string(), z.number()])),
  ]),
});
export type WhereClause = z.infer<typeof WhereClauseSchema>;

/**
 * Tools every agent gets from the runner: a coding agent's file tools over the agent's folder,
 * and `run` for JavaScript in the sandbox. What they may reach is fixed by the job's data
 * declarations and permissions; the mentor can't change them.
 */
export const BUILTIN_TOOL_NAMES = [
  'read',
  'ls',
  'glob',
  'grep',
  'write',
  'edit',
  'append',
  'run',
] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

/** The tools that change a file, each through the job's write permissions. */
export const WRITE_TOOL_NAMES = [
  'write',
  'edit',
  'append',
] as const satisfies readonly BuiltinToolName[];
export type WriteToolName = (typeof WRITE_TOOL_NAMES)[number];

export function isBuiltinTool(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}

export function isWriteTool(name: string): name is WriteToolName {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

/**
 * The agent's folder: the job's files under `data/`, an `output/` folder when the job allows
 * one, and its skills under `skills/`. Paths the agent sees are always these logical ones.
 */
export const DATA_FOLDER = 'data';
export const OUTPUT_FOLDER = 'output';
export const SKILLS_FOLDER = 'skills';

/** The logical path of a declared data file, e.g. `data/invoices.csv`. */
export function dataPath(name: string): string {
  return `${DATA_FOLDER}/${name}`;
}
