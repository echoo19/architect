import type { HttpClient, RequestOptions, StreamHandle } from '../http/client';
import { ChatCompletionWire } from './wire';

/**
 * How long a whole reply may take. Nothing arrives until the model has finished, and a reasoning
 * model writing a long reply can take many minutes.
 */
const UNSTREAMED_TIMEOUT_MS = 900_000;

/**
 * Asks for a reply without streaming and hands it on as a one-event stream, so the stream reader
 * handles it like any other reply: its text, its tool calls, its finish reason and its usage.
 */
export async function openUnstreamed(
  http: HttpClient,
  path: string,
  body: Record<string, unknown>,
  request: Pick<RequestOptions, 'signal' | 'model'>,
): Promise<StreamHandle> {
  const { stream_options: _options, ...rest } = body;
  const reply = await http.postJson(path, { ...rest, stream: false }, ChatCompletionWire, {
    ...request,
    timeoutMs: UNSTREAMED_TIMEOUT_MS,
  });
  const choice = reply.choices?.[0];
  const message = choice?.message;
  const chunk = {
    choices: choice
      ? [
          {
            delta: {
              content: message?.content ?? null,
              reasoning: message?.reasoning ?? null,
              reasoning_content: message?.reasoning_content ?? null,
              tool_calls: message?.tool_calls?.map((call, index) => ({ index, ...call })) ?? null,
            },
            finish_reason: choice.finish_reason ?? null,
          },
        ]
      : [],
    usage: reply.usage ?? null,
  };
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`);
  return {
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
    close: () => {},
  };
}
