export { createMentor, createStudent } from './factory';
export { createMentorActor } from './mentor/actor';
export { createModelMentor, MentorReplyError } from './mentor/model-mentor';
export type { ModelMentorConfig } from './mentor/providers';
export { listModels, verifyKey, type ListModelsOptions } from './models/list';
export { createOllamaStudent } from './student/ollama';
export {
  listOllamaModels,
  loadedOllamaModels,
  makeTextOnlyModel,
  ollamaVersion,
  pullOllamaModel,
  unloadOllamaModel,
  type LoadedModel,
  type OllamaModelEntry,
  type TextOnlyModel,
} from './student/ollama-api';
export { createOpenAICompatibleStudent } from './student/openai-compatible';
export { createLlamaCppStudent } from './student/llamacpp';
export { isLoopbackUrl } from './loopback';
export type { AdapterDeps, MentorDeps, StudentDeps } from './deps';
export type { Timeouts } from './http/client';
export type { RetryOptions, Sleep } from './http/retry';
