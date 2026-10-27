import { z } from 'zod';

export const DataFileSchema = z.object({
  /** File name relative to the job's data folder, e.g. `invoices.csv`. */
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}$/),
  kind: z.enum(['table', 'text']),
  access: z.enum(['read', 'write']),
  description: z.string().optional(),
});
export type DataFile = z.infer<typeof DataFileSchema>;

export type CellValue = string | number | boolean | null;
export type TableRow = Record<string, CellValue>;

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
 * Tools every agent gets from the runner. Their behaviour is fixed by the job's data
 * declarations and permissions; the mentor can't change them.
 */
export const BUILTIN_TOOL_NAMES = [
  'list_files',
  'read_table',
  'read_text',
  'calculate',
  'append_rows',
  'update_rows',
  'load_skill',
] as const;
export type BuiltinToolName = (typeof BUILTIN_TOOL_NAMES)[number];

export const WRITE_TOOL_NAMES: readonly BuiltinToolName[] = ['append_rows', 'update_rows'];

export function isBuiltinTool(name: string): name is BuiltinToolName {
  return (BUILTIN_TOOL_NAMES as readonly string[]).includes(name);
}
