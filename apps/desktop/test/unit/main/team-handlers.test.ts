import type { EngineApi } from '@architect/engine';
import type { AgentHostClient } from '@architect/engine/agent-host';
import type { Team } from '@architect/shared';
import { describe, expect, it, vi } from 'vitest';
import { registerTeamHandlers } from '../../../src/main/handlers/teams';
import { routerHarness } from './router-harness';

const TEAM: Team = {
  id: 'team_1',
  name: 'Screening logistics',
  members: [{ graduateId: 'grd_lead' }, { graduateId: 'grd_mate' }],
  createdAt: '2026-10-31T09:00:00.000Z',
  updatedAt: '2026-10-31T09:00:00.000Z',
};

function setup(edition: 'lab' | 'personal') {
  const { router, call } = routerHarness();
  const order: string[] = [];
  const teams = {
    list: vi.fn(async () => [TEAM]),
    create: vi.fn(async () => TEAM),
    update: vi.fn(async () => TEAM),
    remove: vi.fn(async () => {
      order.push('engine.remove');
    }),
  };
  const host = {
    closeTeam: vi.fn(async () => {
      order.push('host.closeTeam');
    }),
  };
  registerTeamHandlers(
    router,
    (request) => request({ teams } as unknown as EngineApi),
    (request) => request(host as unknown as AgentHostClient),
    () => edition === 'lab',
  );
  return { call, teams, host, order };
}

describe('team handlers', () => {
  it('forward to the engine in Architect Lab, stopping a team’s replies before removing it', async () => {
    const { call, teams, order } = setup('lab');
    expect(await call('teams:list')).toEqual({ ok: true, value: [TEAM] });
    const input = { name: TEAM.name, members: TEAM.members };
    expect(await call('teams:create', input)).toEqual({ ok: true, value: TEAM });
    expect(teams.create).toHaveBeenCalledWith(input);
    await call('teams:remove', TEAM.id);
    expect(order).toEqual(['host.closeTeam', 'engine.remove']);
  });

  it('refuse every request in the personal edition, which has no teams', async () => {
    const { call, teams, host } = setup('personal');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const input = { name: TEAM.name, members: TEAM.members };
    for (const [channel, ...args] of [
      ['teams:list'],
      ['teams:create', input],
      ['teams:update', TEAM.id, input],
      ['teams:remove', TEAM.id],
    ] as const) {
      expect(await call(channel, ...args)).toMatchObject({
        ok: false,
        error: { code: 'lab_only' },
      });
    }
    errors.mockRestore();
    expect(teams.list).not.toHaveBeenCalled();
    expect(host.closeTeam).not.toHaveBeenCalled();
  });
});
