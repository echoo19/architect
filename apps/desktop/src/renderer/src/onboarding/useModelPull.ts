import { useCallback, useEffect, useReducer } from 'react';
import { GLIMMER_BUILDS, PullProgressSchema } from '@architect/shared';
import { architect } from '../api/client';
import { toError } from '../api/query';
import { idlePull, pullReducer } from './pull';

/**
 * Downloads a model through Ollama and follows its progress. One of Glimmer's builds is
 * installed the way it needs (the GPU-sized one is made text-only after its download); any other
 * model is pulled by name.
 */
export function useModelPull(model: string) {
  const [state, dispatch] = useReducer(pullReducer, idlePull);

  useEffect(
    () =>
      architect().ollama.onPullProgress((payload) => {
        const progress = PullProgressSchema.safeParse(payload);
        if (progress.success && progress.data.model === model) {
          dispatch({ type: 'progress', progress: progress.data });
        }
      }),
    [model],
  );

  /** Resolves true once the model is ready; a failure shows in the state and resolves false. */
  const start = useCallback(async (): Promise<boolean> => {
    dispatch({ type: 'start' });
    try {
      const build = GLIMMER_BUILDS.find((candidate) => candidate.model === model);
      if (build) await architect().ollama.install(build.key);
      else await architect().ollama.pull(model);
      dispatch({ type: 'finished' });
      return true;
    } catch (error) {
      dispatch({ type: 'failed', error: toError(error).message });
      return false;
    }
  }, [model]);

  return { state, start };
}
