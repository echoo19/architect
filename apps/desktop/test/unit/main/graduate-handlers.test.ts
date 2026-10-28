import { join, resolve } from 'node:path';
import { HubError, type EngineApi } from '@architect/engine';
import {
  PackageError,
  type GraduateSummary,
  type ImportResult,
  type Installation,
} from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerGraduateHandlers } from '../../../src/main/handlers/graduates';
import { routerHarness } from './router-harness';

const ROOT = resolve('/work');

function setup() {
  const { router, call } = routerHarness();
  const order: string[] = [];
  const graduate = { id: 'grd_1', name: 'Service desk', activeVersion: 2 } as GraduateSummary;
  const installation = { graduateId: 'grd_1', status: 'ready' } as Installation;
  const imported = { graduate, version: 1, installation, alreadyInstalled: false } as ImportResult;
  const engine = {
    graduates: {
      list: vi.fn(async () => [graduate]),
      accept: vi.fn(async () => graduate),
      promote: vi.fn(async () => graduate),
      rollback: vi.fn(async () => graduate),
      bind: vi.fn(async () => installation),
      importFolder: vi.fn(async () => graduate),
      importPackage: vi.fn(async () => imported),
      inspectPackage: vi.fn(async () => ({ ok: false, code: 'checksum', problems: ['Changed.'] })),
      exportFolder: vi.fn(async () => undefined),
      exportPackage: vi.fn(async () => undefined),
      remove: vi.fn(async () => {
        order.push('engine.remove');
      }),
      settings: vi.fn(async () => ({ writeMode: 'ask' })),
      installFromHub: vi.fn(async () => ({ ...imported, source: { kind: 'huggingface' } })),
      reviewPublication: vi.fn(async () => ({ files: [] })),
      publish: vi.fn(async () => ({ alreadyPublished: false })),
      publications: vi.fn(async () => []),
    },
  };
  const workspace = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => {
      order.push('workspace.close');
    }),
  };
  const picked = new PickedPaths();
  registerGraduateHandlers(
    router,
    (request) => request(engine as unknown as EngineApi),
    workspace,
    picked,
  );
  return { engine, workspace, picked, call, order, graduate, imported };
}

