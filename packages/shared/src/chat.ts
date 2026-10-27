import { z } from 'zod';
import { JsonSchemaObjectSchema, JsonValueSchema } from './json';

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), JsonValueSchema),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const ChatMessageSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal('system'), content: z.string() }),
  z.object({ role: z.literal('user'), content: z.string() }),
  z.object({
    role: z.literal('assistant'),
    content: z.string(),
    toolCalls: z.array(ToolCallSchema).optional(),
  }),
  z.object({
    role: z.literal('tool'),
    toolCallId: z.string(),
    name: z.string(),
    content: z.string(),
  }),
]);
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ToolSpecSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  description: z.string(),
  parameters: JsonSchemaObjectSchema,
});
export type ToolSpec = z.infer<typeof ToolSpecSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  reasoningTokens: z.number().int().nonnegative().optional(),
  cachedInputTokens: z.number().int().nonnegative().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const emptyUsage = (): Usage => ({ inputTokens: 0, outputTokens: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: (a.reasoningTokens ?? 0) + (b.reasoningTokens ?? 0),
    cachedInputTokens: (a.cachedInputTokens ?? 0) + (b.cachedInputTokens ?? 0),
  };
}
