import { randomInt } from 'node:crypto';
import type {
  ArchitectApi,
  ChatMessage,
  PermissionMode,
  WorkspaceChat,
  WorkspaceEvent,
} from '@architect/shared';
import { createSandbox } from '../sandbox/sandbox';
import { openGraduateSession, type GraduateSession } from './graduate';
import { chatHistory } from './history';
import {
  agentMessage,
  chatTitle,
  INTERRUPTED,
  newChat,
  settleMessage,
  userMessage,
} from './messages';
import { LiveReply } from './reply';
import { respond } from './respond';
import type { WorkspaceStore } from './store';
import { approveWrites, PendingWrites } from './writes';

/** The workspace part of the app's API: what the agent host serves to the UI. */
export type WorkspaceApi = ArchitectApi['workspace'];

export interface AgentHostOptions {
  /** The app's data folder. The jobs graduates were trained for are read from it. */
  dataDir: string;
  store: WorkspaceStore;
  /** The tool sandbox's child entry. A bundled app passes its built file. */
  sandboxEntryPath?: string;
  /** The clock for timestamps and for the date the agent works as of. */
  now?: () => Date;
  /** Problems nobody is waiting on, such as a reply that failed after `send` returned. */
  onError?(error: unknown): void;
}

export interface AgentHost extends WorkspaceApi {
  /** Loads a graduate so its chats can run. One whose model isn't on this computer is refused. */
  openGraduate(
    graduateId: string,
    folder: string,
    workspaceDataDir: string,
    cpuThreads?: number,
  ): Promise<void>;
  /** Stops the graduate's replies and unloads it. */
  closeGraduate(graduateId: string): Promise<void>;
  /** Stops every reply and the tool sandbox. The store stays open: it belongs to the caller. */
  close(): Promise<void>;
}

interface RunningReply {
  graduateId: string;
  controller: AbortController;
  /** Settles once the reply has finished and its chat is updated. Never rejects. */
  done: Promise<void>;
}

/** Sampler seeds stay within a signed 32-bit integer, which every runtime accepts. */
const SEED_LIMIT = 2 ** 31;

/**
 * Chats with graduates. A message runs the graduate's student in chat mode with the end of the
 * conversation as history, streaming its steps and text as `message.updated` events. Writes
 * wait for the user's approval unless the graduate's write mode says otherwise, and requests
 * on the guardrail list are refused without calling the student.
 */
