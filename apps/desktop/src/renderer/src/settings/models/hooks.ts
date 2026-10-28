import { useEffect, useMemo, useRef, useState } from 'react';
import type { ModelEntry } from '@architect/shared';
import { api } from '../../api/client';
import { useLocalRuntimes, useSecretsStatus, useSettings } from '../../api/hooks';
import { toError } from '../../api/query';
import { connectionsFrom, type Connection } from './connections';

/** Every connection, from the saved keys, the added endpoints and the runtimes found here. */
export function useConnections() {
  const settings = useSettings();
  const secrets = useSecretsStatus();
  const local = useLocalRuntimes();
  const endpoints = settings.data?.customEndpoints;
  const connections = useMemo(
    () => connectionsFrom(secrets.data, endpoints ?? [], local.data),
    [secrets.data, endpoints, local.data],
  );
  return { connections, gpu: local.data?.gpu ?? null, secrets, local };
}

export type ListState =
  | { status: 'loading' }
  | { status: 'ready'; models: ModelEntry[] }
  | { status: 'error'; message: string };

/** Lists stay fresh for a few minutes; a provider's models don't change by the minute. */
const LIST_TTL_MS = 5 * 60_000;
const lists = new Map<string, { at: number; request: Promise<ModelEntry[]> }>();

function listOf(connection: Connection): Promise<ModelEntry[]> {
  const cached = lists.get(connection.id);
  if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.request;
  const request = api.models({
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    ...(connection.secretRef ? { secretRef: connection.secretRef } : {}),
  });
  lists.set(connection.id, { at: Date.now(), request });
  // A failed list is asked for again next time, not remembered.
  request.catch(() => lists.delete(connection.id));
  return request;
}

/** Forgets a connection's list, after its key changes. */
export function forgetModelList(connectionId: string): void {
  lists.delete(connectionId);
}

/**
 * The model lists of hosted connections, fetched while `enabled` (a picker is open). Runtimes
 * here already brought their lists with them.
 */
export function useModelLists(
  connections: readonly Connection[],
  enabled: boolean,
): Record<string, ListState> {
  const [states, setStates] = useState<Record<string, ListState>>({});
  const hosted = connections.filter((connection) => !connection.runtime);
  // The connections' objects change on every render; their ids say when the set changed.
  const key = hosted.map((connection) => connection.id).join('\n');
  const latest = useRef(hosted);
  useEffect(() => {
    latest.current = hosted;
  });

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    for (const connection of latest.current) {
      setStates((current) =>
        current[connection.id]?.status === 'ready'
          ? current
          : { ...current, [connection.id]: { status: 'loading' } },
      );
      listOf(connection).then(
        (models) => {
          if (live)
            setStates((current) => ({ ...current, [connection.id]: { status: 'ready', models } }));
        },
        (error: unknown) => {
          if (live) {
            setStates((current) => ({
              ...current,
              [connection.id]: { status: 'error', message: toError(error).message },
            }));
          }
        },
      );
    }
    return () => {
      live = false;
    };
  }, [enabled, key]);

  return states;
}
