import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  createServer,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ChatCompletionRequestSchema,
  newId,
  type CliOutcome,
  type WorkspaceMessage,
} from '@architect/shared';
import { agentSlug } from '../agents';
import { countOption, stringOption, type Parsed, type Values } from '../args';
import type { CliContext } from '../context';
import { CliError, failureOf } from '../exit';
import { line } from '../render';
import {
  completionOf,
  conversationOf,
  errorResponse,
  type Conversation,
  type Response,
  type ServedVersion,
} from '../serve/completions';
import { ask, openSession, type AgentSession } from '../run/session';

/** The only address the server listens on: this computer's loopback. */
export const SERVE_HOST = '127.0.0.1';
const DEFAULT_PORT = 8420;
const MAX_BODY_BYTES = 1024 * 1024;
const MIN_TOKEN_CHARS = 16;

function portOption(values: Values): number {
  const text = stringOption(values, 'port');
  if (text === undefined) return DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new CliError('invalid_input', 'usage', `--port takes 0 to 65535, not "${text}".`);
  }
  return port;
}

async function readToken(path: string): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new CliError(
      'invalid_input',
      'token_unreadable',
      `${path} can't be read: ${(error as NodeJS.ErrnoException).code ?? String(error)}.`,
    );
  }
  const token = text.trim();
  if (token.length < MIN_TOKEN_CHARS || /\s/.test(token)) {
    throw new CliError(
      'invalid_input',
      'weak_token',
      `The token in ${path} must be one word of at least ${MIN_TOKEN_CHARS} characters.`,
    );
  }
  return token;
}

const digest = (text: string) => createHash('sha256').update(text).digest();

