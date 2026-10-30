import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';

/** OpenRouter's PKCE flow for apps on the user's computer: https://openrouter.ai/docs/use-cases/oauth-pkce */
export const OPENROUTER_AUTH_URL = 'https://openrouter.ai/auth';
export const OPENROUTER_EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

const CALLBACK_PATH = '/callback';
/** Codes expire ten minutes after they are issued, so waiting longer gains nothing. */
const SIGN_IN_TIMEOUT_MS = 10 * 60_000;
const EXCHANGE_TIMEOUT_MS = 30_000;

export interface Pkce {
  verifier: string;
  challenge: string;
}

/** A PKCE pair (RFC 7636): 32 random bytes as the verifier, its SHA-256 as the S256 challenge. */
export function createPkce(random: (size: number) => Buffer = randomBytes): Pkce {
  const verifier = random(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export type SignInFailure = 'cancelled' | 'timeout' | 'denied' | 'port' | 'browser' | 'exchange';

/** Why a sign-in ended without a key, in words for the person signing in. */
export class SignInError extends Error {
  readonly reason: SignInFailure;

  constructor(reason: SignInFailure, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SignInError';
    this.reason = reason;
  }
}

export interface OpenRouterSignInOptions {
  /** Opens the sign-in page in the system browser, through main's one route to it. */
  openBrowser(url: string): Promise<void>;
  /** Cancels the sign-in, such as when the person presses Cancel. */
  signal?: AbortSignal;
  /** How long to wait for the browser to come back. Default ten minutes. */
  timeoutMs?: number;
  /** The loopback port to listen on: any free one by default. A busy one falls back to a free one. */
  port?: number;
  authorizeUrl?: string;
  exchangeUrl?: string;
  fetch?: typeof fetch;
  /** Random bytes, replaceable so tests can pin the PKCE values and the state. */
  random?: (size: number) => Buffer;
}

const KeyReplyWire = z.object({ key: z.string().min(1) });

interface Callback {
  code: string;
  /** Answers the browser tab that brought the code, and resolves once the page is sent. */
  respond(page: Page): Promise<void>;
}

interface Page {
  status: number;
  title: string;
  body: string;
}

const SIGNED_IN: Page = {
  status: 200,
  title: 'Signed in to OpenRouter',
  body: 'You can close this tab and go back to Architect.',
};
const NOT_FINISHED: Page = {
  status: 502,
  title: "The sign-in didn't finish",
  body: 'Go back to Architect to see why and try again.',
};
const DENIED: Page = {
  status: 200,
  title: 'Sign-in cancelled',
  body: 'No key was made. You can close this tab.',
};
const WRONG_SIGN_IN: Page = {
  status: 400,
  title: 'This sign-in link is not the one Architect is waiting for',
  body: 'Start the sign-in again from Architect.',
};

function escape(text: string): string {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A small page for the browser tab, with nothing it could load and no referrer to leak the code. */
function send(response: ServerResponse, page: Page): Promise<void> {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(page.title)}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070707;color:#f4f4f2;font:15px/1.5 system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}h1{font-size:20px;font-weight:500;margin:0 0 8px}p{margin:0}</style></head><body><main><h1>${escape(page.title)}</h1><p>${escape(page.body)}</p></main></body></html>`;
  return new Promise((resolve) => {
    response.once('close', () => resolve());
    response.writeHead(page.status, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    response.end(html, () => resolve());
  });
}

function listenOn(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}

function addressInUse(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
}

/** A server on 127.0.0.1 only. A busy port falls back to one the system picks. */
async function listen(port: number): Promise<Server> {
  try {
    return await listenOn(port);
  } catch (error) {
    if (port !== 0 && addressInUse(error)) {
      return listenOn(0).catch((cause: unknown) => {
        throw portFailure(cause);
      });
    }
    throw portFailure(error);
  }
}

function portFailure(cause: unknown): SignInError {
  return new SignInError(
    'port',
    "Architect couldn't open a port on this computer to receive the sign-in. Try again.",
    { cause },
  );
}

/**
 * Waits for the browser to come back to the callback with a code and this sign-in's state. A
 * request with another state is answered and ignored, so a stray or forged link can't end the
 * sign-in or slip its own code in; a return with no code means the person said no.
 */
function waitForCallback(
  server: Server,
  state: string,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Callback> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(
          new SignInError(
            'timeout',
            'The sign-in timed out before the browser came back. Try again.',
          ),
        ),
      timeoutMs,
    );
    const onAbort = () => fail(new SignInError('cancelled', 'The sign-in was cancelled.'));

    function stop(): void {
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }

    function fail(error: SignInError): void {
      if (settled) return;
      stop();
      reject(error);
    }

    server.on('request', (request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== CALLBACK_PATH) {
        response.writeHead(404).end();
        return;
      }
      if (settled) {
        void send(response, WRONG_SIGN_IN);
        return;
      }
      const code = url.searchParams.get('code');
      const returned = url.searchParams.get('state');
      if (code === null || code === '') {
        void send(response, DENIED);
        fail(new SignInError('denied', "OpenRouter didn't grant access, so no key was made."));
        return;
      }
      if (returned !== state) {
        void send(response, WRONG_SIGN_IN);
        return;
      }
      stop();
      resolve({ code, respond: (page) => send(response, page) });
    });

    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function exchange(
  code: string,
  verifier: string,
  url: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
): Promise<string> {
  const timeout = AbortSignal.timeout(EXCHANGE_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (cause) {
    if (signal?.aborted) throw new SignInError('cancelled', 'The sign-in was cancelled.');
    throw new SignInError(
      'exchange',
      "Couldn't reach OpenRouter to finish signing in. Check your connection and try again.",
      { cause },
    );
  }
  if (!response.ok) {
    const why =
      response.status === 403
        ? 'OpenRouter refused the sign-in code; codes expire after ten minutes.'
        : `OpenRouter couldn't finish the sign-in (HTTP ${response.status}).`;
    throw new SignInError('exchange', `${why} Try signing in again.`);
  }
  const reply = KeyReplyWire.safeParse(await response.json().catch(() => null));
  if (!reply.success) {
    throw new SignInError('exchange', 'OpenRouter answered without a key. Try signing in again.');
  }
  return reply.data.key;
}

/**
 * Signs in with OpenRouter and resolves with the API key it issues. A one-shot server on
 * 127.0.0.1 waits for the browser to come back with a code, which is exchanged together with the
 * PKCE verifier that never left this process. Cancel, a timeout, a refusal in the browser, a port
 * that can't be opened and a failed exchange each end it with a `SignInError` saying which.
 */
export async function signInWithOpenRouter(options: OpenRouterSignInOptions): Promise<string> {
  const random = options.random ?? randomBytes;
  const pkce = createPkce(random);
  const state = random(16).toString('base64url');
  const server = await listen(options.port ?? 0);
  // Ends the wait however the sign-in ends, so no timer outlives it.
  const done = new AbortController();
  try {
    const { port } = server.address() as AddressInfo;
    const authorize = new URL(options.authorizeUrl ?? OPENROUTER_AUTH_URL);
    authorize.searchParams.set('callback_url', `http://127.0.0.1:${port}${CALLBACK_PATH}`);
    authorize.searchParams.set('code_challenge', pkce.challenge);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.searchParams.set('state', state);
    authorize.searchParams.set('key_label', 'Architect');

    const callback = waitForCallback(
      server,
      state,
      options.signal ? AbortSignal.any([options.signal, done.signal]) : done.signal,
      options.timeoutMs ?? SIGN_IN_TIMEOUT_MS,
    );
    // Whatever happens next, a rejection here is either awaited below or already moot.
    callback.catch(() => undefined);
    try {
      await options.openBrowser(authorize.toString());
    } catch (cause) {
      throw new SignInError('browser', "Architect couldn't open your browser to sign in.", {
        cause,
      });
    }

    const { code, respond } = await callback;
    let key: string;
    try {
      key = await exchange(
        code,
        pkce.verifier,
        options.exchangeUrl ?? OPENROUTER_EXCHANGE_URL,
        options.fetch ?? fetch,
        options.signal,
      );
    } catch (error) {
      await respond(NOT_FINISHED);
      throw error;
    }
    await respond(SIGNED_IN);
    return key;
  } finally {
    done.abort();
    server.closeAllConnections();
    server.close();
  }
}
