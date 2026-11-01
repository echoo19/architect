import { DatabaseSync } from 'node:sqlite';
import type { WorkspaceChat } from '@architect/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { newChat } from '../src/agent-host/messages';
import { openEngineStore } from '../src/store/engine-store';
import { MIGRATIONS } from '../src/store/migrations';
import { TeamLibrary } from '../src/teams/library';
import { addGraduate } from './agent-host/graduates';
import { newComputer, type Computer } from './support/computer';

const LOCAL = 'http://127.0.0.1:11434';
const AT = '2026-11-05T18:00:00.000Z';

let computer: Computer;
let teams: TeamLibrary;

beforeEach(async () => {
  computer = await newComputer();
  teams = new TeamLibrary({ store: computer.store, clock: computer.clock });
  for (const [id, name] of [
    ['grd_assay', 'Assay desk'],
    ['grd_sweep', 'Sweep desk'],
    ['grd_stock', 'Inventory desk'],
  ] as const) {
    await addGraduate(computer.dataDir, computer.store, { id, baseUrl: LOCAL, job: { name } });
  }
});

afterEach(async () => {
  await computer.remove();
});

const LAB_REVIEW = {
  name: 'Lab review',
  members: [
    { graduateId: 'grd_assay' },
    { graduateId: 'grd_sweep', role: "Reads Halden Lab's training sweeps" },
  ],
};

function teamChat(teamId: string, graduateId: string): WorkspaceChat {
  return { ...newChat(graduateId, 1, AT), teamId };
}

