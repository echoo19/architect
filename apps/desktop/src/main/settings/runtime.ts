import type { LocalRuntimeSettings } from '@architect/engine';
import { isLoopbackUrl, type AppSettings } from '@architect/shared';
import { ollamaBaseUrl } from '../ollama/status';

/**
 * What both hosts' llama-servers start with: the program chosen in Settings, quiet mode's thread
 * cap, and the Ollama to unload first. That Ollama is the default student's, and only when it is
 * on this computer: one elsewhere holds no GPU here, and the runtime refuses to call it.
 */
export function localRuntimeSettings(
  settings: Pick<AppSettings, 'llamaServerPath' | 'defaultStudent'>,
  threads: number | undefined,
): LocalRuntimeSettings {
  const ollamaUrl = ollamaBaseUrl(settings.defaultStudent);
  return {
    ...(settings.llamaServerPath === undefined
      ? {}
      : { llamaServerPath: settings.llamaServerPath }),
    ...(threads === undefined ? {} : { threads }),
    ...(isLoopbackUrl(ollamaUrl) ? { ollamaUrl } : {}),
  };
}
