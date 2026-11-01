import {
  MAX_TEAM_MEMBERS,
  TeamMemberSchema,
  type GraduateSummary,
  type Team,
  type TeamInput,
} from '@architect/shared';

/** A lead may ask up to three teammates (decision 100). */
export const MAX_TEAMMATES = MAX_TEAM_MEMBERS - 1;

/** The longest role a teammate may be given, as the contract allows. */
export const ROLE_CHARS = TeamMemberSchema.shape.role.unwrap().maxLength ?? 120;

/**
 * What the dialog holds for each teammate chosen: the agent, and what the lead may ask it when
 * the person wrote a role of their own; without one the teammate follows its contract.
 */
export interface TeammatePick {
  graduateId: string;
  role?: string;
}

/** The agents that can be in a team: those with a version that runs in chats. */
export function teamAgents(graduates: readonly GraduateSummary[]): GraduateSummary[] {
  return graduates.filter((graduate) => graduate.activeVersion !== null);
}

/**
 * The role a teammate starts with: its contract's summary, cut to fit at a word. A role left at
 * this is not saved, so the teammate keeps following its contract.
 */
export function defaultRole(summary: string | undefined): string {
  const text = (summary ?? '').trim();
  if (text.length <= ROLE_CHARS) return text;
  const cut = text.slice(0, ROLE_CHARS - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

/**
 * What a team is saved as: the lead first, then each teammate chosen, with a role only where the
 * person wrote one of their own.
 */
export function teamInput(
  name: string,
  lead: string,
  picks: readonly TeammatePick[],
  defaults: Readonly<Record<string, string>>,
): TeamInput {
  return {
    name: name.trim(),
    members: [
      { graduateId: lead },
      ...picks.map((pick) => {
        const role = (pick.role ?? '').trim();
        return role === '' || role === defaults[pick.graduateId]
          ? { graduateId: pick.graduateId }
          : { graduateId: pick.graduateId, role };
      }),
    ],
  };
}

/**
 * Why a team can't be saved yet, in a few words; null once it can. `others` are the names of the
 * other teams, which the sidebar and the Teams table tell apart by name alone.
 */
export function teamProblem(
  name: string,
  lead: string | undefined,
  picks: readonly TeammatePick[],
  graduates: readonly GraduateSummary[],
  others: readonly string[] = [],
): string | null {
  if (name.trim() === '') return 'Name the team';
  const same = (other: string) => other.trim().toLowerCase() === name.trim().toLowerCase();
  if (others.some(same)) return `Another team is named ${name.trim()}`;
  if (lead === undefined) return 'Choose a lead';
  if (picks.length === 0) return 'Choose a teammate';
  const names = [lead, ...picks.map((pick) => pick.graduateId)].map(
    (id) => graduates.find((graduate) => graduate.id === id)?.name ?? id,
  );
  const twice = names.find((item, index) => names.indexOf(item) !== index);
  // The lead asks a teammate by name, so two of the same name can't be told apart.
  return twice === undefined ? null : `Two agents are named ${twice}; rename one first`;
}

/** The agents of a saved team that are still on this computer: the lead, then the teammates. */
export function membersOf(
  team: Team,
  graduates: readonly GraduateSummary[],
): { lead: GraduateSummary | undefined; teammates: GraduateSummary[] } {
  const find = (id: string) => graduates.find((graduate) => graduate.id === id);
  const [lead, ...rest] = team.members;
  return {
    lead: lead && find(lead.graduateId),
    teammates: rest.flatMap((member) => find(member.graduateId) ?? []),
  };
}
