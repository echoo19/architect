import { createAgentHost, workspaceStore, type AgentHost } from '@architect/engine/agent-host';
import type { LocalLibrary } from '@architect/engine/graduates';
import type {
  AgentBlock,
  AgentStep,
  GraduateSummary,
  GraduateVersion,
  Installation,
  Team,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import { resolveAgent, resolveTeam } from '../agents';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { sessionStore, type SessionStore, type SessionStoreOptions } from './store';

export type ApprovalBlock = Extract<AgentBlock, { kind: 'approval' }>;
export type ApprovalAnswer = 'approve' | 'deny' | 'always';

/** An agent as a session runs it: its active version, on this computer's setup. */
export interface SessionAgent {
  agent: GraduateSummary;
  version: GraduateVersion;
  installation: Installation;
}

/**
 * An agent opened for a terminal session: its active version, on this computer's setup. For a
 * team (decision 100) it is the team's lead, and `team` has the team with every member as it
 * runs here, the lead first.
 */
export interface AgentSession extends SessionAgent {
  team?: { team: Team; members: SessionAgent[] };
  host: AgentHost;
  /** The session's own chats and messages, on the app's agents and installations. */
  store: SessionStore;
  chat: WorkspaceChat;
  /** Errors the agent host reported: the runtime failed, rather than the agent. */
  failures: unknown[];
  close(): Promise<void>;
}

/**
 * Checks that the agent can run here before anything loads: it has an active version, its
 * installation isn't blocked, and every folder it needs is bound and granted. Each is a
 * requirement the user can meet, so each fails as not permitted, with what to do.
 */
function checkRequirements(
  agent: GraduateSummary,
  version: GraduateVersion,
  installation: Installation,
): void {
  if (installation.status === 'blocked') {
    throw new CliError(
      'not_permitted',
      'blocked',
      `${agent.name} can't run on this computer: ${installation.reasons.join(' ')}`,
    );
  }
  for (const resource of version.manifest.resources) {
    if (!resource.required) continue;
    if (installation.bindings[resource.name] === undefined) {
      throw new CliError(
        'not_permitted',
        'not_bound',
        `${agent.name} needs a folder for ${resource.name}/, and none is bound on this computer.`,
        `Bind one in the app, or install it with --bind ${resource.name}=<folder> --grant ${resource.name}=${resource.access}.`,
      );
    }
    if ((installation.grants.resources[resource.name] ?? 'none') === 'none') {
      throw new CliError(
        'not_permitted',
        'not_granted',
        `${agent.name} may not open ${resource.name}/: nothing is granted on it here.`,
        `Grant it in the app, or install it with --grant ${resource.name}=${resource.access}.`,
      );
    }
  }
}

/**
 * The agent's active version and this computer's installation of it, checked: it can run here
 * before anything loads.
 */
function runnable(local: LocalLibrary, agent: GraduateSummary): SessionAgent {
  const version = local.library.versions(agent.id).find((listed) => listed.active);
  if (!version) {
    throw new CliError(
      'not_permitted',
      'no_active_version',
      `${agent.name} has no version that can run yet.`,
      'Accept and promote one in the app.',
    );
  }
  const installation = local.library.installation(agent.id, version.version);
  checkRequirements(agent, version, installation);
  return { agent, version, installation };
}

/**
 * The agent host a session runs on, on the app's own store, started once the network guard is
 * up, with the agents it answers with opened: the same loader, harness, tools, folders,
 * permissions and event stream as a chat in the app.
 */
async function startHost(
  ctx: CliContext,
  local: LocalLibrary,
  agents: readonly SessionAgent[],
  options: Partial<SessionStoreOptions>,
): Promise<{ host: AgentHost; store: SessionStore; failures: unknown[] }> {
  ctx.io.installGuard();
  const failures: unknown[] = [];
  const store = sessionStore(workspaceStore(local.store, local.paths.root), {
    save: options.save ?? false,
    proposeOnly: options.proposeOnly ?? false,
  });
  const host = createAgentHost({
    store,
    // This command's own llama-server, for a version with an adapter; it stops with the host.
    adapters: local.adapterRuntime,
    // Its replies take the GPU in turns with the app's processes (decision 046).
    gpu: local.gpu,
    ...(ctx.io.sandboxEntryPath === undefined ? {} : { sandboxEntryPath: ctx.io.sandboxEntryPath }),
    onError: (error) => failures.push(error),
  });
  try {
    // Quiet mode, as in the app: a local student gets the same thread cap.
    for (const { agent } of agents) await host.openGraduate(agent.id, ctx.localRuntime().threads);
    return { host, store, failures };
  } catch (error) {
    await host.close();
    throw error;
  }
}

/**
 * Opens an agent's active version through the agent host the workspace uses, on the app's own
 * store, after the network guard is up, in a chat of its own.
 */
export async function openSession(
  ctx: CliContext,
  named: string,
  options: Partial<SessionStoreOptions> = {},
): Promise<AgentSession> {
  const local = ctx.library();
  const agent = runnable(local, resolveAgent(local.library, named));
  const { host, store, failures } = await startHost(ctx, local, [agent], options);
  try {
    const chat = await host.createChat(agent.agent.id);
    return { ...agent, host, store, chat, failures, close: () => host.close() };
  } catch (error) {
    await host.close();
    throw error;
  }
}

/**
 * Opens a team (decision 100) in a team chat: every member's active version checked first, so
 * none loads unless all of them can run here, then each opened in one agent host, as the app's
 * team chat runs them. The lead answers, and asks its teammates as it needs them.
 */
export async function openTeamSession(
  ctx: CliContext,
  named: string,
  options: Partial<SessionStoreOptions> = {},
): Promise<AgentSession> {
  const local = ctx.library();
  const team = resolveTeam(local.store.teams.list(), named);
  const members = team.members.map((member) =>
    runnable(local, local.library.summary(member.graduateId)),
  );
  const [lead] = members;
  if (lead === undefined) throw new Error(`${team.name} has no lead.`);
  const { host, store, failures } = await startHost(ctx, local, members, options);
  try {
    const chat = await host.createTeamChat(team.id);
    return {
      ...lead,
      team: { team, members },
      host,
      store,
      chat,
      failures,
      close: () => host.close(),
    };
  } catch (error) {
    await host.close();
    throw error;
  }
}

export interface AskOptions {
  /** `ask` lets `approve` answer each write that needs approval; `fail` ends the reply there. */
  approvals: 'ask' | 'fail';
  approve?(block: ApprovalBlock): Promise<ApprovalAnswer>;
  /** Each step once it has finished. */
  onStep?(step: AgentStep): void;
  /** The reply's text as it arrives. */
  onText?(delta: string): void;
  /**
   * The model's turn is being asked again, so the reply took back the text it had shown for that
   * turn. What `onText` was given can't be un-written, so this is the place to say so; the turn's
   * new text follows through `onText`.
   */
  onRetract?(): void;
  /** Stops the reply. */
  signal: AbortSignal;
}

export interface Reply {
  message: WorkspaceMessage;
  /** What the agent host reported while this reply ran: the runtime's failure, if any. */
  failure: unknown;
}

/** Length of the longest common start of two texts. */
function sharedStart(a: string, b: string): number {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) at++;
  return at;
}

