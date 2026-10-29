import {
  AppInfoSchema,
  AppSettingsSchema,
  ConnectionTestSchema,
  DraftTurnSchema,
  FileDiffSchema,
  GraduateSummarySchema,
  HubTokenStatusSchema,
  JobSchema,
  JobSummarySchema,
  LlamaServerStatusSchema,
  LocalRuntimesSchema,
  ModelEntrySchema,
  OllamaStatusSchema,
  ReportCardSchema,
  RunDetailSchema,
  RunSchema,
  SecretStatusSchema,
  TraceSchema,
  WorkspaceChatSchema,
  WorkspaceMessageSchema,
  type ArchitectApi,
  type Job,
  type ModelSource,
  type RunStartOptions,
  type StudentEndpoint,
  type StudentTarget,
} from '@architect/shared';
import { z } from 'zod';
import { withTypedFailures } from '../../../common/bridge';

let typed: { source: ArchitectApi; api: ArchitectApi } | undefined;

/** The preload's bridge, with each failure read back into the error it was (a coded one too). */
function bridge(): ArchitectApi {
  const source = window.architect;
  if (typed?.source !== source) typed = { source, api: withTypedFailures(source) };
  return typed.api;
}

/**
 * Data arriving from the main process is parsed before the UI trusts it. A reply that doesn't
 * match the contract becomes an error the screen can show.
 */
export async function read<T>(
  label: string,
  schema: z.ZodType<T>,
  request: Promise<unknown>,
): Promise<T> {
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
  localRuntimes: () =>
    read('connections.detectLocal', LocalRuntimesSchema, bridge().connections.detectLocal()),
  llamaServer: () =>
    read('connections.llamaServer', LlamaServerStatusSchema, bridge().connections.llamaServer()),
  hubToken: () =>
    read('connections.huggingFace', HubTokenStatusSchema, bridge().connections.huggingFace()),
  models: (source: ModelSource) =>
    read(
      'connections.listModels',
      z.array(ModelEntrySchema),
      bridge().connections.listModels(source),
    ),
  graduates: () =>
    read('graduates.list', z.array(GraduateSummarySchema), bridge().graduates.list()),
  jobs: () => read('jobs.list', z.array(JobSummarySchema), bridge().jobs.list()),
  job: (jobId: string) => read('jobs.get', JobSchema, bridge().jobs.get(jobId)),
  run: (runId: string) => read('runs.get', RunDetailSchema, bridge().runs.get(runId)),
  /** The run's report card: from where its own final test ran, or from one endpoint when named. */
  report: (runId: string, target?: StudentTarget) =>
    read('reports.get', ReportCardSchema, bridge().reports.get(runId, target)),
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

/*
 * The creation flow (Describe, Define, Train, Report). Its writes return data the screens keep
 * using, so those replies are parsed like every read.
 */
export const flowApi = {
  pickFiles: (options: Parameters<ArchitectApi['files']['pick']>[0]) =>
    read('files.pick', z.array(z.string()), bridge().files.pick(options)),
  draftStart: (description: string, files: string[]) =>
    read('jobs.draftStart', DraftTurnSchema, bridge().jobs.draftStart(description, files)),
  draftReply: (sessionId: string, text: string) =>
    read('jobs.draftReply', DraftTurnSchema, bridge().jobs.draftReply(sessionId, text)),
  saveJob: (job: Job) => read('jobs.save', JobSchema, bridge().jobs.save(job)),
  createSample: () => read('jobs.createSample', JobSchema, bridge().jobs.createSample()),
  /** Whether a model's server answers and has the model, without running it. */
  testStudent: (endpoint: StudentEndpoint) =>
    read(
      'connections.testStudent',
      ConnectionTestSchema,
      bridge().connections.testStudent(endpoint),
    ),
  startRun: (jobId: string, options: RunStartOptions) =>
    read('runs.start', RunSchema, bridge().runs.start(jobId, options)),
  /** Takes a finished run's frozen agent through its final test again on the other endpoint. */
  retest: (runId: string, target: StudentTarget) => bridge().runs.retest(runId, target),
  runs: (jobId: string) => read('runs.list', z.array(RunSchema), bridge().runs.list(jobId)),
  trace: (attemptId: string) => read('runs.trace', TraceSchema, bridge().runs.trace(attemptId)),
  roundDiff: (runId: string, round: number) =>
    read('runs.roundDiff', z.array(FileDiffSchema), bridge().runs.roundDiff(runId, round)),
  acceptGraduate: (runId: string) =>
    read('graduates.accept', GraduateSummarySchema, bridge().graduates.accept(runId)),
};
