import type { WorkspaceChat, WorkspaceEvent, WorkspaceMessage } from '@architect/shared';

/** A list read over the bridge. A reload or a failed reload keeps the last data it had. */
export type Loadable<T> =
  | { status: 'loading'; data?: T }
  | { status: 'error'; error: Error; data?: T }
  | { status: 'ready'; data: T };

export interface WorkspaceState {
  /**
   * Each agent's chats by graduate id and each team's by team id (`chatOwner`), in the host's
   * order, newest chats added on top.
   */
  chats: Record<string, Loadable<WorkspaceChat[]>>;
  /** Each chat's messages by chat id, oldest first. */
  messages: Record<string, Loadable<WorkspaceMessage[]>>;
}

export type WorkspaceAction =
  | WorkspaceEvent
  | { type: 'chats.loading'; owner: string }
  | { type: 'chats.loaded'; owner: string; chats: WorkspaceChat[] }
  | { type: 'chats.failed'; owner: string; error: Error }
  | { type: 'messages.loading'; chatId: string }
  | { type: 'messages.loaded'; chatId: string; messages: WorkspaceMessage[] }
  | { type: 'messages.failed'; chatId: string; error: Error }
  | { type: 'graduate.removed'; graduateId: string }
  | { type: 'team.removed'; teamId: string };

/** The list a chat belongs to: its team's, or its agent's when it is no team's. */
export function chatOwner(chat: Pick<WorkspaceChat, 'graduateId' | 'teamId'>): string {
  return chat.teamId ?? chat.graduateId;
}

export const emptyWorkspace = (): WorkspaceState => ({ chats: {}, messages: {} });

function loading<T>(entry: Loadable<T> | undefined): Loadable<T> {
  return entry?.data === undefined
    ? { status: 'loading' }
    : { status: 'loading', data: entry.data };
}

function failed<T>(entry: Loadable<T> | undefined, error: Error): Loadable<T> {
  return entry?.data === undefined
    ? { status: 'error', error }
    : { status: 'error', error, data: entry.data };
}

/** Drops a list of chats and the messages of every chat in it. */
function forget(state: WorkspaceState, owner: string): WorkspaceState {
  const { [owner]: removed, ...chats } = state.chats;
  const gone = new Set((removed?.data ?? []).map((chat) => chat.id));
  const messages = Object.fromEntries(
    Object.entries(state.messages).filter(([chatId]) => !gone.has(chatId)),
  );
  return { chats, messages };
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
        chats: { ...state.chats, [action.owner]: loading(state.chats[action.owner]) },
      };
    case 'chats.loaded':
      return {
        ...state,
        chats: { ...state.chats, [action.owner]: { status: 'ready', data: action.chats } },
      };
    case 'chats.failed':
      return {
        ...state,
        chats: {
          ...state.chats,
          [action.owner]: failed(state.chats[action.owner], action.error),
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
      const owner = chatOwner(action.chat);
      const entry = state.chats[owner];
      if (entry?.data === undefined) return state;
      return {
        ...state,
        chats: {
          ...state.chats,
          [owner]: withData(entry, upsertChat(entry.data, action.chat)),
        },
      };
    }
    case 'graduate.removed':
      return forget(state, action.graduateId);
    case 'team.removed':
      return forget(state, action.teamId);
  }
}
