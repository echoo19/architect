import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../../src/common/ipc';
import { registerSecretsHandlers } from '../../../src/main/handlers/secrets';
import { IpcRouter, type IpcEventLike } from '../../../src/main/ipc/router';
import type { Cipher } from '../../../src/main/secrets/store';
import { SecretStore } from '../../../src/main/secrets/store';

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

describe('SecretStore', () => {
  it('reports every key as missing at first', async () => {
    const store = await SecretStore.open(file, fakeCipher());
    expect(store.status()).toEqual({
      meta: false,
      baseten: false,
      modal: false,
      together: false,
      openrouter: false,
      deepinfra: false,
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

  it('starts empty from a file in the wrong shape, keeping only known refs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await writeFile(file, '["not", "a", "record"]');
    expect((await SecretStore.open(file, fakeCipher())).status().meta).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();

    const cipher = fakeCipher();
    const meta = (await cipher.encrypt('sk-1')).toString('base64');
    await writeFile(file, JSON.stringify({ meta, github: meta }));
    const store = await SecretStore.open(file, cipher);
    expect(await store.get('meta')).toBe('sk-1');
    expect(await store.get('github')).toBeUndefined();
  });
});

type Listener = (event: IpcEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>;

describe('secrets handlers', () => {
  it('answer with which keys are saved, never their values', async () => {
    const listeners = new Map<string, Listener>();
    const router = new IpcRouter({
      ipcMain: { handle: (channel, listener) => listeners.set(channel, listener) },
      isTrustedSender: () => true,
      targets: () => [],
    });
    registerSecretsHandlers(router, await SecretStore.open(file, fakeCipher()));
    const call = async (channel: string, ...args: unknown[]) => {
      const listener = listeners.get(channel);
      if (!listener) throw new Error(`no listener on ${channel}`);
      return listener({ senderFrame: { url: 'file:///app/index.html' } }, ...args);
    };

    expect(await call('secrets:set', 'meta', 'sk-secret')).toEqual({ ok: true, value: undefined });
    const status = await call('secrets:status');
    expect(status).toMatchObject({ ok: true, value: { meta: true } });
    expect(JSON.stringify(status)).not.toContain('sk-secret');

    const unknown = await call('secrets:clear', 'github');
    expect(unknown.ok).toBe(false);
    expect(!unknown.ok && unknown.error.message).toContain('Invalid arguments for secrets.clear');
  });
});
