import {
  AdapterError,
  type MentorAdapter,
  type MentorConfig,
  type StudentAdapter,
  type StudentEndpoint,
} from '@architect/shared';
import type { MentorDeps, StudentDeps } from './deps';
import { createModelMentor } from './mentor/model-mentor';
import { createOllamaStudent } from './student/ollama';
import { createOpenAICompatibleStudent } from './student/openai-compatible';

/** The mentor a job's config asks for. Only model APIs are built; a coding agent isn't yet. */
export function createMentor(config: MentorConfig, deps: MentorDeps): MentorAdapter {
  if (config.kind === 'model') return createModelMentor(config, deps);
  throw new AdapterError(
    'bad_request',
    `${config.label} can't be used as a mentor yet. Choose a model API instead.`,
  );
}

/** The student runtime a job's endpoint names: Ollama, or any OpenAI-compatible server. */
export function createStudent(endpoint: StudentEndpoint, deps: StudentDeps = {}): StudentAdapter {
  return endpoint.runtime === 'ollama'
    ? createOllamaStudent(endpoint, deps)
    : createOpenAICompatibleStudent(endpoint, deps);
}
