/**
 * The agent host: chats with graduates, offline. `main.ts` is its process entry; the desktop app
 * runs it as an Electron utility process and talks to it through `connectAgentHost`.
 */

export { connectAgentHost } from './client';
export type { AgentHostClient } from './client';
export { describeBlocked, installLoopbackOnlyGuard } from './guard/install';
export type { BlockedConnection, LoopbackGuard, LoopbackGuardOptions } from './guard/install';
export { createAgentHost } from './host';
export type { AgentHost, AgentHostOptions, SendOptions, WorkspaceApi } from './host';
export { AGENT_HOST_ROUTES, BlockedConnectionSchema, SendOptionsSchema } from './protocol';
export type { AgentHostApi, AgentHostPort } from './protocol';
export { serveAgentHost } from './serve';
export type { ServeOptions } from './serve';
export { workspaceStore } from './store';
export type { WorkspaceStore } from './store';
