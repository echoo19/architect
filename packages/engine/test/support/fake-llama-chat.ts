import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { pieces, type ScriptedTurn } from '../agent-host/fake-ollama';

export interface LlamaChatBody {
  model: string;
  messages: { role: string; content?: string | null; tool_call_id?: string; name?: string }[];
  tools?: { function: { name: string } }[];
  lora?: { id: number; scale: number }[];
  seed?: number;
  stream: boolean;
}

export interface FakeLlamaChat {
  readonly url: string;
  /** The key the server was started with; a request without it is refused. */
  readonly key: string;
  /** The chat requests that got past the key check, one per model turn. */
  chats(): LlamaChatBody[];
  close(): Promise<void>;
}

/**
 * A stand-in for llama-server's chat endpoint on 127.0.0.1, streaming the way it does with
 * `--jinja`: reasoning as `reasoning_content`, then the text, then each tool call in fragments
 * under the id the server gave it, then the usage. It plays the fake Ollama's scripted turns in
 * order, with the same token counts, and without their pauses.
 */
export async function startFakeLlamaChat(
  script: readonly ScriptedTurn[],
  key = 'fake-llama-key',
): Promise<FakeLlamaChat> {
  const chats: LlamaChatBody[] = [];
  let turn = 0;

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    });
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const text = await readBody(request);
    if (request.headers.authorization !== `Bearer ${key}`) {
      sendError(response, 401, 'Invalid API Key', 'authentication_error');
      return;
    }
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
      sendError(response, 404, 'File Not Found', 'not_found_error');
      return;
    }
    const body = JSON.parse(text) as LlamaChatBody;
    chats.push(body);
    const scripted = script[turn++];
    if (!scripted) {
      sendError(response, 500, `the script has no turn ${turn}`, 'server_error');
      return;
    }
    if (scripted.status !== undefined) {
      sendError(response, scripted.status, scripted.error ?? 'scripted failure', 'server_error');
      return;
    }
    stream(response, scripted, turn);
  }

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    key,
    chats: () => [...chats],
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

function stream(response: ServerResponse, turn: ScriptedTurn, number: number): void {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (value: object) => response.write(`data: ${JSON.stringify(value)}\n\n`);
  const delta = (value: object, finish: string | null = null) =>
    event({ choices: [{ index: 0, delta: value, finish_reason: finish }] });
  const size = turn.chunk ?? 8;

  for (const piece of pieces(turn.thinking ?? '', size)) delta({ reasoning_content: piece });
  for (const piece of pieces(turn.text ?? '', size)) delta({ content: piece });
  const calls = turn.toolCalls ?? [];
  calls.forEach((call, index) => {
    const args =
      typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments);
    const id = `fake_${number}_${index}`;
    delta({
      tool_calls: [{ index, id, type: 'function', function: { name: call.name, arguments: '' } }],
    });
    for (const piece of pieces(args, size)) {
      delta({ tool_calls: [{ index, function: { arguments: piece } }] });
    }
  });
  delta({}, calls.length > 0 ? 'tool_calls' : 'stop');
  event({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 30 } });
  response.end('data: [DONE]\n\n');
}

function sendError(response: ServerResponse, status: number, message: string, type: string): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: { code: status, message, type } }));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}
