import { z } from 'zod';

/** The parts of the OpenAI Chat Completions wire format that Architect reads. Extra fields are ignored. */

const count = z.number().int().nonnegative();

export const UsageWire = z.object({
  prompt_tokens: count,
  completion_tokens: count,
  prompt_tokens_details: z.object({ cached_tokens: count.nullish() }).nullish(),
  completion_tokens_details: z.object({ reasoning_tokens: count.nullish() }).nullish(),
});
export type UsageWire = z.output<typeof UsageWire>;

const ToolCallDeltaWire = z.object({
  index: count.nullish(),
  id: z.string().nullish(),
  function: z.object({ name: z.string().nullish(), arguments: z.string().nullish() }).nullish(),
});
export type ToolCallDelta = z.output<typeof ToolCallDeltaWire>;

export const ChatChunkWire = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            /** Where hosts put reasoning text; Architect counts it and never shows it. */
            reasoning: z.string().nullish(),
            reasoning_content: z.string().nullish(),
            tool_calls: z.array(ToolCallDeltaWire).nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .nullish(),
  usage: UsageWire.nullish(),
});
export type ChatChunkWire = z.output<typeof ChatChunkWire>;

const ModelEntry = z.object({ id: z.string() });

/** `GET /models`: the standard `{ data: [...] }`, or a bare array as some hosts send. */
export const ModelListWire = z.union([
  z.object({ data: z.array(ModelEntry) }),
  z.array(ModelEntry),
]);
