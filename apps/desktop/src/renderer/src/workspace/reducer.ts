import type { WorkspaceChat, WorkspaceEvent, WorkspaceMessage } from '@architect/shared';

/** A list read over the bridge. A reload or a failed reload keeps the last data it had. */
export type Loadable<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; error: string; data?: T }
  | { status: 'ready'; data: T };

export interface WorkspaceState {
  /** Each agent's chats by graduate id, in the host's order, newest chats added on top. */
  chats: Record<string, Loadable<WorkspaceChat[]>>;
  /** Each chat's messages by chat id, oldest first. */
  messages: Record<string, Loadable<WorkspaceMessage[]>>;
}

export type WorkspaceAction =
  | WorkspaceEvent
  | { type: 'chats.loading'; graduateId: string }
  | { type: 'chats.loaded'; graduateId: string; chats: WorkspaceChat[] }
  | { type: 'chats.failed'; graduateId: string; error: string }
  | { type: 'messages.loading'; chatId: string }
  | { type: 'messages.loaded'; chatId: string; messages: WorkspaceMessage[] }
  | { type: 'messages.failed'; chatId: string; error: string }
  | { type: 'graduate.removed'; graduateId: string };

export const emptyWorkspace = (): WorkspaceState => ({ chats: {}, messages: {} });

function loading<T>(entry: Loadable<T> | undefined): Loadable<T> {
  return entry?.data === undefined
    ? { status: 'loading' }
    : { status: 'loading', data: entry.data };
}

function failed<T>(entry: Loadable<T> | undefined, error: string): Loadable<T> {
  return entry?.data === undefined
    ? { status: 'error', error }
    : { status: 'error', error, data: entry.data };
}

function withData<T>(entry: Loadable<T>, data: T): Loadable<T> {
  return { ...entry, data };
}

/** Replaces a message in place, or adds it at the end when it's new. */
function upsertMessage(
  messages: WorkspaceMessage[],
  message: WorkspaceMessage,
): WorkspaceMessage[] {
  const index = messages.findIndex((m) => m.id === message.id);
  if (index === -1) return [...messages, message];
  return messages.map((m, i) => (i === index ? message : m));
}

/** Replaces a chat in place, or adds it at the top when it's new. */
function upsertChat(chats: WorkspaceChat[], chat: WorkspaceChat): WorkspaceChat[] {
  const index = chats.findIndex((c) => c.id === chat.id);
  if (index === -1) return [chat, ...chats];
  return chats.map((c, i) => (i === index ? chat : c));
}

/**
 * Applies a load result or a live event. Events only touch lists that are already loaded: the
 * host answers a read after every event it sent before, so a list that is still loading will
 * arrive with those changes in it.
 */
export function workspaceReducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case 'chats.loading':
      return {
        ...state,
        chats: { ...state.chats, [action.graduateId]: loading(state.chats[action.graduateId]) },
      };
    case 'chats.loaded':
      return {
        ...state,
        chats: { ...state.chats, [action.graduateId]: { status: 'ready', data: action.chats } },
      };
    case 'chats.failed':
      return {
        ...state,
        chats: {
          ...state.chats,
          [action.graduateId]: failed(state.chats[action.graduateId], action.error),
        },
      };
    case 'messages.loading':
      return {
        ...state,
        messages: { ...state.messages, [action.chatId]: loading(state.messages[action.chatId]) },
      };
    case 'messages.loaded':
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: { status: 'ready', data: action.messages },
        },
      };
    case 'messages.failed':
      return {
        ...state,
        messages: {
          ...state.messages,
          [action.chatId]: failed(state.messages[action.chatId], action.error),
        },
      };
    case 'message.updated': {
      const { chatId } = action.message;
      const entry = state.messages[chatId];
      if (entry?.data === undefined) return state;
      return {
        ...state,
        messages: {
          ...state.messages,
          [chatId]: withData(entry, upsertMessage(entry.data, action.message)),
        },
      };
    }
    case 'chat.updated': {
      const { graduateId } = action.chat;
      const entry = state.chats[graduateId];
      if (entry?.data === undefined) return state;
      return {
        ...state,
        chats: {
          ...state.chats,
          [graduateId]: withData(entry, upsertChat(entry.data, action.chat)),
        },
      };
    }
    case 'graduate.removed': {
      const { [action.graduateId]: removed, ...chats } = state.chats;
      const gone = new Set((removed?.data ?? []).map((chat) => chat.id));
      const messages = Object.fromEntries(
        Object.entries(state.messages).filter(([chatId]) => !gone.has(chatId)),
      );
      return { chats, messages };
    }
  }
}
