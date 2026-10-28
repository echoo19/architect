import { runtimeSettingsOf, type LocalRuntimeSettings } from '@architect/engine';
import type { AppSettings } from '@architect/shared';

/**
 * What both hosts' llama-servers start with: the program chosen in Settings, quiet mode's thread
 * cap, and the default student's Ollama when it is on this computer. The architect command reads
 * the same settings file the same way (`runtimeSettingsOf`).
 */
export function localRuntimeSettings(
  settings: Pick<AppSettings, 'llamaServerPath' | 'defaultStudent'>,
  threads: number | undefined,
): LocalRuntimeSettings {
  return runtimeSettingsOf(settings, threads);
}
