import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import { isSecretRef } from '../secrets/refs';
import type { SecretStore } from '../secrets/store';

/** A named service's ref, or an added endpoint's `custom:<host>`. */
const RefSchema = z.string().refine(isSecretRef, { message: "isn't a key Architect can store" });

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
