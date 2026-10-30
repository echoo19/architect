import type { OrgTypeResult } from '@architect/shared';

export interface AgentOrganization {
  org: string;
  name: string;
  seen: boolean;
}

/** The organizations an agent's final test covered, in its report's order; empty for one. */
export function organizationsOf(perOrg: readonly OrgTypeResult[] | undefined): AgentOrganization[] {
  const orgs: AgentOrganization[] = [];
  for (const result of perOrg ?? []) {
    if (!orgs.some((item) => item.org === result.org)) {
      orgs.push({ org: result.org, name: result.orgName, seen: result.seen });
    }
  }
  return orgs.length < 2 ? [] : orgs;
}

/** The organization id a records folder belongs to, from its place at `orgs/<id>/data`. */
export function orgOfFolder(folder: string): string | null {
  return /(?:^|[\\/])orgs[\\/]([^\\/]+)[\\/]data[\\/]?$/.exec(folder)?.[1] ?? null;
}

/**
 * Why a picked folder can't be bound as an organization's records, or null when it can: only the
 * organization's own `orgs/<id>/data` folder is known to hold its records, so a folder of
 * another organization, or one whose place says nothing, is refused rather than guessed at.
 */
export function folderProblem(
  orgs: readonly AgentOrganization[],
  chosen: AgentOrganization,
  folder: string,
): string | null {
  const id = orgOfFolder(folder);
  if (id === chosen.org) return null;
  const other = orgs.find((item) => item.org === id);
  if (other) return `That folder holds ${other.name}'s records, not ${chosen.name}'s.`;
  return `Can't tell that folder holds ${chosen.name}'s records. Choose its orgs/${chosen.org}/data folder.`;
}

/**
 * Which organization's records the agent works on: the one whose folder its records are bound
 * to, or, while they aren't bound, the first it trained with, whose copy it graduated with
 * (decision 068). A folder outside any organization's place is named by the folder itself.
 */
export function currentOrganization(
  orgs: readonly AgentOrganization[],
  folder: string | undefined,
): { org: string | null; name: string } | null {
  if (folder === undefined) {
    const first = orgs.find((item) => item.seen);
    return first ? { org: first.org, name: first.name } : null;
  }
  const id = orgOfFolder(folder);
  const known = orgs.find((item) => item.org === id);
  if (known) return { org: known.org, name: known.name };
  return { org: null, name: folder.split(/[\\/]/).filter(Boolean).at(-1) ?? folder };
}
