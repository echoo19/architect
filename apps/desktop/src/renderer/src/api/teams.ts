import { TeamSchema, type TeamInput } from '@architect/shared';
import { z } from 'zod';
import { forgetTeam } from '../workspace/store';
import { architect, read } from './client';
import { fetchQuery, useQuery } from './query';

/** Teams of agents (decision 100): a lead and the teammates it may ask. */
export const teamsApi = {
  list: () => read('teams.list', z.array(TeamSchema), architect().teams.list()),
  create: (input: TeamInput) => read('teams.create', TeamSchema, architect().teams.create(input)),
  update: (teamId: string, input: TeamInput) =>
    read('teams.update', TeamSchema, architect().teams.update(teamId, input)),
};

export const TEAMS_KEY = 'teams';

export const useTeams = () => useQuery(TEAMS_KEY, teamsApi.list);

/** Reads the teams again after one was made, changed or removed. */
export const refreshTeams = () => fetchQuery(TEAMS_KEY, teamsApi.list);

/** Removes a team and its chats, here and in the agent host. */
export async function removeTeam(teamId: string): Promise<void> {
  await architect().teams.remove(teamId);
  forgetTeam(teamId);
  await refreshTeams();
}
