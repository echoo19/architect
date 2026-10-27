import type { ArchitectApi } from '@architect/shared';
import { channel, DOMAINS, eventMethods, invokeMethods, isIpcResult } from './ipc';

/** How the bridge reaches the main process. The preload passes ipcRenderer; tests pass fakes. */
export interface BridgeTransport {
  invoke(channel: string, args: unknown[]): Promise<unknown>;
  subscribe(channel: string, listener: (payload: unknown) => void): () => void;
}

function unwrap(channelName: string, result: unknown): unknown {
  if (!isIpcResult(result)) {
    throw new Error(`Architect couldn't read the reply from ${channelName}.`);
  }
  if (result.ok) return result.value;
  throw new Error(result.error.message);
}

/**
 * Builds `window.architect`. The method lists in ./ipc are checked against ArchitectApi at
 * compile time, so the object built from them has exactly the contract's methods.
 */
export function createBridge(transport: BridgeTransport): ArchitectApi {
  const api: Record<string, Record<string, unknown>> = {};
  for (const domain of DOMAINS) {
    const methods: Record<string, unknown> = {};
    for (const method of invokeMethods(domain)) {
      const name = channel(domain, method);
      methods[method] = async (...args: unknown[]) =>
        unwrap(name, await transport.invoke(name, args));
    }
    for (const method of eventMethods(domain)) {
      const name = channel(domain, method);
      methods[method] = (listener: (payload: unknown) => void) => {
        if (typeof listener !== 'function') {
          throw new TypeError(`${name} needs a listener function.`);
        }
        return transport.subscribe(name, listener);
      };
    }
    api[domain] = methods;
  }
  return api as unknown as ArchitectApi;
}
