import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import type { ModelPulls } from '../ollama/pulls';
import { ollamaBaseUrl, ollamaStatus } from '../ollama/status';
import type { SettingsStore } from '../settings/store';

/** Ollama on this computer: whether it runs, and model downloads. */
export function registerOllamaHandlers(
  router: IpcRouter,
  settings: SettingsStore,
  pulls: ModelPulls,
): void {
  const baseUrl = () => ollamaBaseUrl(settings.get().defaultStudent);
  router.registerHandlers(
    'ollama',
    {
      status: () => ollamaStatus(baseUrl()),
      pull: (model) => pulls.pull(baseUrl(), model),
    },
    { pull: z.tuple([z.string().min(1).max(200)]) },
  );
}
