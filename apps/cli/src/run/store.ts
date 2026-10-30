import type { WorkspaceStore } from '@architect/engine/agent-host';
import type { PermissionMode, WorkspaceChat, WorkspaceMessage } from '@architect/shared';

export interface SessionStoreOptions {
  /** Keep the conversation as a chat the app shows, instead of in memory. */
  save: boolean;
  /**
   * Never apply a change by itself, whatever this computer allowed: a write that would go ahead
   * asks instead, so a run nobody can answer ends with the change it wanted. Writing that is
   * turned off stays off.
   */
  proposeOnly: boolean;
}

/** A session's store, which can let go of a chat it no longer needs. */
export interface SessionStore extends WorkspaceStore {
  /** Drops a finished chat kept in memory, so a long session doesn't keep every one. */
  forget(chatId: string): void;
}

/**
 * The workspace store a terminal session uses: the agent, its active version and this computer's
 * installation from the app's own store, so it runs on the same bindings and permissions. Its
 * conversation stays in memory unless `save` is set; then it is saved as a chat the app shows.
 * Either way the session sees only its own chats, so it never touches a conversation the app
 * has running.
 */
export function sessionStore(app: WorkspaceStore, options: SessionStoreOptions): SessionStore {
  const mine = new Set<string>();
  const chats = new Map<string, WorkspaceChat>();
  const messages = new Map<string, WorkspaceMessage[]>();
  const writeMode = (graduateId: string): PermissionMode | null => {
    const mode = app.writeMode(graduateId);
    return options.proposeOnly && mode === 'allow' ? 'ask' : mode;
  };
  const shared = {
    hasGraduate: (graduateId: string) => app.hasGraduate(graduateId),
    activeVersion: (graduateId: string) => app.activeVersion(graduateId),
    activeStamp: (graduateId: string) => app.activeStamp(graduateId),
    writeMode,
    saveWriteMode(graduateId: string, mode: PermissionMode) {
      if (options.proposeOnly) {
        throw new Error('This session proposes changes only; allow writes in the app.');
      }
      app.saveWriteMode(graduateId, mode);
    },
  };
  if (options.save) {
    return {
      ...shared,
      upsertChat(chat) {
        mine.add(chat.id);
        app.upsertChat(chat);
      },
      getChat: (chatId) => (mine.has(chatId) ? app.getChat(chatId) : null),
      listChats: (graduateId) => app.listChats(graduateId).filter((chat) => mine.has(chat.id)),
      appendMessage: (message) => app.appendMessage(message),
      updateMessage: (message) => app.updateMessage(message),
      listMessages: (chatId) => (mine.has(chatId) ? app.listMessages(chatId) : []),
      // A saved chat stays in the app; the session only stops seeing it.
      forget: (chatId) => {
        mine.delete(chatId);
      },
    };
  }
  return {
    ...shared,
    upsertChat: (chat) => {
      chats.set(chat.id, chat);
    },
    getChat: (chatId) => chats.get(chatId) ?? null,
    listChats: (graduateId) =>
      [...chats.values()]
        .filter((chat) => chat.graduateId === graduateId)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0)),
    appendMessage: (message) => {
      messages.set(message.chatId, [...(messages.get(message.chatId) ?? []), message]);
    },
    updateMessage: (message) => {
      messages.set(
        message.chatId,
        (messages.get(message.chatId) ?? []).map((kept) =>
          kept.id === message.id ? message : kept,
        ),
      );
    },
    listMessages: (chatId) => [...(messages.get(chatId) ?? [])],
    forget: (chatId) => {
      chats.delete(chatId);
      messages.delete(chatId);
    },
  };
}
