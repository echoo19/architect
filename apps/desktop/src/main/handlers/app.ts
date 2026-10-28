import { totalmem } from 'node:os';
import { ProviderIdSchema, type AppInfo } from '@architect/shared';
import { app } from 'electron';
import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import { providerPage, type OpenExternal } from '../links';

function platform(): AppInfo['platform'] {
  return process.platform === 'darwin' || process.platform === 'win32' ? process.platform : 'linux';
}

export function registerAppHandlers(router: IpcRouter, openLink: OpenExternal): void {
  router.registerHandlers(
    'app',
    {
      info: () => ({
        version: app.getVersion(),
        platform: platform(),
        dataPath: app.getPath('userData'),
        totalMemoryBytes: totalmem(),
      }),
      openProviderPage: (provider) => openLink(providerPage(provider)),
      // The opener refuses any page that isn't HTTPS on a host Architect knows.
      openLink: (url) => openLink(url),
    },
    { openProviderPage: z.tuple([ProviderIdSchema]), openLink: z.tuple([z.string().max(2048)]) },
  );
}
