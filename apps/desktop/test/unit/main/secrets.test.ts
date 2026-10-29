import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSecretsHandlers } from '../../../src/main/handlers/secrets';
import type { Cipher } from '../../../src/main/secrets/store';
import { environmentKeys } from '../../../src/main/secrets/environment';
import { SecretStore } from '../../../src/main/secrets/store';
import { routerHarness } from './router-harness';

/**
 * Stands in for the OS key store: a key version byte, then the text XORed with a byte, so the
 * ciphertext never equals the text. Data from an older key version decrypts as stale.
 */
function fakeCipher(options: { unavailable?: string; version?: number } = {}): Cipher {
  const version = options.version ?? 1;
  const flip = (data: Buffer) => Buffer.from(data.map((byte) => byte ^ 0x5a));
  return {
    unavailableReason: async () => options.unavailable ?? null,
    encrypt: async (value) => Buffer.concat([Buffer.from([version]), flip(Buffer.from(value))]),
    decrypt: async (data) => ({
      value: flip(data.subarray(1)).toString('utf8'),
      stale: data[0] !== version,
    }),
  };
}

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'architect-secrets-'));
  file = join(dir, 'secrets.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('keys from the environment, for development', () => {
  const env = { ARCHITECT_KEYS_FROM_ENV: '1', META_API_TOKEN: ' from-env ' };

  it('are read only by an unpackaged build that asks for them', () => {
    expect(environmentKeys(env, true)).toBeUndefined();
    expect(environmentKeys({ META_API_TOKEN: 'from-env' }, false)).toBeUndefined();
    expect(environmentKeys(env, false)?.('meta')).toBe('from-env');
    expect(environmentKeys(env, false)?.('openai')).toBeUndefined();
  });

  it('count as saved and are read, never written, and a saved key wins', async () => {
    const store = await SecretStore.open(file, fakeCipher(), environmentKeys(env, false));
    expect(store.status()).toMatchObject({ meta: true, openai: false });
    expect(await store.get('meta')).toBe('from-env');
    await store.set('openai', 'sk-saved');
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')) as object)).toEqual(['openai']);
    await store.set('meta', 'saved-meta');
    expect(await store.get('meta')).toBe('saved-meta');
    await store.clear('meta');
    expect(await store.get('meta')).toBe('from-env');
  });
});

