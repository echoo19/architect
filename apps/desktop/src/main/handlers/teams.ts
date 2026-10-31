import { TeamInputSchema } from '@architect/shared';
import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import type { EngineCall } from './engine';
import type { AgentHostCall } from './workspace';

const text = z.string().min(1);

/**
 * The teams domain, forwarded to the engine (decision 100). A team's replies run in the agent
 * host, so removing a team stops them there first, and only then do the team and its chats go.
 */
export function registerTeamHandlers(
  router: IpcRouter,
  call: EngineCall,
  agentHost: AgentHostCall,
): void {
  router.registerHandlers(
    'teams',
    {
      list: () => call((api) => api.teams.list()),
      create: (input) => call((api) => api.teams.create(input)),
      update: (teamId, input) => call((api) => api.teams.update(teamId, input)),
      remove: async (teamId) => {
        await agentHost((host) => host.closeTeam(teamId));
        await call((api) => api.teams.remove(teamId));
      },
    },
    {
      create: z.tuple([TeamInputSchema]),
      update: z.tuple([text, TeamInputSchema]),
      remove: z.tuple([text]),
    },
  );
}
