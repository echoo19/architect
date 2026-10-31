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
  | {
      type: 'done';
      usage: Usage;
      finish: 'stop' | 'tool_calls' | 'length';
      /** What the provider says it charged for the call, in US dollars, when it says so. */
      costUsd?: number;
    };

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
  /**
   * The context window, in tokens, the student runs under: what the runtime is asked for (Ollama's
   * `num_ctx`, llama-server's `--ctx-size`) or the job's setting for a hosted copy, so an agent
   * is developed under the limit it later runs under. The agent loop keeps every prompt, with
   * room for the reply, inside it. Null for the mentor's model acting as the agent, whose window
   * is far beyond any task here.
   */
  readonly contextLength: number | null;
  chat(request: StudentChatRequest, signal?: AbortSignal): AsyncIterable<StudentStreamEvent>;
  describe(): Promise<StudentModelInfo>;
  testConnection(): Promise<ConnectionTest>;
  /** Free the model's memory (Ollama: keep_alive 0). */
  release(): Promise<void>;
}

/**
 * The mentor's model working as an agent: it takes the student's tools and attempts a task, to
 * demonstrate a correction or to serve as a reference. Every call costs mentor dollars, so it
 * can price its own usage; the runner admits each call through the mentor's gate.
 */
export interface ActorAdapter extends StudentAdapter {
  /** Dollar cost of a usage record, or null if the price isn't known. */
  estimateCostUsd(usage: Usage): number | null;
}

/** One loaded adapter's weight in a llama-server request: its place in the load order, and its scale. */
export interface LoraScale {
  id: number;
  scale: number;
}

/**
 * A llama-server the app runs on this computer, as one llama.cpp student sees it: the base model,
 * every adapter loaded once, and this student's scale for each. Students that share a base and
 * an adapter set share one server and one copy of the weights on the GPU.
 */
export interface LlamaServerAccess {
  /** The base model, by its name in Ollama's store. */
  readonly model: string;
  /** Loopback. The port changes each time the server starts. */
  readonly baseUrl: string;
  /** The context size the server starts with, in tokens. */
  readonly contextLength: number;
  /** Starts the server if it isn't running, and keeps it from stopping until `release`. */
  acquire(signal?: AbortSignal): Promise<LlamaServerLease>;
  /** Checks what loading needs: the server program, the model's file and every adapter. Loads nothing. */
  check(): Promise<ConnectionTest>;
  describe(): Promise<StudentModelInfo>;
  /**
   * Stops the server, which frees the GPU: now if no student has a request in flight on it,
   * otherwise as soon as the last one ends.
   */
  stop(): Promise<void>;
}

export interface LlamaServerLease {
  /** `http://127.0.0.1:<port>`, without `/v1`. */
  url: string;
  /** The server refuses requests without it. */
  apiKey: string;
  /** Every loaded adapter with this student's scale for it; 0 for the ones it doesn't use. */
  lora: LoraScale[];
  release(): void;
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

/** One recording's text, as a transcription service returns it. */
export interface Transcription {
  /** Each turn in order, with the speaker's label when the service tells speakers apart. */
  turns: { speaker?: string; text: string }[];
  /** The audio the service measured, in milliseconds; it bills whole seconds of it. */
  durationMs: number;
}

/** A service that turns speech in a WAV file into text (decision 087). */
export interface Transcriber {
  readonly label: string;
  readonly model: string;
  transcribe(wav: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<Transcription>;
}
