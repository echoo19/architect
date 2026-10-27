import type { AgentBlock, ChatMessage, WorkspaceMessage } from '@architect/shared';

type RefusalBlock = Extract<AgentBlock, { kind: 'refusal' }>;

/** Six exchanges: enough to follow a conversation, few enough to keep each step quick. */
const MAX_MESSAGES = 12;
/** Earlier messages may fill a quarter of the context; the rest is for the prompt, tools and work. */
const CONTEXT_SHARE = 0.25;
/** A rough count for English and JSON. The budget is loose enough that this needn't be exact. */
const CHARS_PER_TOKEN = 4;

/**
 * The end of a conversation as the student sees it, oldest first: the most recent messages that
 * fit both limits. Agent replies count by their text (a refusal by its reason), replies with
 * nothing to show are left out, and the history always opens with a user message.
 */
export function chatHistory(
  messages: readonly WorkspaceMessage[],
  contextLength: number,
): ChatMessage[] {
  const budget = Math.floor(contextLength * CONTEXT_SHARE);
  const kept: ChatMessage[] = [];
  let used = 0;
  for (const message of messages.flatMap(toChatMessage).reverse()) {
    const tokens = Math.ceil(message.content.length / CHARS_PER_TOKEN);
    if (kept.length === MAX_MESSAGES || used + tokens > budget) break;
    used += tokens;
    kept.unshift(message);
  }
  while (kept[0] !== undefined && kept[0].role !== 'user') kept.shift();
  return kept;
}

function toChatMessage(message: WorkspaceMessage): ChatMessage[] {
  if (message.role === 'user') return [{ role: 'user', content: message.text }];
  const refusal = message.blocks.find((block): block is RefusalBlock => block.kind === 'refusal');
  const content =
    message.text.trim() !== ''
      ? message.text
      : refusal
        ? `I can't help with ${refusal.taskType} requests. ${refusal.reason}`
        : '';
  return content === '' ? [] : [{ role: 'assistant', content }];
}