/** Whether the request carries the token, compared in constant time. */
function authorized(header: string | undefined, token: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '');
  return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), digest(token));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of req) {
    const chunk = Buffer.from(part as Uint8Array);
    size += chunk.byteLength;
    if (size > MAX_BODY_BYTES) {
      throw new CliError('invalid_input', 'too_large', 'The request is larger than 1 MB.');
    }
    parts.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } catch (error) {
    throw new CliError(
      'invalid_input',
      'invalid_json',
      `The request isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function send(res: ServerResponse, response: Response, headers: OutgoingHttpHeaders = {}): void {
  const text = JSON.stringify(response.body);
  res.writeHead(response.status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    ...headers,
  });
  res.end(text);
}

/** A request refused before the agent runs, with its own status. */
function refused(
  status: number,
  outcome: 'invalid_input' | 'not_permitted',
  code: string,
  message: string,
): Response {
  return { ...errorResponse({ outcome, code, message }), status };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const refuse = (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        reject(
          new CliError(
            'runtime_error',
            'port_in_use',
            `Port ${port} on ${SERVE_HOST} is already in use.`,
            'Choose another with --port.',
          ),
        );
      } else if (error.code === 'EACCES') {
        reject(
          new CliError(
            'not_permitted',
            'port_denied',
            `This account may not listen on port ${port}.`,
            'Choose another with --port.',
          ),
        );
      } else {
        reject(error);
      }
    };
    server.once('error', refuse);
    server.listen(port, SERVE_HOST, () => {
      server.off('error', refuse);
      resolve((server.address() as AddressInfo).port);
    });
  });
}

/**
 * Answers requests for one agent: each in a chat of its own on the session's agent host, one at a
 * time and in the order they came, since they share one local model.
 */
class Endpoint {
  private readonly stopping = new AbortController();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly handling = new Set<Promise<void>>();
  private readonly versions = new Map<number, ServedVersion>();
  readonly model: string;

  constructor(
    private readonly ctx: CliContext,
    private readonly session: AgentSession,
    private readonly token: string,
    private readonly pinned: number | undefined,
  ) {
    this.model = agentSlug(session.agent);
  }

  readonly listener = (req: IncomingMessage, res: ServerResponse): void => {
    const startedAt = Date.now();
    const handled = this.handle(req, res)
      .catch((error: unknown) => {
        if (res.headersSent) {
          res.destroy();
          line(this.ctx.io.stderr, `A response broke off: ${failureOf(error).message}`);
          return;
        }
        send(res, errorResponse(failureOf(error)));
      })
      .finally(() => {
        this.handling.delete(handled);
        const path = (req.url ?? '/').split('?')[0] ?? '/';
        const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
        line(this.ctx.io.stderr, `  ${req.method ?? '?'} ${path} ${res.statusCode} (${seconds} s)`);
      });
    this.handling.add(handled);
  };

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!authorized(req.headers.authorization, this.token)) {
      send(
        res,
        refused(
          401,
          'not_permitted',
          'unauthorized',
          'Send the token as "Authorization: Bearer <token>".',
        ),
        { 'www-authenticate': 'Bearer' },
      );
      return;
    }
    const path = new URL(req.url ?? '/', `http://${SERVE_HOST}`).pathname.replace(/\/+$/, '');
    const routes: Record<string, { method: string; answer: () => Promise<Response> }> = {
      '/v1/models': { method: 'GET', answer: async () => this.models() },
      '/v1/chat/completions': { method: 'POST', answer: () => this.complete(req, res) },
    };
    const route = routes[path];
    if (route === undefined) {
      send(res, refused(404, 'invalid_input', 'not_found', `There is nothing at ${path}.`));
      return;
    }
    if (req.method !== route.method) {
      send(
        res,
        refused(405, 'invalid_input', 'method_not_allowed', `${path} takes ${route.method}.`),
        { allow: route.method },
      );
      return;
    }
    send(res, await route.answer());
  }

  private models(): Response {
    const created = Math.floor(Date.parse(this.session.version.createdAt) / 1000);
    return {
      status: 200,
      body: {
        object: 'list',
        data: [{ id: this.model, object: 'model', created, owned_by: 'architect' }],
      },
    };
  }

  private async complete(req: IncomingMessage, res: ServerResponse): Promise<Response> {
    const parsed = ChatCompletionRequestSchema.safeParse(await readJson(req));
    if (!parsed.success) {
      return refused(
        400,
        'invalid_input',
        'invalid_request',
        `The request isn't a chat completion request: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.') || 'it'} ${issue.message}`)
          .join('; ')}.`,
      );
    }
    const request = parsed.data;
    if (request.stream === true) {
      return refused(
        400,
        'invalid_input',
        'stream_unsupported',
        'Streaming isn’t served yet; leave out "stream".',
      );
    }
    if (request.model !== this.model && request.model !== this.session.agent.id) {
      return refused(
        404,
        'invalid_input',
        'model_not_found',
        `This server serves "${this.model}", not "${request.model}".`,
      );
    }
    const conversation = conversationOf(request);
    // A client that goes away stops its reply, wherever it is.
    const gone = new AbortController();
    res.once('close', () => {
      if (!res.writableFinished) gone.abort(new Error('The client went away.'));
    });
    const signal = AbortSignal.any([this.stopping.signal, gone.signal]);
    const turn = this.queue.then(() => this.answer(conversation, signal));
    // The next request waits for this one to end, however it ends; this one's caller hears how.
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  private async answer(conversation: Conversation, signal: AbortSignal): Promise<Response> {
    if (signal.aborted) {
      return errorResponse({
        outcome: 'cancelled',
        code: 'cancelled',
        message: 'Stopped before it started.',
      });
    }
    const { host, store, agent } = this.session;
    const library = this.ctx.library().library;
    if (this.pinned !== undefined) {
      const active = library.versions(agent.id).find((version) => version.active);
      if (active?.version !== this.pinned) {
        return refused(
          409,
          'not_permitted',
          'version_mismatch',
          `${agent.name}'s active version is now ${active?.version ?? 'none'}, and this server serves version ${this.pinned} only.`,
        );
      }
    }
    const chat = await host.createChat(agent.id);
    try {
      const at = new Date().toISOString();
      for (const turn of conversation.history) {
        const earlier: WorkspaceMessage = {
          id: newId('msg'),
          chatId: chat.id,
          role: turn.role,
          createdAt: at,
          text: turn.text,
          steps: [],
          blocks: [],
          status: 'done',
        };
        store.appendMessage(earlier);
      }
      const reply = await ask({ ...this.session, chat }, conversation.request, {
        approvals: 'fail',
        signal,
      });
      const served = await this.served(
        reply.message.graduateVersion ?? this.session.version.version,
      );
      return completionOf(reply, served, this.model);
    } finally {
      store.forget(chat.id);
    }
  }

  /** A version by its number and harness, and how many attempts its certificate needs to agree. */
  private async served(number: number): Promise<ServedVersion> {
    const known = this.versions.get(number);
    if (known) return known;
    const { library } = this.ctx.library();
    const { agent } = this.session;
    const version = library.versions(agent.id).find((listed) => listed.version === number);
    if (!version) throw new Error(`Version ${number} of ${agent.name} isn't on this computer.`);
    let required: number | null = null;
    if (version.manifest.evidence.files?.report !== undefined) {
      const { certificate } = await library.report(agent.id, number);
      // As the agent host follows it: an issued certificate with more than one attempt.
      if (certificate?.issued === true && certificate.k >= 2)
        required = certificate.threshold.votes;
    }
    const served = { version: number, harnessHash: version.manifest.harness.hash, required };
    this.versions.set(number, served);
    return served;
  }

  /** Stops taking requests, stops the replies running, answers what is waiting, and closes. */
  async shutdown(server: Server): Promise<void> {
    const closed = new Promise<void>((resolve) => server.close(() => resolve()));
    this.stopping.abort(new Error('The server is stopping.'));
    await Promise.allSettled([...this.handling]);
    server.closeAllConnections();
    await closed;
  }
}

function untilAborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

/**
 * `architect serve <agent>`: the agent as an OpenAI-compatible chat completions endpoint on
 * 127.0.0.1, for other apps on this computer, through the same agent host as `run` and the
 * workspace, under the same network guard. Callers need the bearer token it prints at the start
 * (or the one in --token-file). It never applies a change to a file: a change comes back as a
 * proposal, for a person to make in the app. Ctrl+C stops it.
 */
export async function serve(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  if (stringOption(values, 'host') !== undefined) {
    throw new CliError(
      'not_permitted',
      'loopback_only',
      `architect serve listens on ${SERVE_HOST} only, so that only apps on this computer can reach the agent.`,
      'Leave out --host.',
    );
  }
  const port = portOption(values);
  const pinned = countOption(values, 'version');
  const tokenFile = stringOption(values, 'token-file');
  const token =
    tokenFile === undefined
      ? randomBytes(32).toString('base64url')
      : await readToken(ctx.path(tokenFile));
  const session = await openSession(ctx, parsed.args[0] ?? '', { proposeOnly: true });
  try {
    const { agent, version, installation } = session;
    if (pinned !== undefined && pinned !== version.version) {
      throw new CliError(
        'not_permitted',
        'version_mismatch',
        `${agent.name}'s active version is ${version.version}, not ${pinned}.`,
        'Promote that version in the app, or leave out --version.',
      );
    }
    const endpoint = new Endpoint(ctx, session, token, pinned);
    const server = createServer(endpoint.listener);
    const listening = await listen(server, port);
    line(
      io.stderr,
      `Serving ${agent.name}, version ${version.version}, on ${installation.model.model} (${installation.model.runtime}), to apps on this computer only.`,
    );
    line(io.stderr, 'Changes to files come back as proposals; nothing is written. Ctrl+C stops.');
    line(io.stdout, `Base URL: http://${SERVE_HOST}:${listening}/v1`);
    line(io.stdout, `Model:    ${endpoint.model}`);
    if (tokenFile === undefined) line(io.stdout, `Token:    ${token}`);
    await untilAborted(signal);
    line(io.stderr, 'Stopping.');
    await endpoint.shutdown(server);
    return 'cancelled';
  } finally {
    await session.close();
  }
}
