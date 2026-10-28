import type { BuiltinToolName } from '@architect/shared';
import { z } from 'zod';
import { MAX_GREP_MATCHES, MAX_READ_LINES } from './specs';
import { ToolError } from './errors';

/** Models often send a number as text, like "10"; it is read as the number. */
const count = (max?: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value) : value),
    max === undefined ? z.number().int().min(1) : z.number().int().min(1).max(max),
  );

/** Models used to other agents name a file `file_path` or `file`; both are read as `path`. */
function withPath<Shape extends z.ZodRawShape>(shape: Shape) {
  return z.preprocess((value) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
    const { file_path: filePath, file, ...rest } = value as Record<string, unknown>;
    if ('path' in rest) return value;
    const alias = filePath ?? file;
    return alias === undefined ? rest : { ...rest, path: alias };
  }, z.strictObject(shape));
}

const ARGUMENTS = {
  read: withPath({
    path: z.string(),
    offset: count().optional(),
    limit: count(MAX_READ_LINES).optional(),
  }),
  ls: withPath({ path: z.string().optional() }),
  glob: z.strictObject({ pattern: z.string().min(1) }),
  grep: withPath({
    pattern: z.string().min(1),
    path: z.string().optional(),
    glob: z.string().min(1).optional(),
    ignore_case: z.boolean().optional(),
    limit: count(MAX_GREP_MATCHES).optional(),
  }),
  write: withPath({ path: z.string(), content: z.string() }),
  edit: withPath({
    path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
    replace_all: z.boolean().optional(),
  }),
  append: withPath({ path: z.string(), text: z.string() }),
  run: z.strictObject({ code: z.string() }),
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
