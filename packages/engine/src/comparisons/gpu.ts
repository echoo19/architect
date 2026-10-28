import { unloadOllamaModel } from '@architect/adapters';
import { AdapterError } from '@architect/shared';
import { GpuLease, type GpuLeaseOptions, type GpuPurpose } from '../local-runtime';

/** What the comparisons script does with the GPU, as the app tells whoever it keeps waiting. */
export const COMPARISON_PURPOSE: GpuPurpose = {
  priority: 'run',
  doing: 'testing a model on this computer',
  hint: 'Wait for the comparison to finish, or stop it, then try again.',
};

/**
 * The comparisons script's share of the GPU lease on the app's data folder (decision 046). Its
 * llama-server and its students on Ollama hold the GPU for each request, as the engine's do, and
 * give it up when idle to any process of the app that asks. It takes the GPU only when no process
 * of the app has it, and otherwise stops at once with the busy error: a measurement taken beside
 * the app's work would be wrong, and waiting out a long local evaluation could take hours.
 */
export function comparisonLease(
  appDataDir: string,
  timing: Pick<GpuLeaseOptions, 'pollMs' | 'heartbeatMs'> = {},
): GpuLease {
  return new GpuLease({
    dataDir: appDataDir,
    owner: 'comparisons',
    onlyWhenFree: { hint: 'Close Architect while a comparison runs, then run the command again.' },
    ...timing,
  });
}

/**
 * The meter's unload before it times a cold start (decision 045), through the lease: the script
 * holds the GPU alone while its own llama-server stops and Ollama unloads `models`, so no model of
 * Architect's stays loaded or loads meanwhile; any process of the app would have to wait, and the
 * script's own students on Ollama unload what they used as they give the GPU up to it. Fails at
 * once, unloading nothing, when a process of the app has the GPU.
 */
export function clearBeforeColdStart(
  gpu: GpuLease,
  runtime: { stop(): Promise<void> },
  ollama: { baseUrl: string; models: readonly string[] },
): (signal?: AbortSignal) => Promise<void> {
  return async (signal) => {
    const hold = await gpu.hold('llama-server', COMPARISON_PURPOSE, signal);
    try {
      await runtime.stop();
      for (const model of ollama.models) {
        try {
          await unloadOllamaModel(ollama.baseUrl, model, signal);
        } catch (error) {
          // An Ollama that isn't running, or that hasn't the model, has nothing of it loaded.
          const absent =
            error instanceof AdapterError &&
            (error.code === 'network' || error.code === 'not_found');
          if (!absent) throw error;
        }
      }
    } finally {
      hold.release();
    }
  };
}
