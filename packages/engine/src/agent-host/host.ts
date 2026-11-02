import { randomInt } from 'node:crypto';
import {
  ApprovalRequiredError,
  CodedError,
  type ApprovalRequest,
  type ArchitectApi,
  type ChatMessage,
  type PermissionMode,
  type TeamMember,
  type WorkspaceChat,
  type WorkspaceEvent,
} from '@architect/shared';
import {
  replyPurpose,
  type AdapterServing,
  type GpuHold,
  type GpuLease,
  type GpuWatch,
} from '../local-runtime';
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
import { askTeammate, teammatesOf, type Teammate } from './team';
import { approveWrites, PendingWrites } from './writes';

/**
 * The workspace part of the app's API: what the agent host serves to the UI. What its network
 * guard stopped is the process's to answer, not the host's (`serveAgentHost`).
 */
export type WorkspaceApi = Omit<ArchitectApi['workspace'], 'blockedConnections'>;

export interface AgentHostOptions {
  /** Graduates, their installations and chats, on the app's database. */
  store: WorkspaceStore;
  /**
   * Serves the versions that carry an adapter: llama-server, with the base from Ollama's store
   * (decision 041). The host stops it when it closes. Every host that runs graduates passes one,
   * the CLI's included, so a graduate answers the same wherever it runs.
   */
  adapters: AdapterServing;
  /**
   * The process's share of the machine-wide GPU lease (decision 046), which `adapters` holds too.
   * A reply holds it from its start to its end, so no other Architect process loads a model on
   * the GPU halfway through one, except while it waits on a person's approval; a student on
   * Ollama holds it for each request. The host doesn't close it: it belongs to whoever made it.
   */
  gpu: GpuLease;
  /**
   * The CPU-thread cap local students follow now (quiet mode's), asked at every request, so a change
   * in Settings reaches an agent that is already open and not only the next one opened. An agent
   * opened with a cap of its own, as the command opens one, keeps it when this is absent.
   */
  cpuThreads?: () => number | undefined;
  /** The tool sandbox's child entry. A bundled app passes its built file. */
  sandboxEntryPath?: string;
  /** The clock for timestamps and for the date the agent works as of. */
  now?: () => Date;
  /** Problems nobody is waiting on, such as a reply that failed after `send` returned. */
  onError?(error: unknown): void;
}

export interface SendOptions {
  /**
   * `ask` (the default) shows a write that needs approval and waits for the user; `fail` ends
   * the reply at once with an approval-required failure, for runs where nobody can answer.
   */
  approvals?: 'ask' | 'fail';
}

export interface AgentHost extends WorkspaceApi {
  /**
   * Loads a graduate's active version so its chats can run, from its own folder and this
   * computer's installation. One whose model isn't on this computer is refused.
   */
  openGraduate(graduateId: string, cpuThreads?: number): Promise<void>;
  send(chatId: string, text: string, options?: SendOptions): Promise<void>;
  /**
   * Stops the graduate's replies, a team's it leads or may be asked in included, and unloads it:
   * for a version with an adapter, llama-server stops once no other reply is using it.
   */
  closeGraduate(graduateId: string): Promise<void>;
  /** Stops the team's replies, before the team and its chats are removed. */
  closeTeam(teamId: string): Promise<void>;
  /** Stops every reply and the tool sandbox. The store stays open: it belongs to the caller. */
  close(): Promise<void>;
}

interface RunningReply {
  /** The agents it runs: the one that answers, and in a team reply each teammate it may ask. */
  graduateIds: ReadonlySet<string>;
  teamId?: string;
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
 * on the guardrail list are refused without calling the student. In a team chat the lead
 * answers and may ask its teammates (decision 100), each in its own folder under its own write
 * mode, every one of them opened here.
 */
export function createAgentHost(options: AgentHostOptions): AgentHost {
  const { store, adapters, gpu } = options;
  const now = options.now ?? (() => new Date());
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const sandbox = createSandbox(
    options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
  );
  const graduates = new Map<string, GraduateSession>();
  /** The CPU-thread cap each graduate was opened with, for reopening it on a new version. */
  const threads = new Map<string, number | undefined>();
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
    if (!chat) throw new CodedError('chat_not_found', `There is no chat "${chatId}".`);
    return chat;
  }

