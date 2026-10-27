import {
  newId,
  type AgentBlock,
  type AgentStep,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';

export const NEW_CHAT_TITLE = 'New chat';
const TITLE_CHARS = 40;

/** How a reply ended. Stopped means the user stopped it; an error says what went wrong. */
export type ReplyOutcome = { status: 'done' | 'stopped' } | { status: 'error'; error: string };

export const INTERRUPTED: ReplyOutcome = {
  status: 'error',
  error: 'Architect closed before this reply finished.',
};

export function newChat(graduateId: string, at: string): WorkspaceChat {
  return {
    id: newId('cht'),
    graduateId,
    title: NEW_CHAT_TITLE,
    createdAt: at,
    updatedAt: at,
    running: false,
    waiting: false,
  };
}

/** A chat is named after its first message, on one line and at most 40 characters long. */
export function chatTitle(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(line);
  if (characters.length <= TITLE_CHARS) return line;
  return `${characters
    .slice(0, TITLE_CHARS - 1)
    .join('')
    .trimEnd()}…`;
}

export function userMessage(chatId: string, text: string, at: string): WorkspaceMessage {
  return { ...message(chatId, 'user', at), text, status: 'done' };
}

export function agentMessage(chatId: string, at: string): WorkspaceMessage {
  return { ...message(chatId, 'agent', at), status: 'streaming' };
}

/** A reply in its final state: nothing left running and no write left waiting for a decision. */
export function settleMessage(reply: WorkspaceMessage, outcome: ReplyOutcome): WorkspaceMessage {
  return {
    ...reply,
    ...outcome,
    text: reply.text.trim(),
    steps: reply.steps.map((step): AgentStep =>
      step.status === 'running' ? { ...step, status: 'done', meta: step.meta ?? 'stopped' } : step,
    ),
    blocks: reply.blocks.map((block): AgentBlock =>
      block.kind === 'approval' && block.status === 'pending'
        ? { ...block, status: 'denied' }
        : block,
    ),
  };
}

function message(
  chatId: string,
  role: WorkspaceMessage['role'],
  at: string,
): Omit<WorkspaceMessage, 'status'> {
  return { id: newId('msg'), chatId, role, createdAt: at, text: '', steps: [], blocks: [] };
}
