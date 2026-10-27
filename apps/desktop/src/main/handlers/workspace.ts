import type { AgentHostClient } from '@architect/engine/agent-host';
import type { IpcRouter } from '../ipc/router';
import type { WorkspaceGraduates } from '../workspace/graduates';

/** Sends one request to the agent host. */
export type AgentHostCall = <T>(request: (host: AgentHostClient) => Promise<T>) => Promise<T>;

/**
 * The workspace domain, forwarded to the agent host, which checks every argument it gets.
 * Requests wait until the graduates the host started with are open, and a new chat with a
 * graduate that couldn't be opened fails with the reason it couldn't.
 */
export function registerWorkspaceHandlers(
  router: IpcRouter,
  call: AgentHostCall,
  graduates: Pick<WorkspaceGraduates, 'settled' | 'failure'>,
): void {
  const whenOpen = async <T>(request: (host: AgentHostClient) => Promise<T>): Promise<T> => {
    await graduates.settled();
    return call(request);
  };
  router.registerHandlers('workspace', {
    listChats: (graduateId) => whenOpen((host) => host.listChats(graduateId)),
    createChat: async (graduateId) => {
      await graduates.settled();
      const failure = graduates.failure(graduateId);
      if (failure !== undefined) throw new Error(failure);
      return call((host) => host.createChat(graduateId));
    },
    messages: (chatId) => whenOpen((host) => host.messages(chatId)),
    send: (chatId, text) => whenOpen((host) => host.send(chatId, text)),
    stop: (chatId) => whenOpen((host) => host.stop(chatId)),
    decide: (changeId, decision) => whenOpen((host) => host.decide(changeId, decision)),
  });
}
