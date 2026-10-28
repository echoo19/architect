/**
 * The local adapter runtime: llama-server on this computer, serving a base model from Ollama's
 * store with GGUF LoRA adapters for graduates that carry one (decision 031).
 */
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
export { LocalRuntimeError, type LocalRuntimeErrorCode } from './errors';
export { findFreePort, freeGpuFromOllama, type FreeGpuOptions } from './gpu';
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
  ServerCommandSchema,
  type HostRuntimeOptions,
  type LocalRuntimeSettings,
} from './settings';
export {
  LlamaServer,
  serverArgs,
  type LlamaServerLaunch,
  type LlamaServerOptions,
  type RunningServer,
  type ServerState,
  type ServerStatus,
} from './server';
