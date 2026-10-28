import { useCallback, useEffect } from 'react';
import { AppSettingsSchema, type AppSettings } from '@architect/shared';
import { api, architect } from './client';
import { fetchQuery, setQueryData, useQuery } from './query';

export const queryKeys = {
  settings: 'settings',
  appInfo: 'app.info',
  secrets: 'secrets.status',
  ollama: 'ollama.status',
  local: 'connections.local',
  models: (source: { provider: string; baseUrl: string }) =>
    `models:${source.provider}:${source.baseUrl}`,
  graduates: 'graduates',
  jobs: 'jobs',
  job: (jobId: string) => `job:${jobId}`,
  run: (runId: string) => `run:${runId}`,
  report: (runId: string) => `report:${runId}`,
  chats: (graduateId: string) => `chats:${graduateId}`,
  messages: (chatId: string) => `messages:${chatId}`,
};

export function useSettings() {
  const query = useQuery(queryKeys.settings, api.settings);
  useEffect(
    () =>
      architect().settings.onChange((next) => {
        const parsed = AppSettingsSchema.safeParse(next);
        if (parsed.success) setQueryData(queryKeys.settings, parsed.data);
      }),
    [],
  );
  const update = useCallback(async (patch: Partial<AppSettings>): Promise<AppSettings> => {
    const next = await architect().settings.update(patch);
    setQueryData(queryKeys.settings, next);
    return next;
  }, []);
  return { ...query, update };
}

export const useAppInfo = () => useQuery(queryKeys.appInfo, api.appInfo);
export const useSecretsStatus = () => useQuery(queryKeys.secrets, api.secretsStatus);
export const useOllamaStatus = () => useQuery(queryKeys.ollama, api.ollamaStatus);
export const useLocalRuntimes = () => useQuery(queryKeys.local, api.localRuntimes);
export const useGraduates = () => useQuery(queryKeys.graduates, api.graduates);
export const useJobs = () => useQuery(queryKeys.jobs, api.jobs);

export const useJob = (jobId: string) => useQuery(queryKeys.job(jobId), () => api.job(jobId));
export const useRunDetail = (runId: string) => useQuery(queryKeys.run(runId), () => api.run(runId));
export const useReport = (runId: string) =>
  useQuery(queryKeys.report(runId), () => api.report(runId));
export const useChats = (graduateId: string) =>
  useQuery(queryKeys.chats(graduateId), () => api.chats(graduateId));
export const useMessages = (chatId: string) =>
  useQuery(queryKeys.messages(chatId), () => api.messages(chatId));

/** Starts a chat with an agent and refreshes its chat list. */
export async function createChat(graduateId: string) {
  const chat = await architect().workspace.createChat(graduateId);
  await fetchQuery(queryKeys.chats(graduateId), () => api.chats(graduateId));
  return chat;
}
