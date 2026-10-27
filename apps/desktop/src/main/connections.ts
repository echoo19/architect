import { createMentor, createStudent } from '@architect/adapters';
import {
  keyDestinationProblem,
  type ConnectionTest,
  type MentorConfig,
  type StudentEndpoint,
} from '@architect/shared';

/** Reads a saved key by its ref. */
export type KeyLookup = (ref: string) => Promise<string | undefined>;

const ADD_KEY_HINT = 'Add the key in Settings, then test again.';

/** Checks that the mentor answers with the saved key. Nothing is sent before a key is found. */
export async function testMentor(config: MentorConfig, keys: KeyLookup): Promise<ConnectionTest> {
  if (config.kind !== 'model') {
    return {
      ok: false,
      error: `${config.label} can't be used as a mentor yet.`,
      hint: 'Choose a model API instead.',
    };
  }
  const problem = keyDestinationProblem(config.secretRef, config.baseUrl);
  if (problem !== null) return { ok: false, error: problem };
  const apiKey = await keys(config.secretRef);
  if (!apiKey) {
    return { ok: false, error: `No key is saved for ${config.label}.`, hint: ADD_KEY_HINT };
  }
  return createMentor(config, { apiKey }).testConnection();
}

/** Checks that the student's server answers and has the model. */
export async function testStudent(
  endpoint: StudentEndpoint,
  keys: KeyLookup,
): Promise<ConnectionTest> {
  let apiKey: string | undefined;
  if (endpoint.secretRef !== undefined) {
    const problem = keyDestinationProblem(endpoint.secretRef, endpoint.baseUrl);
    if (problem !== null) return { ok: false, error: problem };
    apiKey = await keys(endpoint.secretRef);
    if (!apiKey) {
      const host = new URL(endpoint.baseUrl).host;
      return { ok: false, error: `No key is saved for ${host}.`, hint: ADD_KEY_HINT };
    }
  }
  return createStudent(endpoint, { apiKey }).testConnection();
}
