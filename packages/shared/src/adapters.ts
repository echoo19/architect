import type { ChatMessage, ToolCall, ToolSpec, Usage } from './chat';
import type { Decoding } from './harness';
import type { JsonSchemaObject } from './json';
import type { ReasoningEffort } from './job';

export interface StudentChatRequest {
  messages: ChatMessage[];
  tools: ToolSpec[];
  decoding: Decoding;
  /** Sampler seed chosen by the runner, never by the harness, so a change can't re-roll results. */
  seed: number;
}

export type StudentStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'done'; usage: Usage; finish: 'stop' | 'tool_calls' | 'length' };

export interface StudentModelInfo {
  model: string;
  quantization?: string;
  digest?: string;
  sizeBytes?: number;
  contextLength?: number;
}

export type ConnectionTest =
  { ok: true; latencyMs: number; detail: string } | { ok: false; error: string; hint?: string };

/** A model that attempts tasks. Local runtimes and hosted endpoints share this interface. */
export interface StudentAdapter {
  readonly label: string;
  readonly model: string;
  readonly baseUrl: string;
  /** True only when every request goes to a loopback address. */
  readonly isLocal: boolean;
  chat(request: StudentChatRequest, signal?: AbortSignal): AsyncIterable<StudentStreamEvent>;
  describe(): Promise<StudentModelInfo>;
  testConnection(): Promise<ConnectionTest>;
  /** Free the model's memory (Ollama: keep_alive 0). */
  release(): Promise<void>;
}

export interface MentorCompletionRequest {
  system: string;
  messages: ChatMessage[];
  /** When set, the reply must be JSON matching this schema. */
  json?: { name: string; schema: JsonSchemaObject };
  reasoningEffort?: ReasoningEffort;
  maxOutputTokens: number;
}

export interface MentorCompletion {
  text: string;
  /** Parsed JSON when `json` was requested. */
  json?: unknown;
  usage: Usage;
  /** Null when the endpoint's price isn't known. */
  costUsd: number | null;
  model: string;
  latencyMs: number;
}

/** A model that diagnoses failures and writes harness changes. */
export interface MentorAdapter {
  readonly kind: 'model';
  readonly label: string;
  readonly model: string;
  readonly provider: string;
  complete(request: MentorCompletionRequest, signal?: AbortSignal): Promise<MentorCompletion>;
  /** Dollar cost of a usage record, or null if the price isn't known. */
  estimateCostUsd(usage: Usage): number | null;
  testConnection(): Promise<ConnectionTest>;
}
