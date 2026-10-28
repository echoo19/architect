import {
  AdapterError,
  openAiTakesReasoningEffort,
  PROVIDERS,
  type MentorConfig,
} from '@architect/shared';
import type { SystemRole } from '../openai/messages';

export type ModelMentorConfig = MentorConfig & { kind: 'model' };

/** How a reply is held to the JSON schema the loop asks for. */
export type JsonMode =
  /** `response_format` carries the schema and the server constrains decoding to it. */
  | 'schema'
  /**
   * The schema goes in `response_format` and in the prompt too: a router passes the field on to
   * models that honour it and quietly drops it for the rest.
   */
  | 'schema_and_prompt'
  /** The schema goes in the prompt only; a reply that doesn't parse gets one repair call. */
  | 'prompt';

/** How the endpoint is told how hard to think, if at all. */
export type ReasoningControl = 'reasoning_effort' | 'openrouter' | 'none';

/** How a provider wants its chat requests worded. */
export interface ChatTraits {
  /** Who is answering, as a person would name it. */
  service: string;
  /** Where Chat Completions answers. */
  baseUrl: string;
  /** OpenAI and Meta rank `developer` above `system`; the others only know `system`. */
  systemRole: SystemRole;
  /** The field that caps output. Reasoning tokens count against it. */
  tokenLimitField: 'max_completion_tokens' | 'max_tokens';
  json: JsonMode;
  /** OpenAI checks a schema against its strict subset when asked, and then holds replies to it. */
  strictSchema: boolean;
  reasoning: ReasoningControl;
  /** `prompt_cache_key`, which OpenAI and Meta document. */
  sendsCacheKey: boolean;
  /** Modal keeps one conversation on one container when every request carries the same key. */
  sendsAffinityKey: boolean;
  /** OpenRouter may route to any of a model's providers; this caps their price at the budgeted one. */
  capsPrice: boolean;
  /** Sent with every request, such as OpenRouter's app attribution. */
  headers: Record<string, string>;
}

const PLAIN: Omit<ChatTraits, 'service' | 'baseUrl'> = {
  systemRole: 'system',
  tokenLimitField: 'max_tokens',
  json: 'prompt',
  strictSchema: false,
  reasoning: 'none',
  sendsCacheKey: false,
  sendsAffinityKey: false,
  capsPrice: false,
  headers: {},
};

/** How OpenRouter credits requests to the app that sent them. */
const OPENROUTER_ATTRIBUTION = {
  'http-referer': 'https://github.com/echoo19/architect',
  'x-title': 'Architect',
};

function hostOf(baseUrl: string): string {
  return new URL(baseUrl).host;
}

/** The traits of a mentor behind an OpenAI-compatible Chat Completions endpoint. */
export function chatTraits(config: ModelMentorConfig): ChatTraits {
  const { baseUrl } = config;
  switch (config.provider) {
    case 'meta':
      return {
        ...PLAIN,
        service: 'Meta',
        baseUrl,
        systemRole: 'developer',
        tokenLimitField: 'max_completion_tokens',
        json: 'schema',
        reasoning: 'reasoning_effort',
        sendsCacheKey: true,
      };
    case 'openai':
      return {
        ...PLAIN,
        service: 'OpenAI',
        baseUrl,
        systemRole: 'developer',
        tokenLimitField: 'max_completion_tokens',
        json: 'schema',
        strictSchema: true,
        reasoning: openAiTakesReasoningEffort(config.model) ? 'reasoning_effort' : 'none',
        sendsCacheKey: true,
      };
    case 'gemini':
      return {
        ...PLAIN,
        service: 'Google Gemini',
        baseUrl,
        json: 'schema',
        reasoning: 'reasoning_effort',
      };
    case 'openrouter':
      return {
        ...PLAIN,
        service: 'OpenRouter',
        baseUrl,
        json: 'schema_and_prompt',
        reasoning: 'openrouter',
        capsPrice: true,
        headers: OPENROUTER_ATTRIBUTION,
      };
    case 'baseten':
      return { ...PLAIN, service: 'Baseten', baseUrl, reasoning: 'reasoning_effort' };
    case 'modal':
      return {
        ...PLAIN,
        service: 'Modal',
        baseUrl,
        reasoning: 'reasoning_effort',
        sendsAffinityKey: true,
      };
    case 'ollama':
      // Ollama's Chat Completions live under /v1 of the address its native API uses.
      return {
        ...PLAIN,
        service: 'Ollama',
        baseUrl: `${baseUrl.replace(/\/+$/, '')}/v1`,
        json: 'schema',
      };
    case 'lmstudio':
      return { ...PLAIN, service: 'LM Studio', baseUrl, json: 'schema' };
    case 'groq':
      // Groq can't stream a schema-held reply, and has deprecated `max_tokens`.
      return {
        ...PLAIN,
        service: PROVIDERS.groq.label,
        baseUrl,
        tokenLimitField: 'max_completion_tokens',
      };
    case 'together':
    case 'deepinfra':
    case 'fireworks':
      return { ...PLAIN, service: PROVIDERS[config.provider].label, baseUrl };
    case 'other':
      return { ...PLAIN, service: hostOf(baseUrl), baseUrl };
    case 'anthropic':
      throw new AdapterError(
        'bad_request',
        "Anthropic's models use the Messages API, not Chat Completions.",
      );
  }
}
