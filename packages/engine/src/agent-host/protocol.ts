import {
  WorkspaceChatSchema,
  WorkspaceEventSchema,
  WorkspaceMessageSchema,
} from '@architect/shared';
import { z } from 'zod';
import type { EnginePort } from '../host/port';
import { LocalRuntimeSettingsSchema, type LocalRuntimeSettings } from '../local-runtime';
import type { BlockedConnection } from './guard/install';
import type { AgentHost, SendOptions } from './host';

/**
 * The channel to or from the agent host: an Electron utility process port, a Node IPC channel
 * or an in-memory pair in tests. The same shape as the engine host's.
 */
export type AgentHostPort = EnginePort;

/**
 * What the host answers over its port: the workspace API, graduates, guard diagnostics, and the
 * settings its adapter runtime follows.
 */
export interface AgentHostApi extends Omit<AgentHost, 'onEvent' | 'close'> {
  /** Network calls the process's guard has blocked, oldest first. */
  blockedConnections(): Promise<BlockedConnection[]>;
  /** The settings llama-server starts with from now on: its path, the thread cap, which Ollama. */
  configure(settings: LocalRuntimeSettings): Promise<void>;
}

export const BlockedConnectionSchema = z.object({
  api: z.string(),
  target: z.string(),
  at: z.iso.datetime(),
}) satisfies z.ZodType<BlockedConnection>;

const id = z.string().min(1);

/** How a message is sent: whether a write that needs approval may wait for the user. */
export const SendOptionsSchema = z
  .object({ approvals: z.enum(['ask', 'fail']).optional() })
  .strict() satisfies z.ZodType<SendOptions>;

/**
 * One request type: the schema its parameters must pass in the host, the schema its result
 * must pass in the client, and how the host answers it.
 */
function route<P extends z.ZodType<unknown[]>, R extends z.ZodType>(
  params: P,
  result: R,
  answer: (api: AgentHostApi, params: z.output<P>) => Promise<z.input<R>>,
) {
  return {
    params,
    result,
    answer: (api: AgentHostApi, raw: unknown) => answer(api, params.parse(raw)),
  };
}

export const AGENT_HOST_ROUTES = {
  'host.openGraduate': route(
    z.tuple([id, z.number().int().positive().optional()]),
    z.void(),
    (api, [graduateId, cpuThreads]) =>
      cpuThreads === undefined
        ? api.openGraduate(graduateId)
        : api.openGraduate(graduateId, cpuThreads),
  ),
  'host.closeGraduate': route(z.tuple([id]), z.void(), (api, [graduateId]) =>
    api.closeGraduate(graduateId),
  ),
  'host.blockedConnections': route(z.tuple([]), z.array(BlockedConnectionSchema), (api) =>
    api.blockedConnections(),
  ),
  'host.configure': route(z.tuple([LocalRuntimeSettingsSchema]), z.void(), (api, [settings]) =>
    api.configure(settings),
  ),
  'workspace.listChats': route(z.tuple([id]), z.array(WorkspaceChatSchema), (api, [graduateId]) =>
    api.listChats(graduateId),
  ),
  'workspace.createChat': route(z.tuple([id]), WorkspaceChatSchema, (api, [graduateId]) =>
    api.createChat(graduateId),
  ),
  'workspace.messages': route(z.tuple([id]), z.array(WorkspaceMessageSchema), (api, [chatId]) =>
    api.messages(chatId),
  ),
  'workspace.send': route(
    z.tuple([id, z.string().min(1), SendOptionsSchema.optional()]),
    z.void(),
    (api, [chatId, text, options]) =>
      options === undefined ? api.send(chatId, text) : api.send(chatId, text, options),
  ),
  'workspace.stop': route(z.tuple([id]), z.void(), (api, [chatId]) => api.stop(chatId)),
  'workspace.decide': route(
    z.tuple([id, z.enum(['approve', 'deny', 'always'])]),
    z.void(),
    (api, [changeId, decision]) => api.decide(changeId, decision),
  ),
};

export type AgentHostRoutes = typeof AGENT_HOST_ROUTES;
export type AgentHostMethod = keyof AgentHostRoutes;
export type AgentHostParams<M extends AgentHostMethod> = z.input<AgentHostRoutes[M]['params']>;
export type AgentHostResult<M extends AgentHostMethod> = z.output<AgentHostRoutes[M]['result']>;

export function isAgentHostMethod(method: string): method is AgentHostMethod {
  return Object.hasOwn(AGENT_HOST_ROUTES, method);
}

export const HostEventMessageSchema = z.object({
  kind: z.literal('event'),
  event: WorkspaceEventSchema,
});

/** The host sends this once it is listening; requests sent earlier could be lost. */
export const ReadyMessageSchema = z.object({ kind: z.literal('ready') });

/**
 * The parent sends this when the app quits: the host stops its replies and its llama-server, then
 * exits, so no server outlives it holding the GPU.
 */
export const StopMessageSchema = z.object({ kind: z.literal('stop') });
