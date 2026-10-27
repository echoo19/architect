import { ToolCallSchema, type ChatMessage, type ToolCall } from '@architect/shared';
import { badResponse } from './http/errors';

/** How many tool calls the assistant turns in a transcript already hold. */
export function countToolCalls(messages: readonly ChatMessage[]): number {
  let total = 0;
  for (const message of messages) {
    if (message.role === 'assistant') total += message.toolCalls?.length ?? 0;
  }
  return total;
}

/**
 * Ids for tool calls the server didn't number. They come from the call's position in the
 * transcript, not from a counter or randomness, so the same transcript always gets the same ids
 * and no two calls in it share one.
 */
export function callId(position: number): string {
  return `call_${position}`;
}

/** Tool arguments as a JSON object, from the JSON text a model wrote or an object a runtime parsed. */
export function parseToolArguments(
  raw: unknown,
  name: string,
  service: string,
): ToolCall['arguments'] {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') return {};
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      throw badResponse(service, `a call to "${name}" whose arguments aren't valid JSON`, cause);
    }
  }
  if (value === undefined || value === null) return {};

  const parsed = ToolCallSchema.shape.arguments.safeParse(value);
  if (!parsed.success) {
    throw badResponse(
      service,
      `a call to "${name}" whose arguments aren't a JSON object`,
      parsed.error,
    );
  }
  return parsed.data;
}
