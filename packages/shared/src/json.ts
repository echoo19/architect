import { z } from 'zod';

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/** JSON Schema object used for tool parameters. Validated structurally, not semantically. */
export const JsonSchemaObjectSchema = z.object({ type: z.literal('object') }).catchall(z.unknown());
export type JsonSchemaObject = z.infer<typeof JsonSchemaObjectSchema>;
