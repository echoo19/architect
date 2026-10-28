import { z } from 'zod';

/** The parts of Anthropic's Messages API that Architect reads. Extra fields are ignored. */

const count = z.number().int().nonnegative();

export const UsageWire = z.object({
  input_tokens: count.nullish(),
  output_tokens: count.nullish(),
  cache_read_input_tokens: count.nullish(),
  cache_creation_input_tokens: count.nullish(),
});
export type UsageWire = z.output<typeof UsageWire>;

const Supported = z.object({ supported: z.boolean() }).nullish();

export const ModelInfoWire = z.object({
  id: z.string(),
  display_name: z.string().nullish(),
  max_input_tokens: count.nullish(),
  capabilities: z
    .object({
      structured_outputs: Supported,
      effort: z
        .object({ supported: z.boolean(), low: Supported, medium: Supported, high: Supported })
        .nullish(),
    })
    .nullish(),
});
export type ModelInfoWire = z.output<typeof ModelInfoWire>;

export const ModelPageWire = z.object({
  data: z.array(ModelInfoWire),
  has_more: z.boolean().nullish(),
  last_id: z.string().nullish(),
});

export const MessageStartWire = z.object({
  type: z.literal('message_start'),
  message: z.object({ usage: UsageWire.nullish() }),
});

export const BlockStartWire = z.object({
  type: z.literal('content_block_start'),
  index: count,
  content_block: z.object({ type: z.string(), name: z.string().nullish() }),
});

export const BlockDeltaWire = z.object({
  type: z.literal('content_block_delta'),
  index: count,
  delta: z.object({
    type: z.string(),
    text: z.string().nullish(),
    partial_json: z.string().nullish(),
  }),
});

export const MessageDeltaWire = z.object({
  type: z.literal('message_delta'),
  delta: z.object({
    stop_reason: z.string().nullish(),
    stop_details: z.object({ category: z.string().nullish() }).nullish(),
  }),
  usage: UsageWire.nullish(),
});