export function createAgentHost(options: AgentHostOptions): AgentHost {
  const { store } = options;
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const sandbox = createSandbox(
    options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
  );
  const graduates = new Map<string, GraduateSession>();
  const replies = new Map<string, RunningReply>();
  const pending = new PendingWrites();
  const listeners = new Set<(event: WorkspaceEvent) => void>();
  let closed = false;

  function emit(event: WorkspaceEvent): void {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        onError(error);
      }
    }
  }

  function assertOpen(): void {
    if (closed) throw new Error('The agent host has shut down.');
  }

  function chatOf(chatId: string): WorkspaceChat {
    const chat = store.getChat(chatId);
    if (!chat) throw new Error(`There is no chat "${chatId}".`);
    return chat;
  }

  function graduateOf(graduateId: string): GraduateSession {
    const graduate = graduates.get(graduateId);
    if (!graduate) throw new Error(`Open the graduate "${graduateId}" before chatting with it.`);
    return graduate;
  }

  function saveChat(chat: WorkspaceChat): WorkspaceChat {
    store.upsertChat(chat);
    emit({ type: 'chat.updated', chat });
    return chat;
  }

  function updateChat(chatId: string, patch: Partial<WorkspaceChat>): void {
    saveChat({ ...chatOf(chatId), ...patch });
  }

  /** Until the user picks one, a graduate writes the way its job allowed. */
  function writeMode(graduate: GraduateSession): PermissionMode {
    return store.graduateSettings(graduate.id)?.writeMode ?? graduate.job.permissions.writes;
  }

  /** A reply left running when the host last stopped can't resume, so it is closed off. */
  function settleInterrupted(graduateId: string): void {
    for (const chat of store.listChats(graduateId)) {
      if ((!chat.running && !chat.waiting) || replies.has(chat.id)) continue;
      for (const message of store.listMessages(chat.id)) {
        if (message.status !== 'streaming') continue;
        const settled = settleMessage(message, INTERRUPTED);
        store.updateMessage(settled);
        emit({ type: 'message.updated', message: settled });
      }
      saveChat({ ...chat, running: false, waiting: false });
    }
  }

  async function stopReplies(which: (reply: RunningReply) => boolean): Promise<void> {
    const stopping = [...replies.values()].filter(which);
    for (const reply of stopping) reply.controller.abort();
    await Promise.all(stopping.map((reply) => reply.done));
  }

  function startReply(
    chat: WorkspaceChat,
    graduate: GraduateSession,
    request: string,
    history: ChatMessage[],
  ): void {
    const startedAt = now();
    const message = agentMessage(chat.id, startedAt.toISOString());
    store.appendMessage(message);
    emit({ type: 'message.updated', message });
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      replies.delete(chat.id);
      updateChat(chat.id, { running: false, waiting: false, updatedAt: now().toISOString() });
    };
    const reply = new LiveReply(message, (current, save) => {
      // Throttled updates arrive from a timer, where a thrown error would end the process.
      try {
        if (save) store.updateMessage(current);
        // The chat is free again before anyone hears the reply is done, so a follow-up can go in.
        if (current.status !== 'streaming') finish();
      } catch (error) {
        onError(error);
      }
      emit({ type: 'message.updated', message: current });
    });
    const controller = new AbortController();
    const approveWrite = approveWrites({
      agentName: graduate.name,
      mode: () => writeMode(graduate),
      allowFromNowOn: () => store.saveGraduateSettings(graduate.id, { writeMode: 'allow' }),
      reply,
      pending,
      setWaiting: (waiting) => updateChat(chat.id, { waiting }),
    });
    const done = respond({
      graduate,
      sandbox,
      reply,
      request,
      history,
      now: startedAt,
      seed: randomInt(SEED_LIMIT),
      approveWrite,
      signal: controller.signal,
    })
      .catch(onError)
      .finally(finish)
      .catch(onError);
    replies.set(chat.id, { graduateId: graduate.id, controller, done });
  }

  return {
    async openGraduate(graduateId, folder, workspaceDataDir, cpuThreads) {
      assertOpen();
      if ([...replies.values()].some((reply) => reply.graduateId === graduateId)) {
        throw new Error('Stop the chats this graduate is answering before opening it again.');
      }
      if (!store.hasGraduate(graduateId)) {
        throw new Error(`There is no graduate "${graduateId}" in Architect.`);
      }
      const graduate = await openGraduateSession({
        graduateId,
        folder,
        workspaceDataDir,
        appDataDir: options.dataDir,
        ...(cpuThreads === undefined ? {} : { cpuThreads }),
      });
      graduates.set(graduateId, graduate);
      settleInterrupted(graduateId);
    },

    async closeGraduate(graduateId) {
      await stopReplies((reply) => reply.graduateId === graduateId);
      graduates.delete(graduateId);
    },

    async listChats(graduateId) {
      return store.listChats(graduateId);
    },

    async createChat(graduateId) {
      assertOpen();
      graduateOf(graduateId);
      return saveChat(newChat(graduateId, now().toISOString()));
    },

    async messages(chatId) {
      chatOf(chatId);
      return store.listMessages(chatId);
    },

    async send(chatId, text) {
      assertOpen();
      const request = text.trim();
      if (request === '') throw new Error('Write a message to send.');
      const chat = chatOf(chatId);
      const graduate = graduateOf(chat.graduateId);
      if (replies.has(chatId)) {
        throw new Error('This chat is still answering. Stop it or wait for it to finish.');
      }
      const earlier = store.listMessages(chatId);
      const at = now().toISOString();
      const message = userMessage(chatId, request, at);
      store.appendMessage(message);
      emit({ type: 'message.updated', message });
      const running = saveChat({
        ...chat,
        title: earlier.length === 0 ? chatTitle(request) : chat.title,
        running: true,
        waiting: false,
        updatedAt: at,
      });
      startReply(running, graduate, request, chatHistory(earlier, graduate.contextLength));
    },

    async stop(chatId) {
      const reply = replies.get(chatId);
      if (!reply) return;
      reply.controller.abort();
      await reply.done;
    },

    async decide(changeId, decision) {
      pending.decide(changeId, decision);
    },

    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async close() {
      closed = true;
      await stopReplies(() => true);
      graduates.clear();
      listeners.clear();
      await sandbox.dispose();
    },
  };
}
