import type { ChatMessage } from '@architect/shared';
import { fitsStrictSubset } from '../json-schema';

/** The Messages API version every request names. */
export const ANTHROPIC_VERSION = '2026-10-21';

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * A transcript in Anthropic's shape: system text goes to the top-level `system`, and the turns
 * keep their order. Tool turns, which mentor transcripts don't hold, become plain text, and an
 * empty assistant turn is left out because the API refuses empty text.
 */
export function toAnthropicMessages(messages: readonly ChatMessage[]): {
  system: string[];
  messages: AnthropicMessage[];
} {
  const system: string[] = [];
  const turns: AnthropicMessage[] = [];
  for (const message of messages) {
    switch (message.role) {
      case 'system':
        system.push(message.content);
        break;
      case 'user':
        turns.push({ role: 'user', content: message.content });
        break;
      case 'assistant': {
        const calls = (message.toolCalls ?? []).map(
          (call) => `${call.name}(${JSON.stringify(call.arguments)})`,
        );
        const content = [message.content, ...calls].filter((part) => part.trim() !== '').join('\n');
        if (content !== '') turns.push({ role: 'assistant', content });
        break;
      }
      case 'tool':
        turns.push({ role: 'user', content: `Result of ${message.name}:\n${message.content}` });
        break;
    }
  }
  return { system, messages: turns };
}

/** A tool name Anthropic accepts: letters, digits, underscores and hyphens, at most 64. */
export function toolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'reply';
}

/** Constraints Anthropic's structured outputs don't take. */
const UNSUPPORTED = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

function usesUnsupported(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(usesUnsupported);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, inner]) => UNSUPPORTED.has(key) || usesUnsupported(inner),
  );
}

/** Whether `output_config.format` takes this schema: closed objects, and no number or size limits. */
export function fitsOutputFormat(schema: unknown): boolean {
  return fitsStrictSubset(schema) && !usesUnsupported(schema);
}
