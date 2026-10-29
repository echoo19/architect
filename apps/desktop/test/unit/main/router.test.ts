import { CodedError, GuardError, PackageError } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { IpcResult } from '../../../src/common/ipc';
import { invokeChannels } from '../../../src/common/ipc';
import { IpcRouter, type IpcEventLike, type IpcMainLike } from '../../../src/main/ipc/router';

type Listener = (event: IpcEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>;

const APP_URL = 'file:///app/index.html';

function setup() {
  const listeners = new Map<string, Listener>();
  const ipcMain: IpcMainLike = {
    handle: (channel, listener) => {
      if (listeners.has(channel)) throw new Error(`twice: ${channel}`);
      listeners.set(channel, listener);
    },
  };
  const sent: { channel: string; payload: unknown }[] = [];
  const target = {
    send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
    isDestroyed: () => false,
  };
  const closed = { send: vi.fn(), isDestroyed: () => true };
  const router = new IpcRouter({
    ipcMain,
    isTrustedSender: (url) => url.startsWith(APP_URL),
    targets: () => [target, closed],
  });
  const call = (channel: string, args: unknown[] = [], url = `${APP_URL}#/`) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`no listener on ${channel}`);
    return listener({ senderFrame: { url } }, ...args);
  };
  return { router, listeners, call, sent, closed };
}

describe('IpcRouter', () => {
  it('listens on every channel of the contract from the start', () => {
    const { listeners } = setup();
    expect([...listeners.keys()].sort()).toEqual(invokeChannels().sort());
    expect(listeners.has('settings:update')).toBe(true);
    expect(listeners.has('runs:onEvent')).toBe(false);
  });

  it('answers channels nobody registered with a clear error', async () => {
    const { call } = setup();
    expect(await call('graduates:list')).toEqual({
      ok: false,
      error: {
        message: "The engine isn't connected yet, so graduates.list can't run.",
        code: 'process_starting',
      },
    });
  });

  it('routes to registered handlers and wraps their results', async () => {
    const { router, call } = setup();
    router.registerHandlers('app', {
      info: () => ({ version: '1.0.0', platform: 'linux', dataPath: '/data', totalMemoryBytes: 1 }),
      openProviderPage: vi.fn(),
      openLink: vi.fn(),
    });
    expect(await call('app:info')).toEqual({
      ok: true,
      value: { version: '1.0.0', platform: 'linux', dataPath: '/data', totalMemoryBytes: 1 },
    });
  });

  it('turns a thrown error into a failure the renderer can show', async () => {
    const { router, call } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.registerHandlers('reports', {
      get: () => {
        throw new Error('That run has no report yet.');
      },
      list: () => [],
      comparisons: () => null,
    });
    expect(await call('reports:get', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'That run has no report yet.' },
    });
    expect(errors).toHaveBeenCalledOnce();
    errors.mockRestore();
  });

  it('passes a failure with a code on, and none that has no code', async () => {
    const { router, call } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.registerHandlers('reports', {
      get: () => {
        throw new CodedError('run_not_found', 'There is no run "run_1".');
      },
      list: () => {
        throw new Error('Plain.');
      },
      comparisons: () => null,
    });
    expect(await call('reports:get', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'There is no run "run_1".', code: 'run_not_found' },
    });
    expect(await call('reports:list', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'Plain.' },
    });
    errors.mockRestore();
  });

  it('gives a failure the code of the guard that refused it, when the screens word that guard', async () => {
    const { router, call } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.registerHandlers('reports', {
      get: () => {
        throw new GuardError('split', 'The payload matched 1 locked test task.');
      },
      list: () => {
        throw new GuardError('network', 'Refused.');
      },
      comparisons: () => null,
    });
    expect(await call('reports:get', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'The payload matched 1 locked test task.', code: 'guard_split' },
    });
    expect(await call('reports:list', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'Refused.' },
    });
    errors.mockRestore();
  });

  it('gives a refused package the code a screen words, for the refusals it words', async () => {
    const { router, call } = setup();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    router.registerHandlers('reports', {
      get: () => {
        throw new PackageError('checksum', ['harness/AGENTS.md has a different checksum.']);
      },
      list: () => {
        throw new PackageError('too_large', ['The package is too large.']);
      },
      comparisons: () => null,
    });
    expect(await call('reports:get', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'harness/AGENTS.md has a different checksum.', code: 'package_changed' },
    });
    // The others keep the engine's sentences, with no code.
    expect(await call('reports:list', ['run_1'])).toEqual({
      ok: false,
      error: { message: 'The package is too large.' },
    });
    errors.mockRestore();
  });

  it('validates arguments before the handler runs', async () => {
    const { router, call } = setup();
    const status = vi.fn(() => ({}));
    const set = vi.fn();
    router.registerHandlers(
      'secrets',
      { status, set, clear: vi.fn() },
      { set: z.tuple([z.string().min(1), z.string().min(1)]) },
    );

    const bad = await call('secrets:set', ['meta', 42]);
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error.message).toContain('Invalid arguments for secrets.set');
    expect(set).not.toHaveBeenCalled();

    expect(await call('secrets:set', ['meta', 'value'])).toEqual({ ok: true, value: undefined });
    expect(set).toHaveBeenCalledWith('meta', 'value');
  });

  it('refuses calls from pages that are not the app', async () => {
    const { router, call } = setup();
    const info = vi.fn();
    router.registerHandlers('app', { info, openProviderPage: vi.fn(), openLink: vi.fn() });
    const result = await call('app:info', [], 'https://example.com/');
    expect(result.ok).toBe(false);
    expect(info).not.toHaveBeenCalled();
  });

  it('rejects registering a domain twice', () => {
    const { router } = setup();
    const handlers = { get: vi.fn(), update: vi.fn() };
    router.registerHandlers('settings', handlers);
    expect(() => router.registerHandlers('settings', handlers)).toThrow('already has a handler');
  });

  it('sends events to every open window', () => {
    const { router, sent, closed } = setup();
    const progress = { model: 'muse-glimmer:30b', status: 'pulling', done: false };
    router.emit('ollama', 'onPullProgress', progress);
    expect(sent).toEqual([{ channel: 'ollama:onPullProgress', payload: progress }]);
    expect(closed.send).not.toHaveBeenCalled();
  });
});
