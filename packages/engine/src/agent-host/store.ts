import {
  GraduateSettingsSchema,
  type GraduateSettings,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import type { EngineStore } from '../store/engine-store';

/** Where the agent host keeps chats, their messages and each graduate's workspace settings. */
export interface WorkspaceStore {
  /** Chats belong to graduates registered in Architect. */
  hasGraduate(graduateId: string): boolean;
  /** The user's settings for a graduate, or null while they still follow its job. */
  graduateSettings(graduateId: string): GraduateSettings | null;
  saveGraduateSettings(graduateId: string, settings: GraduateSettings): void;
  upsertChat(chat: WorkspaceChat): void;
  getChat(chatId: string): WorkspaceChat | null;
  /** Most recently updated first. */
  listChats(graduateId: string): WorkspaceChat[];
  appendMessage(message: WorkspaceMessage): void;
  updateMessage(message: WorkspaceMessage): void;
  /** Oldest first. */
  listMessages(chatId: string): WorkspaceMessage[];
}

/**
 * The workspace store on the engine's SQLite store, which both hosts open (`architect.db` in WAL
 * mode). Settings are written in a transaction so a concurrent change to the same graduate row
 * from the engine host isn't overwritten.
 */
export function workspaceStore(engine: EngineStore): WorkspaceStore {
  return {
    hasGraduate: (graduateId) => engine.graduates.get(graduateId) !== null,
    graduateSettings: (graduateId) => engine.graduates.get(graduateId)?.settings ?? null,
    saveGraduateSettings(graduateId, settings) {
      engine.transaction(() => {
        const record = engine.graduates.get(graduateId);
        if (!record) throw new Error(`There is no graduate "${graduateId}".`);
        engine.graduates.update({ ...record, settings: GraduateSettingsSchema.parse(settings) });
      });
    },
    upsertChat(chat) {
      engine.transaction(() => {
        if (engine.chats.get(chat.id)) engine.chats.update(chat);
        else engine.chats.insert(chat);
      });
    },
    getChat: (chatId) => engine.chats.get(chatId),
    listChats: (graduateId) => engine.chats.list(graduateId),
    appendMessage: (message) => engine.messages.insert(message),
    updateMessage: (message) => engine.messages.update(message),
    listMessages: (chatId) => engine.messages.list(chatId),
  };
}