  function graduateOf(graduateId: string): GraduateSession {
    const graduate = graduates.get(graduateId);
    if (!graduate) {
      const name = store.graduateName(graduateId) ?? 'This agent';
      throw new Error(
        `${name} isn't ready to chat yet. Try again in a moment, or check in its settings that it works on this computer.`,
      );
    }
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

  /** What this computer granted, read on every write: the user can change it mid-reply. */
  function writeMode(graduate: GraduateSession): PermissionMode {
    return store.writeMode(graduate.id) ?? graduate.grants.writes;
  }

  const answering = (graduateId: string): boolean =>
    [...replies.values()].some((reply) => reply.graduateIds.has(graduateId));

  /**
   * The graduate's session, opened again if another version became active, or its folders or
   * grants changed, since it opened. A graduate that is still answering keeps what it had until
   * it is done, so no reply ever switches version or folders halfway.
   */
  async function current(graduateId: string): Promise<GraduateSession> {
    const graduate = graduateOf(graduateId);
    const stamp = store.activeStamp(graduateId);
    if (stamp === null || stamp === graduate.stamp || answering(graduateId)) return graduate;
    const reopened = await openSession(graduateId, threads.get(graduateId));
    // Closed while it opened again, it stays closed; opened again by another request, that one
    // stands.
    if (graduates.get(graduateId) !== graduate) return graduateOf(graduateId);
    graduates.set(graduateId, reopened);
    return reopened;
  }

  async function openSession(graduateId: string, cpuThreads: number | undefined) {
    const cap = options.cpuThreads ?? cpuThreads;
    return openGraduateSession(await store.activeVersion(graduateId), {
      adapters,
      gpu,
      ...(cap === undefined ? {} : { cpuThreads: cap }),
    });
  }

  /**
   * A reply left running when the host last stopped can't resume, so it is closed off: in the
   * graduate's own chats and in those of the teams it leads.
   */
  function settleInterrupted(graduateId: string): void {
    for (const chat of [...store.listChats(graduateId), ...store.listLed(graduateId)]) {
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

  /** A team chat's teammates as its team lists them now, the lead first and left out. */
  function teamMembersOf(chat: WorkspaceChat, teamId: string): TeamMember[] {
    const team = store.team(teamId);
    if (!team) throw new CodedError('record_not_found', "This chat's team was removed.");
    const [lead, ...others] = team.members;
    if (lead?.graduateId !== chat.graduateId) {
      throw new Error(`${team.name} has another lead now, so this chat can't go on.`);
    }
    return others;
  }

  function startReply(
    chat: WorkspaceChat,
    graduate: GraduateSession,
    request: string,
    history: ChatMessage[],
    options: SendOptions,
    teammates?: readonly Teammate[],
  ): void {
    const startedAt = now();
    const message = agentMessage(
      chat.id,
      graduate.version,
      startedAt.toISOString(),
      teammates !== undefined,
    );
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
    let required: ApprovalRequest | null = null;
    /** The reply's hold of the GPU, once it has one. */
    let held: GpuHold | null = null;
    const interactive = (options.approvals ?? 'ask') === 'ask';
    const approvalRequired = (approval: ApprovalRequest) => {
      required ??= approval;
      // The write that asked fails first, with the reason; the reply stops right after, so
      // the model gets no further turn.
      queueMicrotask(() =>
        controller.abort(new ApprovalRequiredError(approval, 'An approval was required.')),
      );
    };
    const approveWrite = approveWrites({
      agentName: graduate.name,
      mode: () => writeMode(graduate),
      allowFromNowOn: () => store.saveWriteMode(graduate.id, 'allow'),
      reply,
      pending,
      setWaiting: (waiting) => {
        updateChat(chat.id, { waiting });
        // A person may take hours to answer, and no model runs meanwhile: the GPU is free for
        // others until the reply's next model turn takes it back.
        if (waiting) held?.pause();
      },
      interactive,
      approvalRequired,
    });
    const use = graduate.gpu;
    // While the reply waits its turn for the GPU, one quiet step says for whom.
    const watch: GpuWatch = {
      waiting: (who) => reply.waitForGpu(who),
      done: () => reply.endWait(),
    };
    const seed = randomInt(SEED_LIMIT);
    const team =
      teammates === undefined
        ? undefined
        : {
            teammates: teammatesOf(teammates),
            tool: askTeammate({
              lead: graduate,
              teammates,
              sandbox,
              reply,
              now: startedAt,
              seed,
              gpu,
              leadUse: use,
              leadHold: () => held,
              watch,
              approveWrite: ({ session }, pause) =>
                approveWrites({
                  agentName: session.name,
                  agent: { graduateId: session.id, name: session.name },
                  mode: () => writeMode(session),
                  allowFromNowOn: () => store.saveWriteMode(session.id, 'allow'),
                  reply,
                  pending,
                  setWaiting: (waiting) => {
                    updateChat(chat.id, { waiting });
                    if (waiting) pause();
                  },
                  interactive,
                  approvalRequired,
                }),
              signal: controller.signal,
            }),
          };
    const done = respond({
      graduate,
      sandbox,
      reply,
      request,
      history,
      now: startedAt,
      seed,
      approveWrite,
      approvalRequired: () => required,
      // The reply holds the GPU from its start to its end, except while it waits on a person.
      holdGpu: async () => {
        if (use === null) return null;
        held = await gpu.hold(use, replyPurpose(graduate.name), controller.signal, watch);
        return held;
      },
      ...(team === undefined ? {} : { team }),
      signal: controller.signal,
    })
      .catch(onError)
      .finally(finish)
      .catch(onError);
    const graduateIds = new Set([
      graduate.id,
      ...(teammates ?? []).map(({ session }) => session.id),
    ]);
    replies.set(chat.id, {
      graduateIds,
      ...(chat.teamId === undefined ? {} : { teamId: chat.teamId }),
      controller,
      done,
    });
  }

  return {
    async openGraduate(graduateId, cpuThreads) {
      assertOpen();
      if (store.graduateName(graduateId) === null) {
        throw new CodedError('agent_not_found', 'That agent is no longer in Architect.');
      }
      threads.set(graduateId, cpuThreads);
      // A graduate that is answering is opened again before its next reply, never during one.
      if (answering(graduateId)) return;
      const graduate = await openSession(graduateId, cpuThreads);
      graduates.set(graduateId, graduate);
      settleInterrupted(graduateId);
    },

    async closeGraduate(graduateId) {
      await stopReplies((reply) => reply.graduateIds.has(graduateId));
      const graduate = graduates.get(graduateId);
      graduates.delete(graduateId);
      threads.delete(graduateId);
      // Its adapter is loaded in llama-server, which holds the GPU: it goes with the graduate.
      if (graduate?.adapter) await graduate.student.release();
    },

    async listChats(graduateId) {
      return store.listChats(graduateId);
    },

    async createChat(graduateId) {
      assertOpen();
      const graduate = await current(graduateId);
      return saveChat(newChat(graduateId, graduate.version, now().toISOString()));
    },

    async closeTeam(teamId) {
      await stopReplies((reply) => reply.teamId === teamId);
    },

    async listTeamChats(teamId) {
      return store.listTeamChats(teamId);
    },

    async createTeamChat(teamId) {
      assertOpen();
      const team = store.team(teamId);
      if (!team) throw new CodedError('record_not_found', `There is no team "${teamId}".`);
      const lead = team.members[0]?.graduateId ?? '';
      const graduate = await current(lead);
      return saveChat({ ...newChat(lead, graduate.version, now().toISOString()), teamId });
    },

    async messages(chatId) {
      chatOf(chatId);
      return store.listMessages(chatId);
    },

    async send(chatId, text, sendOptions = {}) {
      assertOpen();
      const request = text.trim();
      if (request === '') throw new Error('Write a message to send.');
      const chat = chatOf(chatId);
      const members = chat.teamId === undefined ? undefined : teamMembersOf(chat, chat.teamId);
      // Every agent the reply runs is opened again first where another version became active.
      await current(chat.graduateId);
      for (const member of members ?? []) await current(member.graduateId);
      // Nothing waits from here to the reply's start, so the sessions taken are the ones it
      // registers: one closed meanwhile fails the send before anything is kept.
      const graduate = graduateOf(chat.graduateId);
      const teammates = members?.map((member): Teammate => {
        const session = graduateOf(member.graduateId);
        return { session, role: member.role ?? session.about.summary };
      });
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
      startReply(
        running,
        graduate,
        request,
        chatHistory(earlier, graduate.contextLength),
        sendOptions,
        teammates,
      );
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
      threads.clear();
      listeners.clear();
      // llama-server holds the GPU; it must not outlive the host that started it.
      await Promise.all([sandbox.dispose(), adapters.stop()]);
    },
  };
}
