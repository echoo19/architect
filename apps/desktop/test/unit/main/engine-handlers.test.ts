import { join, resolve } from 'node:path';
import type { EngineApi } from '@architect/engine';
import { describe, expect, it, vi } from 'vitest';
import type { IpcResult } from '../../../src/common/ipc';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerEngineHandlers } from '../../../src/main/handlers/engine';
import { IpcRouter, type IpcEventLike } from '../../../src/main/ipc/router';

type Listener = (event: IpcEventLike, ...args: unknown[]) => Promise<IpcResult<unknown>>;

const ROOT = resolve('/work');

function setup() {
  const listeners = new Map<string, Listener>();
  const router = new IpcRouter({
    ipcMain: { handle: (channel, listener) => listeners.set(channel, listener) },
    isTrustedSender: () => true,
    targets: () => [],
  });
  const engine = {
    jobs: { list: vi.fn(async () => []), importFile: vi.fn(async () => ({ id: 'job_1' })) },
    graduates: { exportFolder: vi.fn(async () => undefined) },
    reports: {
      get: vi.fn(async () => {
        throw new Error('This run has no report card yet.');
      }),
    },
  };
  const picked = new PickedPaths();
  registerEngineHandlers(router, (request) => request(engine as unknown as EngineApi), picked);
  const call = async (channel: string, ...args: unknown[]) => {
    const listener = listeners.get(channel);
    if (!listener) throw new Error(`no listener on ${channel}`);
    return listener({ senderFrame: { url: 'file:///app/index.html' } }, ...args);
  };
  return { engine, picked, call };
}

describe('engine handlers', () => {
  it('forward requests and hand back what the engine answers', async () => {
    const { engine, call } = setup();
    expect(await call('jobs:list')).toEqual({ ok: true, value: [] });
    expect(engine.jobs.list).toHaveBeenCalledOnce();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await call('reports:get', 'run_1')).toEqual({
      ok: false,
      error: { message: 'This run has no report card yet.' },
    });
    errors.mockRestore();
  });

  it('pass on only the files the user picked', async () => {
    const { engine, picked, call } = setup();
    const job = join(ROOT, 'downloads', 'job.json');

    const refused = await call('jobs:importFile', job);
    expect(refused.ok).toBe(false);
    expect(engine.jobs.importFile).not.toHaveBeenCalled();

    picked.add([job], 'files');
    expect(await call('jobs:importFile', job)).toEqual({ ok: true, value: { id: 'job_1' } });
    expect(engine.jobs.importFile).toHaveBeenCalledWith(job);
  });

  it('let a graduate be exported into a folder the user picked', async () => {
    const { engine, picked, call } = setup();
    const folder = join(ROOT, 'exports');
    picked.add([folder], 'folders');
    const target = join(folder, 'service-desk');
    expect(await call('graduates:exportFolder', 'grd_1', target)).toEqual({
      ok: true,
      value: undefined,
    });
    expect(engine.graduates.exportFolder).toHaveBeenCalledWith('grd_1', target);

    const outside = await call('graduates:exportFolder', 'grd_1', join(ROOT, 'elsewhere'));
    expect(outside.ok).toBe(false);
  });

  it('check the shape of path arguments before anything else', async () => {
    const { call } = setup();
    const result = await call('jobs:draftStart', 'Bill finished jobs', 'not-a-list');
    expect(!result.ok && result.error.message).toContain('Invalid arguments for jobs.draftStart');
  });
});
