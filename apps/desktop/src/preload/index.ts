import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { createBridge } from '../common/bridge';
import { runtimeFrom } from '../common/runtime';

const architect = createBridge({
  invoke: (channel, args) => ipcRenderer.invoke(channel, ...args),
  subscribe: (channel, listener) => {
    const handler = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => {
      ipcRenderer.removeListener(channel, handler);
    };
  },
});

contextBridge.exposeInMainWorld('architect', architect);
contextBridge.exposeInMainWorld('architectRuntime', runtimeFrom(process.argv));