describe('teams', () => {
  it('keeps a team of agents here, lead first', () => {
    const team = teams.create(LAB_REVIEW);
    expect(team.id).toMatch(/^team_/);
    expect(teams.list()).toEqual([team]);
    expect(teams.teamsWith('grd_sweep')).toEqual([team]);
    expect(teams.teamsWith('grd_stock')).toEqual([]);
  });

  it('refuses a team of one, an agent twice, an agent not here, or two with one name', async () => {
    expect(() => teams.create({ name: 'Solo', members: [{ graduateId: 'grd_assay' }] })).toThrow();
    expect(() =>
      teams.create({
        name: 'Echo',
        members: [{ graduateId: 'grd_assay' }, { graduateId: 'grd_assay' }],
      }),
    ).toThrow();
    expect(() =>
      teams.create({
        name: 'Ghost',
        members: [{ graduateId: 'grd_assay' }, { graduateId: 'grd_none' }],
      }),
    ).toThrow('There is no agent "grd_none".');
    await addGraduate(computer.dataDir, computer.store, {
      id: 'grd_twin',
      baseUrl: LOCAL,
      job: { name: 'Sweep desk' },
    });
    expect(() =>
      teams.create({
        name: 'Twins',
        members: [{ graduateId: 'grd_sweep' }, { graduateId: 'grd_twin' }],
      }),
    ).toThrow('Two agents in the team are called Sweep desk.');
    expect(teams.list()).toEqual([]);
  });

  it('changes a team’s name and teammates but keeps its lead', () => {
    const team = teams.create(LAB_REVIEW);
    computer.clock.advance(1000);
    const updated = teams.update(team.id, {
      name: 'Screening review',
      members: [{ graduateId: 'grd_assay' }, { graduateId: 'grd_stock' }],
    });
    expect(updated).toMatchObject({
      id: team.id,
      name: 'Screening review',
      createdAt: team.createdAt,
    });
    expect(updated.updatedAt).not.toBe(team.updatedAt);
    expect(() =>
      teams.update(team.id, {
        name: 'Screening review',
        members: [{ graduateId: 'grd_stock' }, { graduateId: 'grd_assay' }],
      }),
    ).toThrow('Screening review keeps its lead');
    expect(computer.store.teams.get(team.id)).toEqual(updated);
  });

  it('removes a team with its chats, and keeps its lead’s own chats', () => {
    const team = teams.create(LAB_REVIEW);
    const own = newChat('grd_assay', 1, AT);
    const shared = teamChat(team.id, 'grd_assay');
    computer.store.chats.insert(own);
    computer.store.chats.insert(shared);
    expect(computer.store.chats.list('grd_assay')).toEqual([own]);
    expect(computer.store.chats.listTeam(team.id)).toEqual([shared]);
    expect(computer.store.chats.listLed('grd_assay')).toEqual([shared]);
    expect(computer.store.chats.listLed('grd_sweep')).toEqual([]);
    teams.remove(team.id);
    expect(computer.store.chats.get(shared.id)).toBeNull();
    expect(computer.store.chats.list('grd_assay')).toEqual([own]);
    expect(() => teams.get(team.id)).toThrow(`There is no team "${team.id}".`);
  });

  it('keeps a team while one of its chats is answering or waits on an approval', () => {
    const team = teams.create(LAB_REVIEW);
    const chat = teamChat(team.id, 'grd_assay');
    computer.store.chats.insert({ ...chat, running: true });
    expect(() => teams.remove(team.id)).toThrow(
      expect.objectContaining({
        code: 'team_answering',
        message: 'Lab review is still answering. Stop its replies, then remove it.',
      }),
    );
    computer.store.chats.update({ ...chat, waiting: true });
    expect(() => teams.remove(team.id)).toThrow('Lab review is still answering.');
    computer.store.chats.update(chat);
    teams.remove(team.id);
    expect(computer.store.chats.get(chat.id)).toBeNull();
  });

  it('refuses an agent whose helper has the name of the tool a lead asks with', async () => {
    await addGraduate(computer.dataDir, computer.store, {
      id: 'grd_old',
      baseUrl: LOCAL,
      job: { name: 'Old desk' },
      harness: {
        tools: [
          {
            name: 'ask_teammate',
            description: 'A helper from before teams.',
            parameters: { type: 'object' },
            code: 'function run() { return 1; }',
          },
        ],
      },
    });
    expect(() =>
      teams.create({
        name: 'Old review',
        members: [{ graduateId: 'grd_assay' }, { graduateId: 'grd_old' }],
      }),
    ).toThrow(
      expect.objectContaining({
        name: 'GuardError',
        message:
          "Old desk has a helper called ask_teammate, the name of the tool a team's lead asks its teammates with, so it can't join a team.",
      }),
    );
  });

  it('refuses to remove an agent that is in a team, with the way out', async () => {
    teams.create(LAB_REVIEW);
    await expect(computer.library.remove('grd_sweep')).rejects.toMatchObject({
      code: 'agent_in_team',
      message: 'Sweep desk is in Lab review. Take it out of the team in Models, Teams, first.',
    });
    await expect(computer.library.remove('grd_assay')).rejects.toThrow(
      'Assay desk leads Lab review. Remove the team in Models, Teams, first.',
    );
    await computer.library.remove('grd_stock');
    expect(computer.store.graduates.get('grd_stock')).toBeNull();
  });

  it('adds teams to a database made before them, whose chats stay their agents’', () => {
    const file = computer.paths.database;
    computer.close();
    const before = openEngineStore(
      file,
      MIGRATIONS.filter((migration) => migration.version < 24),
    );
    before.close();
    const db = new DatabaseSync(file);
    db.prepare(
      `INSERT INTO chats (id, graduate_id, title, running, waiting, created_at, updated_at, graduate_version)
       VALUES ('cht_old', 'grd_assay', 'Old chat', 0, 0, :at, :at, 1)`,
    ).run({ at: AT });
    db.close();
    const after = openEngineStore(file);
    try {
      const [chat] = after.chats.list('grd_assay');
      expect(chat).toMatchObject({ id: 'cht_old', title: 'Old chat' });
      expect(chat?.teamId).toBeUndefined();
      expect(after.teams.list()).toEqual([]);
    } finally {
      after.close();
    }
  });
});
