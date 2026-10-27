import { totalmem } from 'node:os';
import type { AppInfo } from '@architect/shared';
import { app } from 'electron';
import type { IpcRouter } from '../ipc/router';

function platform(): AppInfo['platform'] {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
}

export function registerAppHandlers(router: IpcRouter): void {
  router.registerHandlers('app', {
    info: () => ({
      version: app.getVersion(),
      platform: platform(),
      dataPath: app.getPath('userData'),
      totalMemoryBytes: totalmem(),
    }),
  });
}
