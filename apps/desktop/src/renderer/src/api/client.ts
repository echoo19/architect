import {
  JobSchema,
  ReportCardSchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
  type ArchitectApi,
} from '@architect/shared';
import { z } from 'zod';
import {
  AppInfoSchema,
  AppSettingsSchema,
  GraduateSummarySchema,
  JobSummarySchema,
  OllamaStatusSchema,
  RunDetailSchema,
  SecretStatusSchema,
} from '../../../common/schemas';

function bridge(): ArchitectApi {
  return window.architect;
}

/**
 * Data arriving from the main process is parsed before the UI trusts it. A reply that doesn't
 * match the contract becomes an error the screen can show.
 */
async function read<T>(label: string, schema: z.ZodType<T>, request: Promise<unknown>): Promise<T> {
  const result = schema.safeParse(await request);
  if (result.success) return result.data;
  console.error(`[api] ${label} returned data that doesn't match the contract.`, result.error);
  throw new Error(`Architect received data it couldn't read from ${label}.`);
}

/** Reads used by the shell. Writes go straight through `window.architect`. */
export const api = {
  appInfo: () => read('app.info', AppInfoSchema, bridge().app.info()),
  settings: () => read('settings.get', AppSettingsSchema, bridge().settings.get()),
  secretsStatus: () => read('secrets.status', SecretStatusSchema, bridge().secrets.status()),
  ollamaStatus: () => read('ollama.status', OllamaStatusSchema, bridge().ollama.status()),
  graduates: () =>
    read('graduates.list', z.array(GraduateSummarySchema), bridge().graduates.list()),
  jobs: () => read('jobs.list', z.array(JobSummarySchema), bridge().jobs.list()),
  job: (jobId: string) => read('jobs.get', JobSchema, bridge().jobs.get(jobId)),
  run: (runId: string) => read('runs.get', RunDetailSchema, bridge().runs.get(runId)),
  report: (runId: string) => read('reports.get', ReportCardSchema, bridge().reports.get(runId)),
  chats: (graduateId: string) =>
    read(
      'workspace.listChats',
      z.array(WorkspaceChatSchema),
      bridge().workspace.listChats(graduateId),
    ),
  messages: (chatId: string) =>
    read(
      'workspace.messages',
      z.array(WorkspaceMessageSchema),
      bridge().workspace.messages(chatId),
    ),
};

export { bridge as architect };
