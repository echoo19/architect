import { AppSettingsPatchSchema } from '@architect/shared';
import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import type { SettingsStore } from '../settings/store';

export function registerSettingsHandlers(router: IpcRouter, store: SettingsStore): void {
  router.registerHandlers(
    'settings',
    {
      get: () => store.get(),
      update: (patch) => store.update(patch),
    },
    { update: z.tuple([AppSettingsPatchSchema]) },
  );
}
