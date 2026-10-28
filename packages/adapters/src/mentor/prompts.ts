import type { ChatMessage, JsonSchemaObject } from '@architect/shared';

/** For providers without constrained decoding: the schema goes into the prompt, the answer into a fence. */
export function jsonInstructions(json: { name: string; schema: JsonSchemaObject }): string {
  return [
    `Reply with one JSON object that follows the JSON Schema "${json.name}" below.`,
    'Put it in a single code block marked json, and write nothing after the block.',
    '',
    '```json',
    JSON.stringify(json.schema, null, 2),
    '```',
  ].join('\n');
}

/**
 * The turns that ask for a corrected reply: what the model wrote, then what was wrong with it.
 * An empty reply isn't echoed back, since some providers reject empty assistant turns.
 */
export function repairMessages(badReply: string, problem: string, fenced: boolean): ChatMessage[] {
  const format = fenced ? ', in a single code block marked json' : '';
  const ask: ChatMessage = {
    role: 'user',
    content: `That reply could not be used: ${problem}\nReply again with only the corrected JSON object${format}.`,
  };
  return badReply.trim() === '' ? [ask] : [{ role: 'assistant', content: badReply }, ask];
}

/** Why a JSON reply couldn't be used, even after one correction. */
export function unusableJson(problem: string, cutOff: boolean): string {
  return cutOff
    ? "The mentor's reply was cut off at the output limit, so its JSON was incomplete. Raise the limit or lower the reasoning effort."
    : `The mentor's reply was not valid JSON, even after one correction. ${problem}`;
}

/** Why a reply with no text couldn't be used. */
export function emptyReply(cutOff: boolean): string {
  return cutOff
    ? 'The mentor used its whole output limit on reasoning and wrote no answer. Raise the limit or lower the reasoning effort.'
    : 'The mentor sent an empty reply.';
}
