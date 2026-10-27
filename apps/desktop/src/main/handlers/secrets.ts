import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import { SECRET_REF_NAMES } from '../secrets/refs';
import type { SecretStore } from '../secrets/store';

const RefSchema = z.enum(SECRET_REF_NAMES);

/** Keys go in and are cleared from here; only whether each one is saved ever comes back. */
export function registerSecretsHandlers(router: IpcRouter, store: SecretStore): void {
  router.registerHandlers(
    'secrets',
    {
      status: () => store.status(),
      set: (ref, value) => store.set(ref, value),
      clear: (ref) => store.clear(ref),
    },
    {
      set: z.tuple([RefSchema, z.string()]),
      clear: z.tuple([RefSchema]),
    },
  );
}
