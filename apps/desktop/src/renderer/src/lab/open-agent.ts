import type { GraduateSummary, Team } from '@architect/shared';
import { attempt } from '../lib/notify';
import { chatPath, navigate } from '../lib/router';
import { latestChat, latestTeamChat } from '../workspace/store';

/** Opens an agent at the chat it was used in last, or a new one when it has none. */
export function openAgent(graduate: Pick<GraduateSummary, 'id' | 'name'>): void {
  void attempt(`Couldn't open ${graduate.name}`, async () => {
    const chat = await latestChat([graduate.id]);
    navigate(chatPath(chat));
  });
}

/** Opens a team at the chat it was used in last, or a new one when it has none. */
export function openTeam(team: Pick<Team, 'id' | 'name'>): void {
  void attempt(`Couldn't open ${team.name}`, async () => {
    navigate(chatPath(await latestTeamChat(team.id)));
  });
}
