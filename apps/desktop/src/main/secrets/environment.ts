import type { NamedSecretRef } from '@architect/shared';
import type { KeyFallback } from './store';

/** The environment variable holding each service's key, by the names the developer scripts read. */
const ENVIRONMENT_NAMES: Record<NamedSecretRef, string> = {
  meta: 'META_API_TOKEN',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  together: 'TOGETHER_API_KEY',
  deepinfra: 'DEEPINFRA_API_KEY',
  fireworks: 'FIREWORKS_API_KEY',
  baseten: 'BASETEN_API_KEY',
  modal: 'MODAL_PROXY_TOKEN',
  huggingface: 'HF_TOKEN',
};

/**
 * Keys read from the environment by name, so a developer can run and record the app with real
 * models without typing a key into it. Only an unpackaged build started with
 * ARCHITECT_KEYS_FROM_ENV=1 reads them; a packaged app never does, whatever its environment.
 */
export function environmentKeys(
  env: NodeJS.ProcessEnv,
  packaged: boolean,
): KeyFallback | undefined {
  if (packaged || env['ARCHITECT_KEYS_FROM_ENV'] !== '1') return undefined;
  return (ref) => {
    const name = (ENVIRONMENT_NAMES as Partial<Record<string, string>>)[ref];
    const value = name === undefined ? undefined : env[name]?.trim();
    return value ? value : undefined;
  };
}
