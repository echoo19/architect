import { join, resolve } from 'node:path';
import type { EngineApi } from '@architect/engine';
import type { GraduateSummary } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { PickedPaths } from '../../../src/main/files/picked';
import { registerGraduateHandlers } from '../../../src/main/handlers/graduates';
import { routerHarness } from './router-harness';

const ROOT = resolve('/work');

function setup() {
  const { router, call } = routerHarness();
  const order: string[] = [];
  const graduate = { id: 'grd_1', name: 'Service desk' } as GraduateSummary;
  const engine = {
    graduates: {
      accept: vi.fn(async () => graduate),
      importFolder: vi.fn(async () => graduate),
      exportFolder: vi.fn(async () => undefined),
      remove: vi.fn(async () => {
        order.push('engine.remove');
      }),
      settings: vi.fn(async () => ({ writeMode: 'ask' })),
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
  return { engine, workspace, picked, call, order, graduate };
}

describe('graduate handlers', () => {
  it('open an accepted graduate in the workspace before answering', async () => {
    const { workspace, call, graduate } = setup();
    expect(await call('graduates:accept', 'run_1')).toEqual({ ok: true, value: graduate });
    expect(workspace.open).toHaveBeenCalledWith(graduate);
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

  it('export into a folder the user picked', async () => {
    const { engine, picked, call } = setup();
    const folder = join(ROOT, 'exports');
    picked.add([folder], 'folders');
    const target = join(folder, 'service-desk');
    expect((await call('graduates:exportFolder', 'grd_1', target)).ok).toBe(true);
    expect(engine.graduates.exportFolder).toHaveBeenCalledWith('grd_1', target);
    expect((await call('graduates:exportFolder', 'grd_1', join(ROOT, 'elsewhere'))).ok).toBe(false);
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
