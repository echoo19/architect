import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JsonValue } from '@architect/shared';

/** One scripted model turn, streamed the way Ollama's `/api/chat` streams. */
export interface ScriptedTurn {
  /** Reasoning, streamed in pieces before the text, as `thinking`. */
  thinking?: string;
  text?: string;
  /** Arguments given as a string are sent as that string, as a model that garbled them wrote it. */
  toolCalls?: { name: string; arguments: Record<string, JsonValue> | string }[];
  /** Characters per streamed piece of reasoning or text. Default 8. */
  chunk?: number;
  /** A pause before each piece, so a reply can be stopped mid-stream. */
  delayMs?: number;
  /** Answers with this HTTP status and Ollama's error body instead of a stream. */
  status?: number;
  error?: string;
}

export interface OllamaChatBody {
  model: string;
  messages: { role: string; content: string; tool_name?: string }[];
  tools?: { function: { name: string } }[];
  options: { seed: number; num_ctx: number };
  stream: boolean;
}

export interface FakeOllama {
  readonly url: string;
  /** Every request in the order it arrived. */
  readonly requests: { path: string; body: unknown }[];
  /** The streamed chat requests: one per model turn. */
  chats(): OllamaChatBody[];
  close(): Promise<void>;
}

const MODEL = 'muse-glimmer:30b';

export interface FakeOllamaOptions {
  /** Called as each streamed chat request arrives, before it is answered. */
  onChat?(): void;
  /** Called as each request to unload a model arrives, before it is answered. */
  onUnload?(model: string): void;
}

/**
 * A stand-in for Ollama on 127.0.0.1 that plays scripted turns in order, one per streamed
 * `/api/chat` request, answers `/api/show` like a model with tools and thinking, lists that one
 * model in `/api/tags`, and answers `/api/ps` with nothing loaded.
 */
export async function startFakeOllama(
  script: readonly ScriptedTurn[],
  options: FakeOllamaOptions = {},
): Promise<FakeOllama> {
  const requests: { path: string; body: unknown }[] = [];
  let turn = 0;

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = request.url ?? '';
    const body: unknown = JSON.parse((await readBody(request)) || '{}');
    requests.push({ path, body });
    if (path === '/api/tags') {
      sendJson(response, 200, {
        models: [{ name: MODEL, model: MODEL, size: 1024, digest: 'sha256:glimmer' }],
      });
      return;
    }
    // What the adapter runtime asks before llama-server starts: nothing is loaded here.
    if (path === '/api/ps') {
      sendJson(response, 200, { models: [] });
      return;
    }
    if (path === '/api/show') {
      sendJson(response, 200, {
        capabilities: ['completion', 'tools', 'thinking'],
        details: { quantization_level: 'Q4_K_M' },
        model_info: {},
      });
      return;
    }
    if (path !== '/api/chat') {
      sendJson(response, 404, { error: `${path} not found` });
      return;
    }
    if (!isStreamed(body)) {
      // A chat not streamed, with no messages and a keep-alive of 0, asks Ollama to unload a model.
      const { model } = body as { model?: unknown };
      options.onUnload?.(typeof model === 'string' ? model : '');
      sendJson(response, 200, { model: MODEL, done: true });
      return;
    }
    options.onChat?.();
    const scripted = script[turn++];
    if (!scripted) {
      sendJson(response, 500, { error: `the script has no turn ${turn}` });
      return;
    }
    if (scripted.status !== undefined) {
      sendJson(response, scripted.status, { error: scripted.error ?? 'scripted failure' });
      return;
    }
    await stream(response, scripted);
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    chats: () =>
      requests
        .filter((request) => request.path === '/api/chat' && isStreamed(request.body))
        .map((request) => request.body as OllamaChatBody),
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function stream(response: ServerResponse, turn: ScriptedTurn): Promise<void> {
  response.writeHead(200, { 'content-type': 'application/x-ndjson' });
  let open = true;
  response.on('close', () => {
    open = false;
  });
  const line = (value: object) => response.write(`${JSON.stringify({ model: MODEL, ...value })}\n`);
  const text = turn.text ?? '';
  const size = turn.chunk ?? 8;
  for (const piece of pieces(turn.thinking ?? '', size)) {
    line({ message: { role: 'assistant', content: '', thinking: piece }, done: false });
  }
  for (let at = 0; at < text.length; at += size) {
    if (turn.delayMs) await new Promise((resolve) => setTimeout(resolve, turn.delayMs));
    if (!open) return;
    line({ message: { role: 'assistant', content: text.slice(at, at + size) }, done: false });
  }
  if (turn.toolCalls?.length) {
    line({
      message: {
        role: 'assistant',
        content: '',
        tool_calls: turn.toolCalls.map((call) => ({
          function: { name: call.name, arguments: call.arguments },
        })),
      },
      done: false,
    });
  }
  line({
    message: { role: 'assistant', content: '' },
    done: true,
    done_reason: 'stop',
    prompt_eval_count: 120,
    eval_count: 30,
  });
  response.end();
}

/** `text` cut into pieces of `size` characters. */
export function pieces(text: string, size: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

function isStreamed(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'stream' in body && body.stream === true;
}

function sendJson(response: ServerResponse, status: number, value: object): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
