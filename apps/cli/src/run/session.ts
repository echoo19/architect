import { createAgentHost, workspaceStore, type AgentHost } from '@architect/engine/agent-host';
import type {
  AgentBlock,
  AgentStep,
  GraduateSummary,
  GraduateVersion,
  Installation,
  WorkspaceChat,
  WorkspaceMessage,
} from '@architect/shared';
import { resolveAgent } from '../agents';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { sessionStore } from './store';

export type ApprovalBlock = Extract<AgentBlock, { kind: 'approval' }>;
export type ApprovalAnswer = 'approve' | 'deny' | 'always';

/** An agent opened for a terminal session: its active version, on this computer's setup. */
export interface AgentSession {
  agent: GraduateSummary;
  version: GraduateVersion;
  installation: Installation;
  host: AgentHost;
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
 * Opens an agent's active version through the agent host the workspace uses, on the app's own
 * store, after the network guard is up: the same loader, harness, tools, folders, permissions
 * and event stream as a chat in the app.
 */
export async function openSession(
  ctx: CliContext,
  named: string,
  options: { save: boolean },
): Promise<AgentSession> {
  const local = ctx.library();
  const agent = resolveAgent(local.library, named);
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

  ctx.io.installGuard();
  const failures: unknown[] = [];
  const host = createAgentHost({
    store: sessionStore(workspaceStore(local.store, local.paths.root), options.save),
    // This command's own llama-server, for a version with an adapter; it stops with the host.
    adapters: local.adapterRuntime,
    // Its replies take the GPU in turns with the app's processes (decision 046).
    gpu: local.gpu,
    ...(ctx.io.sandboxEntryPath === undefined ? {} : { sandboxEntryPath: ctx.io.sandboxEntryPath }),
    onError: (error) => failures.push(error),
  });
  try {
    // Quiet mode, as in the app: a local student gets the same thread cap.
    await host.openGraduate(agent.id, ctx.localRuntime().threads);
    const chat = await host.createChat(agent.id);
    return { agent, version, installation, host, chat, failures, close: () => host.close() };
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
        const from = sharedStart(shown, message.text);
        if (message.text.length > from) options.onText?.(message.text.slice(from));
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
