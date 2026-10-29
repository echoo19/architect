import { useEffect } from 'react';
import { RunEventSchema, type RunEvent } from '@architect/shared';
import { api, architect } from './client';
import { queryKeys } from './hooks';
import { fetchQuery } from './query';

/** The lists every screen reads, which an event from the engine can make stale. */
export type StaleList = 'jobs' | 'graduates';

/**
 * Which lists an event makes stale. The list of jobs follows each run's newest state, so it is
 * read again when a run changes status or starts waiting for an answer, not on every attempt. A
 * graduate that became ready is a new agent, or a new version of one, and moves its run's row
 * from training to results, so both lists are read again. `heard` holds the state last heard of
 * each run.
 */
export function staleLists(event: RunEvent, heard: Map<string, string>): StaleList[] {
  switch (event.type) {
    case 'run.updated': {
      const { status, phase } = event.run;
      const state = `${status}:${phase === 'clarifying' ? 'asking' : ''}`;
      if (heard.get(event.runId) === state) return [];
      heard.set(event.runId, state);
      return ['jobs'];
    }
    case 'graduate.ready':
      return ['graduates', 'jobs'];
    default:
      return [];
  }
}

const READS: Record<StaleList, () => Promise<unknown>> = {
  jobs: api.jobs,
  graduates: api.graduates,
};

/**
 * Keeps the lists of jobs and agents current whichever screen is open: the sidebar isn't on the
 * training and results screens, and an agent made while one of them is open must be in the list by
 * the time the person leaves it, never after a restart.
 */
export function useEngineUpdates(): void {
  useEffect(() => {
    const heard = new Map<string, string>();
    return architect().runs.onEvent((payload) => {
      const parsed = RunEventSchema.safeParse(payload);
      if (!parsed.success) return;
      for (const list of staleLists(parsed.data, heard)) {
        void fetchQuery(queryKeys[list], READS[list]);
      }
    });
  }, []);
}

/** Reads both lists again, such as after the person accepted the agent a run made. */
export function refreshRunLists(): Promise<void[]> {
  return Promise.all(
    (['jobs', 'graduates'] as const).map((list) => fetchQuery(queryKeys[list], READS[list])),
  );
}
