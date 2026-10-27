import type { IpcResult } from '../../../src/common/ipc';
import { IpcRouter, type IpcEventLike } from '../../../src/main/ipc/router';

type Listener = (event: IpcEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>;

/** A router on a fake ipcMain, and a way to call its channels as the app's own page would. */
export function routerHarness() {
  const listeners = new Map<string, Listener>();
  const router = new IpcRouter({
    ipcMain: { handle: (channel, listener) => listeners.set(channel, listener) },
    isTrustedSender: () => true,
    targets: () => [],
  });
  const call = async (channel: string, ...args: unknown[]): Promise<IpcResult<unknown>> => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`no listener on ${channel}`);
    return listener({ senderFrame: { url: 'file:///app/index.html' } }, ...args);
  };
  return { router, call };
}
