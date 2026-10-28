import { listModels, verifyKey } from '@architect/adapters';
import { describeLlamaServer, type ServerCommand } from '@architect/engine';
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
import type { PickedPaths } from '../files/picked';
import type { IpcRouter } from '../ipc/router';
import { hubTokenStatus } from '../../utility/hub';
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
  /** Files the user chose in a dialog: the only ones that may become the llama-server. */
  picked: Pick<PickedPaths, 'checkFile'>;
  /** A stand-in llama-server for tests, described in place of the real one. */
  llamaServerCommand?: ServerCommand;
}

/**
 * Connections: testing them, their model lists, adding and removing keys, and signing in; and
 * llama-server, which serves graduates that carry an adapter.
 */
export function registerConnectionHandlers(router: IpcRouter, deps: ConnectionHandlerDeps): void {
  const { keys, secrets, settings, signIns, gpu, picked } = deps;
  const llamaServer = () =>
    describeLlamaServer(
      deps.llamaServerCommand === undefined
        ? { configured: settings.get().llamaServerPath ?? null }
        : { command: deps.llamaServerCommand },
    );
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
      llamaServer,
      // Architect runs this program, so it must be one the user picked in a file dialog.
      chooseLlamaServer: async (path) => {
        await settings.update({
          llamaServerPath: path === null ? undefined : picked.checkFile(path),
        });
        return llamaServer();
      },
      // Where the token comes from, never what it is.
      huggingFace: () => hubTokenStatus(() => keys('huggingface')),
    },
    {
      testMentor: z.tuple([MentorConfigSchema]),
      testStudent: z.tuple([StudentEndpointSchema]),
      listModels: z.tuple([ModelSourceSchema]),
      add: z.tuple([AddConnectionRequestSchema]),
      remove: z.tuple([z.object({ provider: ProviderIdSchema, baseUrl: z.url() }).strict()]),
      signIn: z.tuple([z.literal('openrouter')]),
      chooseLlamaServer: z.tuple([z.string().min(1).nullable()]),
    },
  );
}
