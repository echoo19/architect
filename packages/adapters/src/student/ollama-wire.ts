import type { ChatMessage, JsonValue } from '@architect/shared';
import { z } from 'zod';

/** The parts of Ollama's native API that Architect reads. Extra fields are ignored. */

const count = z.number().int().nonnegative();

export const OllamaChunkWire = z.object({
  message: z
    .object({
      content: z.string().nullish(),
      /** Reasoning text. Counted for the usage record, never shown in a transcript. */
      thinking: z.string().nullish(),
      tool_calls: z
        .array(z.object({ function: z.object({ name: z.string(), arguments: z.unknown() }) }))
        .nullish(),
    })
    .nullish(),
  done: z.boolean().nullish(),
  done_reason: z.string().nullish(),
  prompt_eval_count: count.nullish(),
  eval_count: count.nullish(),
});
export type OllamaChunkWire = z.output<typeof OllamaChunkWire>;

export const VersionWire = z.object({ version: z.string() });

export const TagsWire = z.object({
  models: z.array(z.object({ name: z.string(), size: z.number(), digest: z.string() })),
});

export const ShowWire = z.object({
  details: z.object({ quantization_level: z.string().nullish() }).nullish(),
  model_info: z.record(z.string(), z.unknown()).nullish(),
  capabilities: z.array(z.string()).nullish(),
});
export type ShowWire = z.output<typeof ShowWire>;

export const PullLineWire = z.object({
  status: z.string().nullish(),
  digest: z.string().nullish(),
  total: count.nullish(),
  completed: count.nullish(),
  error: z.string().nullish(),
});

export const AnyObjectWire = z.object({});

interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: { function: { name: string; arguments: Record<string, JsonValue> } }[];
  tool_name?: string;
}

/** Ollama takes tool arguments as objects and matches tool results to calls by tool name. */
export function toOllamaMessages(messages: readonly ChatMessage[]): OllamaMessage[] {
  return messages.map((message): OllamaMessage => {
    switch (message.role) {
      case 'system':
      case 'user':
        return { role: message.role, content: message.content };
      case 'assistant':
        return message.toolCalls?.length
          ? {
              role: 'assistant',
              content: message.content,
              tool_calls: message.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : { role: 'assistant', content: message.content };
      case 'tool':
        return { role: 'tool', tool_name: message.name, content: message.content };
    }
  });
}

/** Ollama writes `muse-glimmer` and `muse-glimmer:latest` for the same model. */
export function sameModel(a: string, b: string): boolean {
  const withTag = (name: string) => (name.includes(':') ? name : `${name}:latest`);
  return withTag(a) === withTag(b);
}
