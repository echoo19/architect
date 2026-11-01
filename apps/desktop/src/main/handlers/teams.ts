import { CodedError, TeamInputSchema } from '@architect/shared';
import { z } from 'zod';
import type { IpcRouter } from '../ipc/router';
import type { EngineCall } from './engine';
import type { AgentHostCall } from './workspace';

const text = z.string().min(1);

/** Whether the app runs as Architect Lab, the edition teams belong to (decisions 076 and 100). */
export type InLab = () => boolean;

/** Refuses a team request in the personal edition, which has no teams. */
export function requireLab(inLab: InLab): void {
  if (!inLab()) {
    throw new CodedError(
      'lab_only',
      "Teams are part of Architect Lab, and this is Architect's personal edition.",
    );
  }
}

/**
 * The teams domain, forwarded to the engine (decision 100), in Architect Lab only. A team's
 * replies run in the agent host, so removing a team stops them there first, and only then do the
 * team and its chats go.
 */
export function registerTeamHandlers(
  router: IpcRouter,
  call: EngineCall,
  agentHost: AgentHostCall,
  inLab: InLab,
): void {
  const lab = <T>(request: () => Promise<T>): Promise<T> => {
    requireLab(inLab);
    return request();
  };
  router.registerHandlers(
    'teams',
    {
      list: () => lab(() => call((api) => api.teams.list())),
      create: (input) => lab(() => call((api) => api.teams.create(input))),
      update: (teamId, input) => lab(() => call((api) => api.teams.update(teamId, input))),
      remove: async (teamId) => {
        requireLab(inLab);
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
