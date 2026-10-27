import { WhereClauseSchema, type BuiltinToolName } from '@architect/shared';
import { z } from 'zod';
import { ToolError } from './errors';

/** Models often send a single condition where a list is expected; accept it as a list of one. */
const WhereList = z.preprocess(
  (value) =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? [value] : value,
  z.array(WhereClauseSchema),
);
const Cell = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const FileName = z.string().min(1);

const ARGUMENTS = {
  list_files: z.strictObject({}),
  read_table: z.strictObject({
    file: FileName,
    where: WhereList.optional(),
    columns: z.array(z.string().min(1)).optional(),
    limit: z.number().int().min(0).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  read_text: z.strictObject({ file: FileName, offset: z.number().int().min(0).optional() }),
  calculate: z.strictObject({ expression: z.string() }),
  append_rows: z.strictObject({ file: FileName, rows: z.array(z.record(z.string(), Cell)).min(1) }),
  update_rows: z.strictObject({
    file: FileName,
    where: WhereList,
    set: z.record(z.string(), Cell),
  }),
  load_skill: z.strictObject({ name: z.string().min(1) }),
} satisfies Record<BuiltinToolName, z.ZodType>;

export type BuiltinArguments = { [Name in BuiltinToolName]: z.infer<(typeof ARGUMENTS)[Name]> };

/** Validates a built-in tool's arguments, explaining any problem in terms the model can act on. */
export function parseArguments<Name extends BuiltinToolName>(
  name: Name,
  args: unknown,
): BuiltinArguments[Name] {
  const result = ARGUMENTS[name].safeParse(args);
  if (result.success) return result.data as BuiltinArguments[Name];
  const problems = result.error.issues.slice(0, 3).map((issue) => {
    const path = issue.path.map(String).join('.');
    return path ? `${path}: ${issue.message}` : issue.message;
  });
  throw new ToolError(`Invalid arguments for ${name}. ${problems.join('; ')}.`);
}
