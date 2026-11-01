import {
  ASK_TEAMMATE,
  CodedError,
  GuardError,
  newId,
  TeamInputSchema,
  type Team,
  type TeamInput,
} from '@architect/shared';
import { HARNESS_DIR } from '../graduates/build';
import type { Clock } from '../loop/deps';
import { isoNow } from '../loop/time';
import type { EngineStore } from '../store/engine-store';

export interface TeamLibraryContext {
  store: EngineStore;
  clock: Clock;
}

/**
 * Teams (decision 100): saved lists of agents, the lead first, that answer together in a team
 * chat. A team's lead stays its lead, so its chats always have the one agent that answered them;
 * a different lead is a new team. Removing a team removes its chats, and its agents stay.
 */
export class TeamLibrary {
  constructor(private readonly ctx: TeamLibraryContext) {}

  list(): Team[] {
    return this.ctx.store.teams.list();
  }

  get(teamId: string): Team {
    const team = this.ctx.store.teams.get(teamId);
    if (!team) throw new CodedError('record_not_found', `There is no team "${teamId}".`);
    return team;
  }

  /** The teams an agent is in, as lead or teammate. */
  teamsWith(graduateId: string): Team[] {
    return this.list().filter((team) =>
      team.members.some((member) => member.graduateId === graduateId),
    );
  }

  create(input: TeamInput): Team {
    const parsed = this.checked(input);
    const at = isoNow(this.ctx.clock);
    const team: Team = { id: newId('team'), ...parsed, createdAt: at, updatedAt: at };
    this.ctx.store.teams.insert(team);
    return team;
  }

  /** Changes the team's name, roles and teammates. Its lead stays. */
  update(teamId: string, input: TeamInput): Team {
    return this.ctx.store.transaction(() => {
      const team = this.get(teamId);
      const parsed = this.checked(input);
      if (parsed.members[0]?.graduateId !== team.members[0]?.graduateId) {
        throw new Error(
          `${team.name} keeps its lead, so its chats stay with the agent that answered them. Make a new team for a different lead.`,
        );
      }
      const updated: Team = { ...team, ...parsed, updatedAt: isoNow(this.ctx.clock) };
      this.ctx.store.teams.update(updated);
      return updated;
    });
  }

  /**
   * Removes the team and its chats. Its replies run in the agent host, which the caller asks to
   * stop them first: while one of its chats is still answering or waits on an approval, the team
   * stays, so no reply goes on writing for a conversation that is gone.
   */
  remove(teamId: string): void {
    this.ctx.store.transaction(() => {
      const team = this.get(teamId);
      const busy = this.ctx.store.chats
        .listTeam(teamId)
        .some((chat) => chat.running || chat.waiting);
      if (busy) {
        throw new CodedError(
          'team_answering',
          `${team.name} is still answering. Stop its replies, then remove it.`,
        );
      }
      this.ctx.store.teams.remove(teamId);
    });
  }

  /** The input as stored: every member an agent here, each name once, so the lead can ask by name. */
  private checked(input: TeamInput): TeamInput {
    const parsed = TeamInputSchema.parse(input);
    const names = new Set<string>();
    for (const member of parsed.members) {
      const agent = this.ctx.store.graduates.get(member.graduateId);
      if (!agent) {
        throw new CodedError('agent_not_found', `There is no agent "${member.graduateId}".`);
      }
      const active =
        agent.activeVersion === null
          ? null
          : this.ctx.store.versions.get(agent.id, agent.activeVersion);
      const helper = `${HARNESS_DIR}/tools/${ASK_TEAMMATE}.json`;
      if (active?.manifest.integrity.files.some((file) => file.path === helper)) {
        throw new GuardError(
          'permission',
          `${agent.name} has a helper called ${ASK_TEAMMATE}, the name of the tool a team's lead asks its teammates with, so it can't join a team.`,
        );
      }
      if (names.has(agent.name)) {
        throw new Error(
          `Two agents in the team are called ${agent.name}. A lead asks its teammates by name, so each needs its own.`,
        );
      }
      names.add(agent.name);
    }
    return parsed;
  }
}
