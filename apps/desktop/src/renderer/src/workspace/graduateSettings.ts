import type { GraduateSettings } from '@architect/shared';
import { fetchQuery, setQueryData, useQuery } from '../api/query';
import { workspaceApi } from './api';

const key = (graduateId: string) => `graduate-settings:${graduateId}`;

/** The choices made for one agent, such as whether its writes need approval. */
export function useGraduateSettings(graduateId: string) {
  return useQuery(key(graduateId), () => workspaceApi.graduateSettings(graduateId));
}

export async function updateGraduateSettings(
  graduateId: string,
  patch: Partial<GraduateSettings>,
): Promise<GraduateSettings> {
  const next = await workspaceApi.updateGraduateSettings(graduateId, patch);
  setQueryData(key(graduateId), next);
  return next;
}

/** Reads them again after the host changed them, e.g. after "Always allow". */
export function refreshGraduateSettings(graduateId: string): Promise<void> {
  return fetchQuery(key(graduateId), () => workspaceApi.graduateSettings(graduateId));
}