describe('SecretStore', () => {
  it('reports every key as missing at first', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    expect(store.status()).toEqual({
      meta: false,
      openai: false,
      anthropic: false,
      gemini: false,
      openrouter: false,
      groq: false,
      together: false,
      deepinfra: false,
      fireworks: false,
      baseten: false,
      modal: false,
      huggingface: false,
    });
    expect(await store.get('meta')).toBeUndefined();
  });

  it('saves a key as base64 ciphertext and reads it back', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    await store.set('meta', '  sk-meta-123  ');
    expect(store.status()).toMatchObject({ meta: true, together: false });
    expect(await store.get('meta')).toBe('sk-meta-123');

    const saved = await readFile(file, 'utf8');
    expect(saved).not.toContain('sk-meta-123');
    const stored = JSON.parse(saved) as Record<string, string>;
    expect(Object.keys(stored)).toEqual(['meta']);
    expect(stored.meta).toMatch(/^[A-Za-z0-9+/]+=*$/);

    const reopened = await SecretStore.open(file, fakeCipher());
    expect(await reopened.get('meta')).toBe('sk-meta-123');
  });

  it('clears a key', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    await store.set('together', 'tg-1');
    await store.set('meta', 'sk-1');
    await store.clear('together');
    expect(store.status()).toMatchObject({ meta: true, together: false });
    expect(Object.keys(JSON.parse(await readFile(file, 'utf8')) as object)).toEqual(['meta']);
  });

  it('refuses to save when the system cannot encrypt, and says why', async () => {
    const store = await SecretStore.open(
      file,
      fakeCipher({ unavailable: 'no keyring is running' }),
    );
    await expect(store.set('meta', 'sk-1')).rejects.toThrow(
      "Architect can't save keys on this computer: no keyring is running.",
    );
    expect(store.status().meta).toBe(false);
  });

  it('refuses unknown refs and empty values', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    await expect(store.set('github', 'x')).rejects.toThrow('Architect has no key called "github".');
    await expect(store.set('meta', '   ')).rejects.toThrow('The Meta Model API key is empty.');
    expect(await store.get('github')).toBeUndefined();
  });

  it('says to enter a key again when it no longer decrypts', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    await store.set('meta', 'sk-1');
    const broken: Cipher = {
      ...fakeCipher(),
      decrypt: async () => {
        throw new Error('bad key');
      },
    };
    const reopened = await SecretStore.open(file, broken);
    await expect(reopened.get('meta')).rejects.toThrow(
      "The saved Meta Model API key can't be decrypted on this computer.",
    );
  });

  it("re-saves a key under the key store's newer key", async () => {
    await (await SecretStore.open(file, fakeCipher({ version: 1 }))).set('meta', 'sk-1');
    const rotated = await SecretStore.open(file, fakeCipher({ version: 2 }));
    expect(await rotated.get('meta')).toBe('sk-1');

    // The new ciphertext is saved in the background; wait for it before the folder goes away.
    await vi.waitFor(async () => {
      const stored = JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
      expect(Buffer.from(stored.meta ?? '', 'base64')[0]).toBe(2);
    });
    const reopened = await SecretStore.open(file, fakeCipher({ version: 2 }));
    expect(await reopened.get('meta')).toBe('sk-1');
  });

  it("keeps an added endpoint's key under its host, lists it, and clears it", async () => {
    const store = await SecretStore.open(file, fakeCipher());
    await store.set('custom:llm.example.com', 'sk-house-1');
    expect(store.status()).toMatchObject({ 'custom:llm.example.com': true, meta: false });
    expect(await store.get('custom:llm.example.com')).toBe('sk-house-1');

    const reopened = await SecretStore.open(file, fakeCipher());
    expect(await reopened.get('custom:llm.example.com')).toBe('sk-house-1');
    await reopened.clear('custom:llm.example.com');
    expect(reopened.status()).not.toHaveProperty('custom:llm.example.com');
    await expect(reopened.set('custom:https://x.example', 'k')).rejects.toThrow(
      'Architect has no key called',
    );
  });

  it('keeps only the refs it knows from the file', async () => {
    const cipher = fakeCipher();
    const meta = (await cipher.encrypt('sk-1')).toString('base64');
    await writeFile(file, JSON.stringify({ meta, github: meta }));
    const store = await SecretStore.open(file, cipher);
    expect(await store.get('meta')).toBe('sk-1');
    expect(await store.get('github')).toBeUndefined();
  });

  for (const [name, content] of [
    ['is not JSON', '{"meta": "c2stMQ==", '],
    ['is in the wrong shape', '["not", "a", "record"]'],
  ] as const) {
    it(`leaves a keys file that ${name} untouched, and says why on every use`, async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      await writeFile(file, content);
      const store = await SecretStore.open(file, fakeCipher());
      expect(warn).toHaveBeenCalledOnce();
      warn.mockRestore();

      const why = `The saved keys in ${file} can't be read`;
      await expect(store.set('meta', 'sk-new')).rejects.toThrow(why);
      await expect(store.clear('meta')).rejects.toThrow(why);
      await expect(store.get('meta')).rejects.toThrow(why);
      expect(() => store.status()).toThrow(why);
      expect(await readFile(file, 'utf8')).toBe(content);
    });
  }

  it('leaves a keys path that fails to read for any other reason untouched', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await mkdir(file);
    const store = await SecretStore.open(file, fakeCipher());
    warn.mockRestore();
    await expect(store.set('meta', 'sk-new')).rejects.toThrow("can't be read");
    expect((await stat(file)).isDirectory()).toBe(true);
  });
});

describe('secrets handlers', () => {
  it('answer with which keys are saved, never their values', async () => {
    const { router, call } = routerHarness();
    registerSecretsHandlers(router, await SecretStore.open(file, fakeCipher()));

    expect(await call('secrets:set', 'meta', 'sk-secret')).toEqual({ ok: true, value: undefined });
    const status = await call('secrets:status');
    expect(status).toMatchObject({ ok: true, value: { meta: true } });
    expect(JSON.stringify(status)).not.toContain('sk-secret');

    const unknown = await call('secrets:clear', 'github');
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error.message).toContain('Invalid arguments for secrets.clear');
  });
});
