import {
  CodedError,
  type PermissionMode,
  type WorkspaceChat,
  type WorkspaceMessage,
} from '@architect/shared';
import { activeStamp, activeVersion, type ActiveVersion } from '../graduates/open';
import { isoNow } from '../loop/time';
import { DataPaths } from '../loop/paths';
import { systemClock } from '../loop/deps';
import type { EngineStore } from '../store/engine-store';

/** Where the agent host finds graduates and keeps chats and their messages. */
export interface WorkspaceStore {
  /** Chats belong to graduates registered in Architect. */
  hasGraduate(graduateId: string): boolean;
  /** The graduate's active version, checked on disk, with this computer's bindings and grants. */
  activeVersion(graduateId: string): Promise<ActiveVersion>;
  /** Which version is active and when the installation last changed; null when none is. */
  activeStamp(graduateId: string): string | null;
  /** The write mode this computer granted, or null when the graduate isn't installed. */
  writeMode(graduateId: string): PermissionMode | null;
  saveWriteMode(graduateId: string, mode: PermissionMode): void;
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
 * mode). Grants are written in a transaction so a concurrent change to the same installation
 * from the engine host isn't overwritten.
 */
export function workspaceStore(engine: EngineStore, dataDir: string): WorkspaceStore {
  const paths = new DataPaths(dataDir);
  return {
    hasGraduate: (graduateId) => engine.graduates.get(graduateId) !== null,
    activeVersion: (graduateId) => activeVersion(engine, paths, graduateId),
    activeStamp: (graduateId) => activeStamp(engine, graduateId),
    writeMode: (graduateId) => engine.installations.get(graduateId)?.grants.writes ?? null,
    saveWriteMode(graduateId, mode) {
      engine.transaction(() => {
        const installation = engine.installations.get(graduateId);
        if (!installation) {
          throw new CodedError(
            'agent_not_found',
            `There is no graduate "${graduateId}" installed.`,
          );
        }
        engine.installations.put({
          ...installation,
          grants: { ...installation.grants, writes: mode },
          updatedAt: isoNow(systemClock),
        });
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
