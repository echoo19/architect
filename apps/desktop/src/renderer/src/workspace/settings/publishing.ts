import { create } from 'zustand';
import {
  PublishProgressSchema,
  type HubVisibility,
  type PublishProgress,
  type PublishRequest,
  type PublishResult,
} from '@architect/shared';
import { architect } from '../../api/client';
import { graduateKeys, graduatesApi } from '../../api/graduates';
import { fetchQuery, toError } from '../../api/query';

/** What a publication sends where. */
export interface PublishTarget {
  repository: string;
  version: number;
  visibility: HubVisibility;
}

/** Where an agent's publication stands. */
export type PublishState =
  | { kind: 'idle' }
  | (PublishTarget & {
      kind: 'publishing';
      /** The stage and bytes the engine last reported, if it has yet. */
      progress: PublishProgress | null;
    })
  | { kind: 'done'; result: PublishResult }
  | (PublishTarget & { kind: 'failed'; message: string });

export const IDLE: PublishState = { kind: 'idle' };

interface Publishing {
  /** Each agent's publication, kept apart from its settings, which can close while one goes. */
  states: Record<string, PublishState>;
  set: (graduateId: string, state: PublishState) => void;
}

export const usePublishing = create<Publishing>((set) => ({
  states: {},
  set: (graduateId, state) =>
    set((current) => ({ states: { ...current.states, [graduateId]: state } })),
}));

/** The repository and visibility the agent's last publication here went to, if any. */
export function lastTarget(
  state: PublishState,
): Pick<PublishTarget, 'repository' | 'visibility'> | null {
  if (state.kind === 'idle') return null;
  if (state.kind === 'done') {
    const { repository, visibility } = state.result.publication;
    return { repository, visibility };
  }
  return { repository: state.repository, visibility: state.visibility };
}

/**
 * Publishes a version of an agent, following the engine's progress until it ends, whether or not
 * the agent's settings stay open; then reads the agent's publications again.
 */
export async function startPublishing(
  graduateId: string,
  target: PublishTarget,
  request: PublishRequest,
): Promise<void> {
  const { set } = usePublishing.getState();
  set(graduateId, { kind: 'publishing', ...target, progress: null });
  const stop = architect().graduates.onPublishProgress((raw) => {
    const parsed = PublishProgressSchema.safeParse(raw);
    if (!parsed.success || parsed.data.graduateId !== graduateId) return;
    const current = usePublishing.getState().states[graduateId];
    if (current?.kind === 'publishing') set(graduateId, { ...current, progress: parsed.data });
  });
  try {
    const result = await graduatesApi.publish(graduateId, request);
    set(graduateId, { kind: 'done', result });
  } catch (failure) {
    set(graduateId, { kind: 'failed', ...target, message: toError(failure).message });
  } finally {
    stop();
  }
  await fetchQuery(graduateKeys.publications(graduateId), () =>
    graduatesApi.publications(graduateId),
  );
}