/**
 * Whether a reply's text went back to an earlier point: it is now a shorter start of what was
 * shown, not counting the blanks a new paragraph trims off the end.
 */
function tookBack(shown: string, text: string): boolean {
  const kept = text.trimEnd();
  return kept.length < shown.trimEnd().length && shown.startsWith(kept);
}

/**
 * Sends one request in the session's chat and follows the reply through the agent host's event
 * stream, as the workspace does, until it settles. Stopping it (the signal) ends the reply
 * through the host, never by leaving it running.
 */
export function ask(session: AgentSession, text: string, options: AskOptions): Promise<Reply> {
  const { host, chat } = session;
  const failuresBefore = session.failures.length;
  return new Promise<Reply>((resolve, reject) => {
    let replyId: string | null = null;
    let shown = '';
    const finished = new Set<string>();
    const asked = new Set<string>();
    const stop = () => {
      void host.stop(chat.id);
    };
    const unsubscribe = host.onEvent((event) => {
      if (event.type !== 'message.updated') return;
      const { message } = event;
      if (message.chatId !== chat.id || message.role !== 'agent') return;
      replyId ??= message.id;
      if (message.id !== replyId) return;
      for (const step of message.steps) {
        if (step.status === 'running' || finished.has(step.id)) continue;
        finished.add(step.id);
        options.onStep?.(step);
      }
      if (message.text !== shown) {
        if (tookBack(shown, message.text)) {
          options.onRetract?.();
        } else {
          const from = sharedStart(shown, message.text);
          if (message.text.length > from) options.onText?.(message.text.slice(from));
        }
        shown = message.text;
      }
      for (const block of message.blocks) {
        if (block.kind !== 'approval' || block.status !== 'pending' || asked.has(block.changeId)) {
          continue;
        }
        asked.add(block.changeId);
        const approve = options.approve;
        if (!approve) continue;
        // A question that can't be answered is a no, never a wait.
        approve(block)
          .catch((): ApprovalAnswer => 'deny')
          .then((answer) => host.decide(block.changeId, answer))
          .catch(() => {
            // The reply ended meanwhile, and the change with it.
          });
      }
      if (message.status === 'streaming') return;
      unsubscribe();
      options.signal.removeEventListener('abort', stop);
      // The host reports a runtime failure just after the reply settles, so look once it has.
      setImmediate(() =>
        resolve({
          message,
          failure:
            session.failures.length > failuresBefore ? (session.failures.at(-1) ?? null) : null,
        }),
      );
    });
    options.signal.addEventListener('abort', stop, { once: true });
    host
      .send(chat.id, text, { approvals: options.approvals })
      .then(() => {
        // A stop that came while the request was being sent found no reply to stop.
        if (options.signal.aborted) stop();
      })
      .catch((error: unknown) => {
        unsubscribe();
        options.signal.removeEventListener('abort', stop);
        reject(error);
      });
  });
}
