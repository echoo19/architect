import { RequestMessageSchema, toErrorPayload } from '../host/protocol';
import type { LocalRuntimeSettings } from '../local-runtime';
import type { LoopbackGuard } from './guard/install';
import type { AgentHost } from './host';
import {
  AGENT_HOST_ROUTES,
  isAgentHostMethod,
  type AgentHostApi,
  type AgentHostPort,
} from './protocol';

export interface ServeOptions {
  /** The process's network guard, whose blocked calls the host reports on request. */
  guard?: LoopbackGuard;
  /** Takes the settings the host's adapter runtime follows from now on. */
  configure?(settings: LocalRuntimeSettings): void;
  /** Problems nobody asked about, such as a message that isn't a request. */
  onError?(error: unknown): void;
}

/**
 * Answers requests from the port and streams workspace events to it. Requests are checked
 * against their schemas here; results and events are checked by the client that receives them.
 * Sends `{ kind: 'ready' }` once listening.
 */
export function serveAgentHost(
  port: AgentHostPort,
  host: AgentHost,
  options: ServeOptions = {},
): void {
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const api: AgentHostApi = {
    ...host,
    async blockedConnections() {
      if (!options.guard) throw new Error('This agent host runs without a network guard.');
      return options.guard.blocked();
    },
    async configure(settings) {
      if (!options.configure) throw new Error('This agent host takes no settings.');
      options.configure(settings);
    },
  };
  host.onEvent((event) => port.postMessage({ kind: 'event', event }));
  port.onMessage((message) => {
    answer(api, port, message).catch(onError);
  });
  port.postMessage({ kind: 'ready' });
}

async function answer(api: AgentHostApi, port: AgentHostPort, message: unknown): Promise<void> {
  const id = requestId(message);
  try {
    const request = RequestMessageSchema.parse(message);
    if (!isAgentHostMethod(request.method)) {
      throw new Error(`There is no "${request.method}" request.`);
    }
    const result = await AGENT_HOST_ROUTES[request.method].answer(api, request.params);
    port.postMessage({ kind: 'response', id: request.id, ok: true, result });
  } catch (error) {
    if (id === null) throw error;
    port.postMessage({ kind: 'response', id, ok: false, error: toErrorPayload(error) });
  }
}

function requestId(message: unknown): number | null {
  if (typeof message !== 'object' || message === null || !('id' in message)) return null;
  return typeof message.id === 'number' ? message.id : null;
}
