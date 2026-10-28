export type LocalRuntimeErrorCode =
  /** No llama-server in Settings or on PATH. */
  | 'binary_not_found'
  /** The llama-server found is too old for the model, or didn't say its version. */
  | 'binary_unusable'
  /** The model isn't in Ollama's store under that name. */
  | 'model_not_found'
  /** The model's file is missing, the wrong size, or not a GGUF file llama-server can load. */
  | 'model_unusable'
  /** The model in Ollama's store is another build than the one its adapters were trained on. */
  | 'base_mismatch'
  /** An adapter doesn't fit the base model, or llama-server refused it. */
  | 'adapter_unusable'
  /** Ollama kept a model on the GPU after being asked to let it go. */
  | 'gpu_busy'
  /** The model doesn't fit in memory. */
  | 'out_of_memory'
  /** llama-server stopped before it was ready, or never became ready. */
  | 'start_failed'
  /** The server is answering a request with other settings; it can't restart under it. */
  | 'busy';

/** A local runtime problem, said for the person using the app, with what to do about it. */
export class LocalRuntimeError extends Error {
  readonly code: LocalRuntimeErrorCode;
  /** What the person can do to recover. */
  readonly hint: string;
  /** The server's last log lines, when its own words explain the failure. */
  readonly log: readonly string[];

  constructor(
    code: LocalRuntimeErrorCode,
    message: string,
    hint: string,
    options: { log?: readonly string[]; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'LocalRuntimeError';
    this.code = code;
    this.hint = hint;
    this.log = options.log ?? [];
  }
}
