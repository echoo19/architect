import type { IpcRouter } from '../ipc/router';

/** Said for a team request until the engine serves teams. */
export const TEAMS_UNAVAILABLE = "Teams aren't available in this build yet.";

const unavailable = (): never => {
  throw new Error(TEAMS_UNAVAILABLE);
};

/** The teams domain. Every request is refused until the engine serves teams. */
export function registerTeamHandlers(router: IpcRouter): void {
  router.registerHandlers('teams', {
    list: unavailable,
    create: unavailable,
    update: unavailable,
    remove: unavailable,
  });
}
