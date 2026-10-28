import type { WorkspaceEvent } from '@architect/shared';
import { fromErrorPayload, ResponseMessageSchema } from '../host/protocol';
import type { BlockedConnection } from './guard/install';
import type { SendOptions, WorkspaceApi } from './host';
import {
  AGENT_HOST_ROUTES,
  HostEventMessageSchema,
  ReadyMessageSchema,
  type AgentHostMethod,
  type AgentHostParams,
  type AgentHostPort,
  type AgentHostResult,
} from './protocol';

export interface AgentHostClient extends WorkspaceApi {
  openGraduate(graduateId: string, cpuThreads?: number): Promise<void>;
  send(chatId: string, text: string, options?: SendOptions): Promise<void>;
  closeGraduate(graduateId: string): Promise<void>;
  /** Network calls the agent host's guard has blocked, oldest first. */
  blockedConnections(): Promise<BlockedConnection[]>;
  /** Stops listening and fails the requests still waiting for an answer. */
  close(): void;
}

interface Pending {
  method: AgentHostMethod;
  resolve(result: unknown): void;
  reject(error: unknown): void;
}

/**
 * The main process's side of the agent host: the workspace API carried over a port. Requests
 * wait until the host says it is ready, and results and events are validated before anyone
 * sees them.
 */
export function connectAgentHost(
  port: AgentHostPort,
  onError: (error: unknown) => void = (error) => console.error(error),
): AgentHostClient {
  const pending = new Map<number, Pending>();
  const unsent: (() => void)[] = [];
  const listeners = new Set<(event: WorkspaceEvent) => void>();
  let nextId = 1;
  let ready = false;
  let closed = false;

  port.onMessage((message) => {
    if (closed) return;
    if (ReadyMessageSchema.safeParse(message).success) {
      ready = true;
      for (const send of unsent.splice(0)) send();
      return;
    }
    const event = HostEventMessageSchema.safeParse(message);
    if (event.success) {
      for (const listener of listeners) listener(event.data.event);
      return;
    }
    const response = ResponseMessageSchema.safeParse(message);
    if (!response.success) {
      // A garbled answer still settles its request rather than leaving it waiting forever.
      const garbled = take(responseId(message));
      if (garbled) garbled.reject(malformed(garbled.method));
      else onError(new Error("The agent host sent a message that isn't a response or an event."));
      return;
    }
    const waiting = take(response.data.id);
    if (!waiting) return;
    if (!response.data.ok) {
      waiting.reject(fromErrorPayload(response.data.error));
      return;
    }
    const result = AGENT_HOST_ROUTES[waiting.method].result.safeParse(response.data.result);
    if (result.success) waiting.resolve(result.data);
    else waiting.reject(malformed(waiting.method));
  });

  function take(id: number | null): Pending | undefined {
    if (id === null) return undefined;
    const waiting = pending.get(id);
    pending.delete(id);
    return waiting;
  }

  function request<M extends AgentHostMethod>(
    method: M,
    params: AgentHostParams<M>,
  ): Promise<AgentHostResult<M>> {
    if (closed) return Promise.reject(new Error('The connection to the agent host is closed.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // The result was parsed with this method's own schema before it gets here.
      pending.set(id, {
        method,
        resolve: (result) => resolve(result as AgentHostResult<M>),
        reject,
      });
      const send = () => port.postMessage({ kind: 'request', id, method, params });
      if (ready) send();
      else unsent.push(send);
    });
  }

  return {
    openGraduate: (graduateId, cpuThreads) =>
      request(
        'host.openGraduate',
        cpuThreads === undefined ? [graduateId] : [graduateId, cpuThreads],
      ),
    closeGraduate: (graduateId) => request('host.closeGraduate', [graduateId]),
    blockedConnections: () => request('host.blockedConnections', []),
    listChats: (graduateId) => request('workspace.listChats', [graduateId]),
    createChat: (graduateId) => request('workspace.createChat', [graduateId]),
    messages: (chatId) => request('workspace.messages', [chatId]),
    send: (chatId, text, options) =>
      request('workspace.send', options === undefined ? [chatId, text] : [chatId, text, options]),
    stop: (chatId) => request('workspace.stop', [chatId]),
    decide: (changeId, decision) => request('workspace.decide', [changeId, decision]),
    onEvent(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    close() {
      closed = true;
      unsent.length = 0;
      for (const waiting of pending.values()) {
        waiting.reject(new Error('The connection to the agent host closed.'));
      }
      pending.clear();
      listeners.clear();
    },
  };
}

/** The id of a message that says it is a response, even one that fails its schema. */
function responseId(message: unknown): number | null {
  if (typeof message !== 'object' || message === null) return null;
  if (!('kind' in message) || message.kind !== 'response' || !('id' in message)) return null;
  return typeof message.id === 'number' ? message.id : null;
}

function malformed(method: AgentHostMethod): Error {
  return new Error(`The agent host's answer to ${method} was malformed.`);
}
