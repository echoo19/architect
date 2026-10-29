import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { JsonValue } from '@architect/shared';

/** Stand-ins for the local models the app talks to, listening on 127.0.0.1 only. */

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return (server.address() as AddressInfo).port;
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString('utf8');
  return text === '' ? {} : JSON.parse(text);
}

function sendJson(response: ServerResponse, value: object): void {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

/**
 * A student on 127.0.0.1 that streams the same empty answer to every request, so a run can go
 * end to end without a model.
 */
export async function startFakeStudent(): Promise<{ baseUrl: string; server: Server }> {
  const chunks = [
    { choices: [{ index: 0, delta: { content: 'ANSWER: {}' }, finish_reason: null }] },
    {
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 3 },
    },
  ];
  const server = createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      response.end('data: [DONE]\n\n');
    });
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}/v1`, server };
}

/** What Ollama says when a model's tool call can't be parsed, as it arrives in the middle of a reply. */
const UNREADABLE_CALL = 'parse Glimmer call to run: missing ATEM function_calls wrapper';

/** What a fake Ollama does with one chat request. */
export type OllamaTurn =
  | { text: string }
  | { toolCall: { name: string; arguments: Record<string, JsonValue> } }
  /**
   * Streams this text in pieces, `pieceMs` apart, and then the error Ollama gives for a tool call
   * it can't parse: the reply showed text and then cannot be used.
   */
  | { unreadableAfter: string; pieceMs?: number }
  /** Sends the caller on to this same server under another name for this computer. */
  | { redirectToHost: string };

export interface ChatRequestMessage {
  role: string;
  content: string;
  tool_name?: string;
}

export interface FakeOllama {
  baseUrl: string;
  port: number;
  /** The messages of each chat request, in the order the requests came. */
  chats: ChatRequestMessage[][];
  /** The options of each chat request (its context, seed, thread cap), in the same order. */
  options: Record<string, unknown>[];
  /** The host each chat request was addressed to, in the same order. */
  hosts: string[];
  /** How often it was asked which models it holds, as llama-server's start asks first. */
  loadedAsked(): number;
  close(): Promise<void>;
}

/** A model a fake Ollama lists as downloaded. */
export interface FakeOllamaModel {
  name: string;
  sizeBytes: number;
  digest: string;
}

/**
 * An Ollama that answers its chat requests with the given turns, one each, in order. The last
 * turn answers every request after it, as a server stuck on one answer would. Given `models`,
 * it lists them as downloaded, so a model check can describe one.
 */
export async function startFakeOllama(
  script: readonly OllamaTurn[],
  options: { models?: readonly FakeOllamaModel[] } = {},
): Promise<FakeOllama> {
  const chats: ChatRequestMessage[][] = [];
  const chatOptions: Record<string, unknown>[] = [];
  const hosts: string[] = [];
  let port = 0;
  let loadedAsked = 0;

  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = (await readBody(request)) as {
      messages?: ChatRequestMessage[];
      options?: Record<string, unknown>;
    };
    if (request.url === '/api/ps') {
      loadedAsked += 1;
      sendJson(response, { models: [] });
      return;
    }
    if (options.models && request.url === '/api/tags') {
      sendJson(response, {
        models: options.models.map((model) => ({
          name: model.name,
          size: model.sizeBytes,
          digest: model.digest,
        })),
      });
      return;
    }
    if (options.models && request.url === '/api/version') {
      sendJson(response, { version: '0.40.9' });
      return;
    }
    if (request.url === '/api/show') {
      sendJson(response, { capabilities: ['completion', 'tools', 'thinking'] });
      return;
    }
    if (request.url !== '/api/chat') {
      response.writeHead(404).end();
      return;
    }
    chats.push(body.messages ?? []);
    chatOptions.push(body.options ?? {});
    hosts.push(request.headers.host ?? '');
    const turn = script[Math.min(chats.length, script.length) - 1];
    if (!turn) {
      response.writeHead(500).end();
    } else if ('redirectToHost' in turn) {
      const location = `http://${turn.redirectToHost}:${port}/api/chat`;
      response.writeHead(307, { location }).end();
    } else if ('unreadableAfter' in turn) {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      for (let at = 0; at < turn.unreadableAfter.length; at += 8) {
        if (turn.pieceMs) await new Promise((resolve) => setTimeout(resolve, turn.pieceMs));
        const content = turn.unreadableAfter.slice(at, at + 8);
        response.write(
          `${JSON.stringify({ message: { role: 'assistant', content }, done: false })}\n`,
        );
      }
      response.end(`${JSON.stringify({ error: UNREADABLE_CALL })}\n`);
    } else {
      const message =
        'text' in turn
          ? { role: 'assistant', content: turn.text }
          : { role: 'assistant', content: '', tool_calls: [{ function: turn.toolCall }] };
      const done = { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' };
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.write(`${JSON.stringify({ message, done: false })}\n`);
      response.end(`${JSON.stringify({ ...done, prompt_eval_count: 12, eval_count: 3 })}\n`);
    }
  }

  const server = createServer((request, response) => {
    answer(request, response).catch(() => response.destroy());
  });
  port = await listen(server);
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    port,
    chats,
    options: chatOptions,
    hosts,
    loadedAsked: () => loadedAsked,
    close: () => close(server),
  };
}

/** What a chat request to a mentor on this computer holds, as far as a test looks at it. */
export interface MentorChatBody {
  model: string;
  messages: { role: string; content: string }[];
  response_format?: { json_schema?: { name?: string } };
}

export interface ScriptedMentor {
  /** Where the mentor's Chat Completions answer, with `/v1`. */
  baseUrl: string;
  /** Every chat request it was sent, in the order they came. */
  requests: MentorChatBody[];
  close(): Promise<void>;
}

/**
 * A mentor on 127.0.0.1 that answers each chat request with the JSON object a script gives for
 * it, streamed the way a model API streams. The script sees the request and its number, starting
 * at 1, so a test can ask a question first and draft next.
 */
export async function startScriptedMentor(
  script: (request: MentorChatBody, call: number) => unknown,
): Promise<ScriptedMentor> {
  const requests: MentorChatBody[] = [];
  async function answer(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
      response.writeHead(404).end();
      return;
    }
    const body = (await readBody(request)) as MentorChatBody;
    requests.push(body);
    const content = JSON.stringify(script(body, requests.length));
    const chunks = [
      { choices: [{ index: 0, delta: { content }, finish_reason: null }] },
      {
        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
        usage: { prompt_tokens: 2000, completion_tokens: 500 },
      },
    ];
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const chunk of chunks) response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    response.end('data: [DONE]\n\n');
  }
  const server = createServer((request, response) => {
    answer(request, response).catch(() => response.destroy());
  });
  const port = await listen(server);
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests, close: () => close(server) };
}
