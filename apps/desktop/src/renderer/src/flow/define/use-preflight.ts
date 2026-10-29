import { useCallback, useEffect, useState } from 'react';
import type { Job, LocalRuntimes, ProviderId, StudentTarget } from '@architect/shared';
import { api, flowApi } from '../../api/client';
import { queryKeys, useHubToken, useLocalRuntimes, useSecretsStatus } from '../../api/hooks';
import { fetchQuery, type QueryState } from '../../api/query';
import { attempt } from '../../lib/notify';
import type { KeyStatus } from './hosted';
import { needsSummary, runNeeds, type HostedProblem, type LocalState, type Need } from './needs';
import { tokenState } from './teacher-menu';

/** The saved keys as far as they are known; the last answer stays while a new one is read. */
export function keyStatusOf(query: QueryState<Record<string, boolean>>): KeyStatus {
  if (query.status === 'error') return 'error';
  return query.data ?? 'loading';
}

function localStateOf(query: QueryState<LocalRuntimes>): LocalState {
  if (query.status === 'error') return 'error';
  return query.data ?? 'loading';
}

/** Which online copy a check was made of, so a change of copy forgets what was found. */
function copyKey(job: Job): string | null {
  const copy = job.student.hosted;
  return copy ? `${copy.baseUrl} ${copy.model} ${copy.secretRef ?? ''}` : null;
}

/**
 * Everything the Define screen knows about whether a run can start: what is missing, the one
 * action that fixes each, and whether the answer is still being looked for. The teacher's key and
 * the model on this computer are read as they stand; the online copy is asked live, when a run
 * is about to start and when the person asks again.
 */
export function usePreflight(
  job: Job,
  testPlace: StudentTarget,
  openSettings: (tab: 'mentor' | 'student') => void,
) {
  const secrets = useSecretsStatus();
  const local = useLocalRuntimes();
  const hubToken = useHubToken();
  const [found, setFound] = useState<{ copy: string | null; problem: HostedProblem } | null>(null);
  const [asking, setAsking] = useState(false);
  const [adding, setAdding] = useState<ProviderId | null>(null);

  // Keys can be added in Settings, and Ollama started, at any time: look again whenever a job opens.
  const { reload: reloadKeys } = secrets;
  const { reload: reloadLocal } = local;
  useEffect(() => reloadKeys(), [reloadKeys]);
  useEffect(() => reloadLocal(), [reloadLocal]);

  const keys = keyStatusOf(secrets);
  const copy = copyKey(job);
  const hostedProblem = found !== null && found.copy === copy ? found.problem : null;
  const localState = localStateOf(local);
  const needs = runNeeds({
    job,
    testPlace,
    keys,
    local: localState,
    hostedProblem,
    token: tokenState(hubToken),
  });

  /** Asks the online copy whether it answers. True when it does; false says why in the needs. */
  const askHosted = useCallback(async (): Promise<boolean> => {
    const endpoint = job.student.hosted;
    if (endpoint === undefined) return false;
    setAsking(true);
    const result = await attempt("Couldn't reach the online copy", () =>
      flowApi.testStudent(endpoint),
    );
    setAsking(false);
    if (result === undefined) return false;
    if (result.ok) {
      setFound(null);
      return true;
    }
    setFound({ copy: copyKey(job), problem: { error: result.error, hint: result.hint } });
    return false;
  }, [job]);

  const act = (need: Need): void => {
    const { action } = need;
    switch (action.kind) {
      case 'add_key':
        setAdding(action.provider);
        return;
      case 'open':
        openSettings(action.tab);
        return;
      case 'recheck':
        if (action.what === 'keys') reloadKeys();
        else if (action.what === 'local') void fetchQuery(queryKeys.local, api.localRuntimes);
        else void askHosted();
        return;
      case 'download':
        // The row's own button downloads; nothing else asks for it.
        return;
    }
  };

  return {
    keys,
    needs,
    summary: needsSummary(needs),
    /** Something is missing, or not known yet: a run waits. */
    blocked: needs.length > 0 || keys === 'loading' || localState === 'loading',
    /** The need whose action is working now. */
    busyId: asking ? 'host-unreachable' : null,
    act,
    askHosted,
    reloadKeys,
    adding,
    stopAdding: () => setAdding(null),
  };
}
