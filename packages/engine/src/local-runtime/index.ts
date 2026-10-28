/**
 * The local adapter runtime: llama-server on this computer, serving a base model from Ollama's
 * store with GGUF LoRA adapters for graduates that carry one (decision 031).
 */
export { appDataDir } from './app-data';
export {
  checkServerVersion,
  describeLlamaServer,
  findLlamaServer,
  llamaServerFileName,
  MIN_LLAMA_SERVER_BUILD,
  parseServerVersion,
  readServerVersion,
  type DescribeServerOptions,
  type FindServerOptions,
  type FoundServer,
  type ServerCommand,
  type ServerVersion,
} from './binary';
export { asAdapterError, LocalRuntimeError, type LocalRuntimeErrorCode } from './errors';
export { findFreePort, freeGpuFromOllama, type FreeGpuOptions } from './gpu';
export {
  GpuLease,
  type GpuHold,
  type GpuLeaseOptions,
  type GpuRelease,
  type GpuWatch,
} from './lease';
export {
  CHECK_PURPOSE,
  replyPurpose,
  RUN_PURPOSE,
  type GpuPriority,
  type GpuPurpose,
  type GpuUse,
} from './lease-rules';
export { OllamaUse } from './ollama-use';
export {
  ollamaModelsDirs,
  parseOllamaName,
  resolveOllamaModel,
  type OllamaModelFile,
  type OllamaStoreOptions,
} from './ollama-models';
export {
  LocalAdapterRuntime,
  shortDigest,
  type AdapterFile,
  type AdapterServing,
  type LocalAdapterRuntimeOptions,
  type ServeRequest,
  type ServeSurvey,
} from './runtime';
export {
  hostAdapterRuntime,
  LocalRuntimeSettingsSchema,
  quietThreadCap,
  runtimeSettingsOf,
  ServerCommandSchema,
  type HostRuntimeOptions,
  type LocalRuntimeSettings,
} from './settings';
export {
  LlamaServer,
  serverArgs,
  stopServerLeftIn,
  type LlamaServerLaunch,
  type LlamaServerOptions,
  type RunningServer,
  type ServerState,
  type ServerStatus,
} from './server';
