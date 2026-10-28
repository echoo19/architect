import {
  AdapterError,
  type MentorAdapter,
  type MentorConfig,
  type StudentAdapter,
  type StudentEndpoint,
} from '@architect/shared';
import type { MentorDeps, StudentDeps } from './deps';
import { createAnthropicMentor } from './mentor/anthropic-mentor';
import { createModelMentor } from './mentor/model-mentor';
import { createOllamaStudent } from './student/ollama';
import { createOpenAICompatibleStudent } from './student/openai-compatible';

/**
 * The mentor a job's config asks for: Anthropic's models on its Messages API, every other model
 * API on Chat Completions. A coding agent can't be a mentor yet.
 */
export function createMentor(config: MentorConfig, deps: MentorDeps = {}): MentorAdapter {
  if (config.kind !== 'model') {
    throw new AdapterError(
      'bad_request',
      `${config.label} can't be used as a mentor yet. Choose a model API instead.`,
    );
  }
  return config.provider === 'anthropic'
    ? createAnthropicMentor(config, deps)
    : createModelMentor(config, deps);
}

/** The student runtime a job's endpoint names: Ollama, or any OpenAI-compatible server. */
export function createStudent(endpoint: StudentEndpoint, deps: StudentDeps = {}): StudentAdapter {
  return endpoint.runtime === 'ollama'
    ? createOllamaStudent(endpoint, deps)
    : createOpenAICompatibleStudent(endpoint, deps);
}
