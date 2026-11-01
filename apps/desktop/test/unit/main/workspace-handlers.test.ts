import type { AgentHostClient } from '@architect/engine/agent-host';
import type { Team } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { registerWorkspaceHandlers } from '../../../src/main/handlers/workspace';
import { routerHarness } from './router-harness';

const TEAM: Team = {
  id: 'team_1',
  name: 'Lab review',
  members: [{ graduateId: 'grd_1' }, { graduateId: 'grd_broken' }],
  createdAt: '2026-11-05T09:00:00.000Z',
  updatedAt: '2026-11-05T09:00:00.000Z',
};

function setup(failures: Record<string, string> = {}, edition: 'lab' | 'personal' = 'lab') {
  const { router, call } = routerHarness();
  let settle: () => void = () => undefined;
  const opening = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const host = {
    listChats: vi.fn(async () => []),
    createChat: vi.fn(async (graduateId: string) => ({ id: 'cht_1', graduateId })),
    createTeamChat: vi.fn(async (teamId: string) => ({ id: 'cht_2', graduateId: 'grd_1', teamId })),
    decide: vi.fn(async () => undefined),
  };
  registerWorkspaceHandlers(
    router,
    (request) => request(host as unknown as AgentHostClient),
    { settled: () => opening, failure: (graduateId) => failures[graduateId] },
    async () => [TEAM],
    () => edition === 'lab',
  );
  return { host, call, settle };
}

describe('workspace handlers', () => {
  it('wait until the graduates are open before forwarding', async () => {
    const { host, call, settle } = setup();
    const listing = call('workspace:listChats', 'grd_1');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(host.listChats).not.toHaveBeenCalled();
    settle();
    expect(await listing).toEqual({ ok: true, value: [] });
    expect(host.listChats).toHaveBeenCalledWith('grd_1');
  });

  it("refuse a new chat with a graduate that couldn't be opened, and say why", async () => {
    const reason = "The data of the job it was trained for isn't in Architect.";
    const { host, call, settle } = setup({ grd_broken: reason });
    settle();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await call('workspace:createChat', 'grd_broken')).toEqual({
      ok: false,
      error: { message: reason },
    });
    errors.mockRestore();
    expect(host.createChat).not.toHaveBeenCalled();
    expect(await call('workspace:createChat', 'grd_1')).toEqual({
      ok: true,
      value: { id: 'cht_1', graduateId: 'grd_1' },
    });
  });

  it("refuse a new team chat when any agent in the team couldn't be opened", async () => {
    const reason = "The data of the job it was trained for isn't in Architect.";
    const { host, call, settle } = setup({ grd_broken: reason });
    settle();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await call('workspace:createTeamChat', 'team_1')).toEqual({
      ok: false,
      error: { message: reason },
    });
    errors.mockRestore();
    expect(host.createTeamChat).not.toHaveBeenCalled();
  });

  it('refuse team chats in the personal edition, which has no teams', async () => {
    const { host, call, settle } = setup({}, 'personal');
    settle();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const method of ['listTeamChats', 'createTeamChat']) {
      expect(await call(`workspace:${method}`, 'team_1')).toMatchObject({
        ok: false,
        error: { code: 'lab_only' },
      });
    }
    errors.mockRestore();
    expect(host.createTeamChat).not.toHaveBeenCalled();
  });

  it('pass decisions through unchanged', async () => {
    const { host, call, settle } = setup();
    settle();
    await call('workspace:decide', 'chg_1', 'always');
    expect(host.decide).toHaveBeenCalledWith('chg_1', 'always');
  });
});
