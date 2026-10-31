import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createPkce,
  signInWithOpenRouter,
  SignInError,
  type OpenRouterSignInOptions,
} from '../../../src/main/oauth/openrouter';
import { SignIns } from '../../../src/main/oauth/sign-ins';
import { sendJson } from './http';

/** Servers a test started: the key exchange, and a port held to look busy. */
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

/** RFC 7636, appendix B: these 32 octets give this verifier and this S256 challenge. */
const RFC_OCTETS = [
  116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105,
  214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121,
];

/** Random bytes that are always the same, so the state is known too. */
const pinned = (size: number) => Buffer.from(RFC_OCTETS.slice(0, size));

interface Exchange {
  body: Record<string, unknown>;
}

/** OpenRouter's key exchange, on 127.0.0.1. */
async function exchangeServer(
  answer: (body: Record<string, unknown>) => { status: number; body: unknown },
): Promise<{ url: string; seen: Exchange[] }> {
  const seen: Exchange[] = [];
  const server = createServer((request, response) => {
    const parts: Buffer[] = [];
    request.on('data', (part: Buffer) => parts.push(part));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(parts).toString('utf8')) as Record<string, unknown>;
      seen.push({ body });
      const reply = answer(body);
      sendJson(response, reply.body, reply.status);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/api/v1/auth/keys`, seen };
}

/** A browser that follows the sign-in link and comes back to the callback with this query. */
function browser(query: (state: string) => string, pages: { status: number; text: string }[] = []) {
  const opened: URL[] = [];
  const openBrowser: OpenRouterSignInOptions['openBrowser'] = async (url) => {
    const link = new URL(url);
    opened.push(link);
    const callback = link.searchParams.get('callback_url') ?? '';
    const state = link.searchParams.get('state') ?? '';
    // The person signs in a moment later, after the sign-in page has opened.
    setTimeout(() => {
      void fetch(`${callback}?${query(state)}`).then(async (response) => {
        pages.push({ status: response.status, text: await response.text() });
      });
    }, 10);
  };
  return { opened, openBrowser, pages };
}

async function failure(promise: Promise<unknown>): Promise<SignInError> {
  const error = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(SignInError);
  return error as SignInError;
}

describe('createPkce', () => {
  it('matches the example in RFC 7636', () => {
    expect(createPkce(pinned)).toEqual({
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
      challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    });
  });

  it('makes a fresh 43-character verifier each time', () => {
    const a = createPkce();
    const b = createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.verifier).not.toBe(b.verifier);
    expect(createHash('sha256').update(a.verifier).digest('base64url')).toBe(a.challenge);
  });
});

describe('signInWithOpenRouter', () => {
  it('sends the browser to OpenRouter with a loopback callback and exchanges the code for a key', async () => {
    const exchange = await exchangeServer(() => ({ status: 200, body: { key: 'sk-or-v1-new' } }));
    const tab = browser((state) => `code=the-code&state=${state}`);
    const key = await signInWithOpenRouter({
      openBrowser: tab.openBrowser,
      exchangeUrl: exchange.url,
      random: pinned,
    });

    expect(key).toBe('sk-or-v1-new');
    const link = tab.opened[0];
    expect(link?.origin + (link?.pathname ?? '')).toBe('https://openrouter.ai/auth');
    expect(link?.searchParams.get('callback_url')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    expect(link?.searchParams.get('code_challenge')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
    expect(link?.searchParams.get('code_challenge_method')).toBe('S256');
    expect(link?.searchParams.get('state')).toBe(pinned(16).toString('base64url'));
    expect(link?.searchParams.get('key_label')).toBe('Architect');
    expect(exchange.seen).toEqual([
      {
        body: {
          code: 'the-code',
          code_verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
          code_challenge_method: 'S256',
        },
      },
    ]);
    await vi.waitFor(() => expect(tab.pages[0]?.status).toBe(200));
    expect(tab.pages[0]?.text).toContain('Signed in to OpenRouter');
    expect(tab.pages[0]?.text).not.toContain('sk-or-v1-new');
  });

  it('ignores a callback with another state and keeps waiting for the real one', async () => {
    const exchange = await exchangeServer(() => ({ status: 200, body: { key: 'sk-or-v1-real' } }));
    const pages: { status: number; text: string }[] = [];
    const key = await signInWithOpenRouter({
      exchangeUrl: exchange.url,
      openBrowser: async (url) => {
        const link = new URL(url);
        const callback = link.searchParams.get('callback_url') ?? '';
        const forged = await fetch(`${callback}?code=forged&state=not-the-state`);
        pages.push({ status: forged.status, text: await forged.text() });
        setTimeout(() => {
          void fetch(`${callback}?code=real&state=${link.searchParams.get('state') ?? ''}`);
        }, 10);
      },
    });
    expect(key).toBe('sk-or-v1-real');
    expect(pages[0]?.status).toBe(400);
    expect(exchange.seen.map((entry) => entry.body['code'])).toEqual(['real']);
  });

  it('ends as denied when the browser comes back without a code', async () => {
    const tab = browser(() => 'error=access_denied');
    const error = await failure(signInWithOpenRouter({ openBrowser: tab.openBrowser }));
    expect(error.reason).toBe('denied');
    expect(error.message).toBe("OpenRouter didn't grant access, so no key was made.");
  });

  it('stops when cancelled, and the callback port closes', async () => {
    const controller = new AbortController();
    let callback = '';
    const pending = signInWithOpenRouter({
      signal: controller.signal,
      openBrowser: async (url) => {
        callback = new URL(url).searchParams.get('callback_url') ?? '';
        setTimeout(() => controller.abort(), 10);
      },
    });
    const error = await failure(pending);
    expect(error.reason).toBe('cancelled');
    await expect(fetch(callback)).rejects.toThrow();
  });

  it('times out when the browser never comes back', async () => {
    const error = await failure(
      signInWithOpenRouter({ openBrowser: async () => undefined, timeoutMs: 30 }),
    );
    expect(error.reason).toBe('timeout');
    expect(error.message).toContain('timed out');
  });

  it('falls back to a free port when the one asked for is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    servers.push(blocker);
    const taken = (blocker.address() as AddressInfo).port;
    const exchange = await exchangeServer(() => ({ status: 200, body: { key: 'sk-or-v1-x' } }));
    const tab = browser((state) => `code=c&state=${state}`);
    await signInWithOpenRouter({
      openBrowser: tab.openBrowser,
      exchangeUrl: exchange.url,
      port: taken,
    });
    const port = Number(new URL(tab.opened[0]?.searchParams.get('callback_url') ?? '').port);
    expect(port).not.toBe(taken);
    expect(port).toBeGreaterThan(0);
  });

  it('says the code may have expired when OpenRouter refuses it, and tells the browser', async () => {
    const exchange = await exchangeServer(() => ({
      status: 403,
      body: { error: { message: 'Authorization code expired' } },
    }));
    const tab = browser((state) => `code=old&state=${state}`);
    const error = await failure(
      signInWithOpenRouter({ openBrowser: tab.openBrowser, exchangeUrl: exchange.url }),
    );
    expect(error.reason).toBe('exchange');
    expect(error.message).toBe(
      'OpenRouter refused the sign-in code; codes expire after ten minutes. Try signing in again.',
    );
    await vi.waitFor(() => expect(tab.pages[0]?.status).toBe(502));
  });

  it('refuses an exchange reply without a key', async () => {
    const exchange = await exchangeServer(() => ({ status: 200, body: { user_id: 'u1' } }));
    const tab = browser((state) => `code=c&state=${state}`);
    const error = await failure(
      signInWithOpenRouter({ openBrowser: tab.openBrowser, exchangeUrl: exchange.url }),
    );
    expect(error.reason).toBe('exchange');
  });

  it('says so when the browser cannot be opened, and closes the port', async () => {
    let callback = '';
    const error = await failure(
      signInWithOpenRouter({
        openBrowser: async (url) => {
          callback = new URL(url).searchParams.get('callback_url') ?? '';
          throw new Error('no browser');
        },
      }),
    );
    expect(error.reason).toBe('browser');
    await expect(fetch(callback)).rejects.toThrow();
  });
});

describe('SignIns', () => {
  it('resolves a cancelled sign-in with null, and passes other failures on', async () => {
    const signIns = new SignIns(
      (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new SignInError('cancelled', 'The sign-in was cancelled.')),
          );
        }),
    );
    const pending = signIns.start();
    signIns.cancel();
    expect(await pending).toBeNull();

    const failing = new SignIns(async () => {
      throw new SignInError('exchange', 'No key.');
    });
    await expect(failing.start()).rejects.toThrow('No key.');
  });

  it('replaces a sign-in still waiting when another starts', async () => {
    const signals: AbortSignal[] = [];
    const signIns = new SignIns(
      (signal) =>
        new Promise((resolve, reject) => {
          signals.push(signal);
          if (signals.length === 2) resolve('sk-or-v1-second');
          signal.addEventListener('abort', () =>
            reject(new SignInError('cancelled', 'The sign-in was cancelled.')),
          );
        }),
    );
    const first = signIns.start();
    const second = signIns.start();
    expect(await first).toBeNull();
    expect(await second).toBe('sk-or-v1-second');
  });
});

describe('signing in under a closed network', () => {
  it('checks the network again just before the key exchange, so one switched on meanwhile holds', async () => {
    let on = false;
    const asked: string[] = [];
    const tab = browser((state) => `code=the-code&state=${state}`);
    const promise = signInWithOpenRouter({
      openBrowser: async (url) => {
        // The person turns the closed network on while the sign-in page is open.
        on = true;
        await tab.openBrowser(url);
      },
      exchangeUrl: 'https://openrouter.ai/api/v1/auth/keys',
      fetch: (async (input: string | URL | Request) => {
        asked.push(String(input));
        return new Response('{"key":"sk-or-v1-new"}');
      }) as typeof fetch,
      network: { allowed: () => (on ? ['spark.lab.internal'] : undefined) },
      random: pinned,
    });
    const error = await promise.then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toMatchObject({ code: 'outside_network' });
    expect(asked).toEqual([]);
  });
});
