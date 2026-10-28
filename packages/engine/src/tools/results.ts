import type { JsonValue } from '@architect/shared';

/** Characters a tool result may take in the conversation. Glimmer's context is small. */
export const DEFAULT_RESULT_BUDGET = 8000;
export const MIN_RESULT_BUDGET = 1000;
const ERROR_LIMIT = 1000;

export interface RenderedResult {
  /** The tool message content the model reads. */
  content: string;
  /** The result as the model saw it: the value, or the text it was given. */
  result: JsonValue;
}

/**
 * A result as the model reads it. Text, which every built-in tool returns, goes as it is; any
 * other value, such as a harness tool's, goes as JSON. Either is cut to the budget with a note.
 */
export function renderResult(value: JsonValue, budget: number): RenderedResult {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (text.length <= budget) return { content: text, result: value };
  const content = cutText(text, budget, 'ask for less');
  return { content, result: content };
}

/** Text cut to a budget, with a note saying how long it was and what to do instead. */
export function cutText(text: string, budget: number, instead: string): string {
  if (text.length <= budget) return text;
  const note = `\n[cut: ${text.length.toLocaleString('en-US')} characters in all, and the limit is ${budget.toLocaleString('en-US')}; ${instead}]`;
  return `${text.slice(0, Math.max(0, budget - note.length))}${note}`;
}

/** An error the model reads: one plain line, starting with "Error:". */
export function renderError(message: string): { content: string; error: string } {
  const error = message.length > ERROR_LIMIT ? `${message.slice(0, ERROR_LIMIT)}…` : message;
  return { content: `Error: ${error}`, error };
}
