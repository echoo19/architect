import type { WorkspaceStore } from '@architect/engine/agent-host';
import type { WorkspaceChat, WorkspaceMessage } from '@architect/shared';

/**
 * The workspace store a terminal session uses: the agent, its active version and this computer's
 * installation from the app's own store, so it runs on the same bindings and permissions. Its
 * conversation stays in memory unless `save` is set; then it is saved as a chat the app shows.
 * Either way the session sees only its own chats, so it never touches a conversation the app
 * has running.
 */
export function sessionStore(app: WorkspaceStore, save: boolean): WorkspaceStore {
  const mine = new Set<string>();
  const chats = new Map<string, WorkspaceChat>();
  const messages = new Map<string, WorkspaceMessage[]>();
  const shared = {
    hasGraduate: (graduateId: string) => app.hasGraduate(graduateId),
    activeVersion: (graduateId: string) => app.activeVersion(graduateId),
    activeStamp: (graduateId: string) => app.activeStamp(graduateId),
    writeMode: (graduateId: string) => app.writeMode(graduateId),
    saveWriteMode: (graduateId: string, mode: Parameters<WorkspaceStore['saveWriteMode']>[1]) =>
      app.saveWriteMode(graduateId, mode),
  };
  if (save) {
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
  };
}