describe('graduate handlers', () => {
  it('open an accepted graduate in the workspace before answering', async () => {
    const { workspace, call, graduate } = setup();
    expect(await call('graduates:accept', 'run_1')).toEqual({ ok: true, value: graduate });
    expect(workspace.open).toHaveBeenCalledWith(graduate);
  });

  it('open the new active version after a promotion or a rollback', async () => {
    const { engine, workspace, call, graduate } = setup();
    expect(await call('graduates:promote', 'grd_1', 2)).toEqual({ ok: true, value: graduate });
    expect(await call('graduates:rollback', 'grd_1', 1)).toEqual({ ok: true, value: graduate });
    expect(engine.graduates.rollback).toHaveBeenCalledWith('grd_1', 1);
    expect(workspace.open).toHaveBeenCalledTimes(2);
    expect((await call('graduates:promote', 'grd_1', 'v2')).ok).toBe(false);
  });

  it('import only a folder the user picked, then open it in the workspace', async () => {
    const { engine, workspace, picked, call, graduate } = setup();
    const folder = join(ROOT, 'downloads', 'service-desk');
    expect((await call('graduates:importFolder', folder)).ok).toBe(false);
    expect(engine.graduates.importFolder).not.toHaveBeenCalled();

    picked.add([folder], 'folders');
    expect(await call('graduates:importFolder', folder)).toEqual({ ok: true, value: graduate });
    expect(engine.graduates.importFolder).toHaveBeenCalledWith(folder);
    expect(workspace.open).toHaveBeenCalledWith(graduate);
  });

  it('import or inspect a package, and bind its folders, only with paths the user picked', async () => {
    const { engine, workspace, picked, call, imported } = setup();
    const archive = join(ROOT, 'downloads', 'service-desk-v1.architect.zip');
    const data = join(ROOT, 'records');
    const request = { bindings: { data } };
    picked.add([archive], 'files');
    expect((await call('graduates:importPackage', archive, request)).ok).toBe(false);
    expect(engine.graduates.importPackage).not.toHaveBeenCalled();

    picked.add([data], 'folders');
    expect(await call('graduates:importPackage', archive, request)).toEqual({
      ok: true,
      value: imported,
    });
    expect(engine.graduates.importPackage).toHaveBeenCalledWith(archive, {
      bindings: { data },
      loadModel: true,
    });
    expect(workspace.open).toHaveBeenCalledWith(imported.graduate);
    expect((await call('graduates:inspectPackage', archive)).ok).toBe(true);
    expect((await call('graduates:inspectPackage', join(ROOT, 'other.zip'))).ok).toBe(false);

    expect(
      (await call('graduates:bind', 'grd_1', { bindings: { data: join(ROOT, 'x') } })).ok,
    ).toBe(false);
    expect((await call('graduates:bind', 'grd_1', { bindings: { data } })).ok).toBe(true);
    expect(engine.graduates.bind).toHaveBeenCalledWith('grd_1', { bindings: { data } });
    expect(workspace.open).toHaveBeenCalledTimes(2);
  });

  it('export into a folder the user picked', async () => {
    const { engine, picked, call } = setup();
    const folder = join(ROOT, 'exports');
    picked.add([folder], 'folders');
    expect((await call('graduates:exportFolder', 'grd_1', folder)).ok).toBe(true);
    expect(engine.graduates.exportFolder).toHaveBeenCalledWith('grd_1', folder);
    expect((await call('graduates:exportFolder', 'grd_1', join(ROOT, 'elsewhere'))).ok).toBe(false);
    expect(
      (
        await call('graduates:exportPackage', 'grd_1', {
          directory: folder,
          include: ['resource:data'],
        })
      ).ok,
    ).toBe(true);
    expect(engine.graduates.exportPackage).toHaveBeenCalledWith('grd_1', {
      directory: folder,
      include: ['resource:data'],
    });
    expect(
      (await call('graduates:exportPackage', 'grd_1', { directory: join(ROOT, 'elsewhere') })).ok,
    ).toBe(false);
  });

  it('install from the Hub binding only folders the user picked, then open it', async () => {
    const { engine, workspace, picked, call, graduate } = setup();
    const data = join(ROOT, 'records');
    const request = { revision: 'a'.repeat(40), bindings: { data } };
    expect((await call('graduates:installFromHub', 'hf://jake/desk', request)).ok).toBe(false);
    expect(engine.graduates.installFromHub).not.toHaveBeenCalled();

    picked.add([data], 'folders');
    expect((await call('graduates:installFromHub', 'hf://jake/desk', request)).ok).toBe(true);
    expect(engine.graduates.installFromHub).toHaveBeenCalledWith('hf://jake/desk', {
      revision: 'a'.repeat(40),
      bindings: { data },
      loadModel: true,
    });
    expect(workspace.open).toHaveBeenCalledWith(graduate);
    expect((await call('graduates:installFromHub', 'hf://jake/desk', { token: 'x' })).ok).toBe(
      false,
    );
  });

  it('review and publish only requests that name a repository, private by default', async () => {
    const { engine, call } = setup();
    expect(
      (await call('graduates:reviewPublication', 'grd_1', { repository: 'jake/desk' })).ok,
    ).toBe(true);
    expect(engine.graduates.reviewPublication).toHaveBeenCalledWith('grd_1', {
      repository: 'jake/desk',
      visibility: 'private',
      include: [],
    });
    expect((await call('graduates:publish', 'grd_1', { repository: 'not a repo' })).ok).toBe(false);
    expect(
      (await call('graduates:publish', 'grd_1', { repository: 'jake/desk', token: 'hf_x' })).ok,
    ).toBe(false);
    expect(engine.graduates.publish).not.toHaveBeenCalled();
    expect((await call('graduates:publish', 'grd_1', { repository: 'jake/desk' })).ok).toBe(true);
    expect((await call('graduates:publications', 'grd_1')).ok).toBe(true);
  });

  it('say what to do about a Hub failure, since only the message reaches the screen', async () => {
    const { engine, call } = setup();
    engine.graduates.publish.mockRejectedValueOnce(
      new HubError(
        'auth',
        'Hugging Face refused the token.',
        'Check the Hugging Face token in Settings; it needs write access.',
      ),
    );
    expect(await call('graduates:publish', 'grd_1', { repository: 'jake/desk' })).toEqual({
      ok: false,
      error: {
        message:
          'Hugging Face refused the token. Check the Hugging Face token in Settings; it needs write access.',
      },
    });
    engine.graduates.installFromHub.mockRejectedValueOnce(
      new HubError('not_found', 'Hugging Face has no such repository.', 'Check the names.'),
    );
    expect(await call('graduates:installFromHub', 'hf://jake/desk')).toEqual({
      ok: false,
      error: { message: 'Hugging Face has no such repository. Check the names.' },
    });
    // A commit that holds no package says where to look.
    engine.graduates.installFromHub.mockRejectedValueOnce(
      new PackageError('not_a_package', [
        "jake/notes has no graduate.json at c41d8a2, so it isn't an Architect package.",
      ]),
    );
    expect(await call('graduates:installFromHub', 'hf://jake/notes')).toEqual({
      ok: false,
      error: {
        message:
          "jake/notes has no graduate.json at c41d8a2, so it isn't an Architect package. Check the repository and the commit.",
      },
    });
    // Any other failure keeps its own words.
    engine.graduates.publish.mockRejectedValueOnce(new Error('jake/desk is public.'));
    expect(await call('graduates:publish', 'grd_1', { repository: 'jake/desk' })).toEqual({
      ok: false,
      error: { message: 'jake/desk is public.' },
    });
  });

  it('close a graduate in the workspace before the engine removes it', async () => {
    const { call, order } = setup();
    expect(await call('graduates:remove', 'grd_1')).toEqual({ ok: true, value: undefined });
    expect(order).toEqual(['workspace.close', 'engine.remove']);
  });

  it("read settings from the engine's store, which the agent host shares", async () => {
    const { engine, call } = setup();
    expect(await call('graduates:settings', 'grd_1')).toEqual({
      ok: true,
      value: { writeMode: 'ask' },
    });
    expect(engine.graduates.settings).toHaveBeenCalledWith('grd_1');
  });
});
