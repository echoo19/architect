import {
  emptyUsage,
  readsReasoningStrengthLine,
  type LlamaServerAccess,
  type LoraScale,
  type StudentAdapter,
  type StudentChatRequest,
  type StudentStreamEvent,
} from '@architect/shared';
import type { StudentDeps } from '../deps';
import { createHttpClient } from '../http/client';
import { isLoopbackUrl } from '../loopback';
import { toWireMessages, toWireTools } from '../openai/messages';
import { readChatCompletionStream } from '../openai/stream';
import { countToolCalls } from '../tool-calls';
import { rest } from './rest';

export const LLAMACPP_SERVICE = 'llama.cpp';

/**
 * A student served by llama.cpp's llama-server, which the app runs on this computer with the
 * base model and every adapter loaded once. Each request names every loaded adapter with this
 * student's scale for it, so a candidate and the base it was trained on share one server and
 * one copy of the weights. The server must run with `--jinja`, which returns Glimmer's tool
 * calls as structured calls and its reasoning as `reasoning_content`; like Ollama's thinking,
 * the reasoning is counted and dropped.
 */
export function createLlamaCppStudent(
  server: LlamaServerAccess,
  deps: StudentDeps = {},
): StudentAdapter {
  function chatBody(request: StudentChatRequest, lora: LoraScale[]): Record<string, unknown> {
    const { decoding } = request;
    const body: Record<string, unknown> = {
      model: server.model,
      messages: toWireMessages(request.messages, { systemRole: 'system', toolNames: true }),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: decoding.maxOutputTokens,
      temperature: decoding.temperature,
      top_p: decoding.topP,
      seed: request.seed,
      // Every adapter, each at this student's scale: llama-server sets the ones left out to 0.
      lora,
    };
    if (decoding.topK > 0) body['top_k'] = decoding.topK;
    if (request.tools.length > 0) body['tools'] = toWireTools(request.tools);
    // Glimmer's template reads its reasoning strength from a template variable.
    if (readsReasoningStrengthLine(server.model)) {
      body['chat_template_kwargs'] = { reasoning_strength: decoding.thinking };
    }
    return body;
  }

  async function* chat(
    request: StudentChatRequest,
    signal?: AbortSignal,
  ): AsyncGenerator<StudentStreamEvent> {
    const started = performance.now();
    // Starts the server if it isn't running, which can take as long as loading the model.
    const lease = await server.acquire(signal);
    try {
      const http = createHttpClient({
        baseUrl: `${lease.url}/v1`,
        service: LLAMACPP_SERVICE,
        headers: { authorization: `Bearer ${lease.apiKey}` },
        secrets: [lease.apiKey],
        fetch: deps.fetch,
        retry: deps.retry,
        timeouts: deps.timeouts,
      });
      const body = chatBody(request, lease.lora);
      const stream = await http.withRetries(
        () =>
          http.openStream('/chat/completions', body, {
            signal,
            model: server.model,
            accept: 'text/event-stream',
          }),
        signal,
      );
      try {
        const firstCallNumber = countToolCalls(request.messages) + 1;
        const events = readChatCompletionStream(stream, {
          service: LLAMACPP_SERVICE,
          firstCallNumber,
        });
        for await (const event of events) {
          if (event.type === 'text') {
            yield event;
            continue;
          }
          for (const call of event.toolCalls) yield { type: 'tool_call', call };
          yield { type: 'done', usage: event.usage ?? emptyUsage(), finish: event.finish };
        }
      } finally {
        stream.close();
      }
      // In quiet mode the GPU rests for a share of the time the reply took.
      if (deps.cooldown) {
        await (deps.rest ?? rest)((performance.now() - started) * deps.cooldown, signal);
      }
    } finally {
      lease.release();
    }
  }

  return {
    label: deps.label ?? LLAMACPP_SERVICE,
    model: server.model,
    baseUrl: server.baseUrl,
    isLocal: isLoopbackUrl(server.baseUrl),
    chat,
    describe: () => server.describe(),
    testConnection: () => server.check(),
    // Stopping the server is what frees the GPU, as keep_alive 0 does for Ollama.
    release: () => server.stop(),
  };
}
