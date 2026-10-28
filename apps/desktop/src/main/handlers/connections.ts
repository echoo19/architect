import { listModels, verifyKey } from '@architect/adapters';
import {
  AddConnectionRequestSchema,
  MentorConfigSchema,
  ModelSourceSchema,
  ProviderIdSchema,
  StudentEndpointSchema,
  type GpuInfo,
} from '@architect/shared';
import { z } from 'zod';
import {
  addConnection,
  detectLocalRuntimes,
  listConnectionModels,
  removeConnection,
  testMentor,
  testStudent,
  type KeyLookup,
} from '../connections';
import type { IpcRouter } from '../ipc/router';
import type { SignIns } from '../oauth/sign-ins';
import { ollamaBaseUrl } from '../ollama/status';
import type { SecretStore } from '../secrets/store';
import { withEndpoint, withoutEndpoint } from '../settings/schema';
import type { SettingsStore } from '../settings/store';

export interface ConnectionHandlerDeps {
  keys: KeyLookup;
  secrets: Pick<SecretStore, 'set' | 'clear'>;
  settings: SettingsStore;
  signIns: SignIns;
  /** The GPU local models can run on, found once while the app runs. */
  gpu: () => Promise<GpuInfo | null>;
}

/** Connections: testing them, their model lists, adding and removing keys, and signing in. */
export function registerConnectionHandlers(router: IpcRouter, deps: ConnectionHandlerDeps): void {
  const { keys, secrets, settings, signIns, gpu } = deps;
  const stores = {
    verifyKey,
    listModels,
    saveKey: (ref: string, value: string) => secrets.set(ref, value),
    clearKey: (ref: string) => secrets.clear(ref),
    addEndpoint: async (endpoint: { baseUrl: string; label: string }) => {
      await settings.update({
        customEndpoints: withEndpoint(settings.get().customEndpoints, endpoint),
      });
    },
    removeEndpoint: async (baseUrl: string) => {
      await settings.update({
        customEndpoints: withoutEndpoint(settings.get().customEndpoints, baseUrl),
      });
    },
  };

  router.registerHandlers(
    'connections',
    {
      testMentor: (config) => testMentor(config, keys),
      testStudent: (endpoint) => testStudent(endpoint, keys),
      listModels: (source) => listConnectionModels(source, keys),
      detectLocal: () =>
        detectLocalRuntimes({ ollamaBaseUrl: ollamaBaseUrl(settings.get().defaultStudent), gpu }),
      add: (request) => addConnection(request, stores),
      remove: (source) => removeConnection(source, stores),
      signIn: async () => {
        const key = await signIns.start();
        if (key === null) return { status: 'cancelled' };
        await secrets.set('openrouter', key);
        return { status: 'signed_in' };
      },
      cancelSignIn: async () => signIns.cancel(),
    },
    {
      testMentor: z.tuple([MentorConfigSchema]),
      testStudent: z.tuple([StudentEndpointSchema]),
      listModels: z.tuple([ModelSourceSchema]),
      add: z.tuple([AddConnectionRequestSchema]),
      remove: z.tuple([z.object({ provider: ProviderIdSchema, baseUrl: z.url() }).strict()]),
      signIn: z.tuple([z.literal('openrouter')]),
    },
  );
}
