import { useCallback, useEffect, useReducer, useState } from 'react';
import { RunEventSchema } from '@architect/shared';
import { api, architect } from '../../api/client';
import { toError } from '../../api/query';
import { initialLiveRunState, liveRunReducer, type LiveRunState } from './run-state';

/**
 * A run as it happens: subscribes to its events first, then loads the snapshot, so nothing that
 * happens in between is missed. Events that don't match the contract are reported and dropped.
 */
export function useLiveRun(runId: string): { state: LiveRunState; retry: () => void } {
  const [state, dispatch] = useReducer(liveRunReducer, initialLiveRunState);
  const [loadCount, setLoadCount] = useState(0);

  useEffect(() => {
    let active = true;
    dispatch({ type: 'loading' });
    const unsubscribe = architect().runs.onEvent((payload) => {
      const parsed = RunEventSchema.safeParse(payload);
      if (!parsed.success) {
        console.error('[train] A run event did not match the contract.', parsed.error);
        return;
      }
      if (parsed.data.runId === runId) dispatch({ type: 'event', event: parsed.data });
    });
    api.run(runId).then(
      (detail) => {
        if (active) dispatch({ type: 'snapshot', detail });
      },
      (error: unknown) => {
        if (active) dispatch({ type: 'failed', error: toError(error) });
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [runId, loadCount]);

  const retry = useCallback(() => setLoadCount((count) => count + 1), []);
  return { state, retry };
}
