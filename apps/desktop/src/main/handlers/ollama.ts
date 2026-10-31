import { allowedHostsOf, glimmerBuild, StudentBuildKeySchema } from '@architect/shared';
import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import type { ModelPulls } from '../ollama/pulls';
import { ollamaBaseUrl, ollamaStatus } from '../ollama/status';
import type { SettingsStore } from '../settings/store';

/** Ollama on this computer: whether it runs, model downloads, and Glimmer's builds. */
export function registerOllamaHandlers(
  router: IpcRouter,
  settings: SettingsStore,
  pulls: ModelPulls,
): void {
  const baseUrl = () => ollamaBaseUrl(settings.get().defaultStudent);
  // The default student may name an Ollama elsewhere: held to the closed network (decision 098).
  const network = { allowed: () => allowedHostsOf(settings.get().closedNetwork) };
  router.registerHandlers(
    'ollama',
    {
      status: () => ollamaStatus(baseUrl(), network),
      pull: (model) => pulls.pull(baseUrl(), model),
      install: (build) => pulls.install(baseUrl(), glimmerBuild(build)),
    },
    {
      pull: z.tuple([z.string().min(1).max(200)]),
      install: z.tuple([StudentBuildKeySchema]),
    },
  );
}
