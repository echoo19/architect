import { useCallback, useEffect, useReducer } from 'react';
import { PullProgressSchema } from '@architect/shared';
import { architect } from '../api/client';
import { toError } from '../api/query';
import { idlePull, pullReducer } from './pull';

/** Downloads a model through Ollama and follows its progress. */
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

  const start = useCallback(async () => {
    dispatch({ type: 'start' });
    try {
      await architect().ollama.pull(model);
      dispatch({ type: 'finished' });
    } catch (error) {
      dispatch({ type: 'failed', error: toError(error).message });
    }
  }, [model]);

  return { state, start };
}
