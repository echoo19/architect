import type { OrgTypeResult, Score } from '@architect/shared';

/**
 * Where an organization stands to the agent: trained with, never seen, never seen and real, or
 * never seen and added to the field after the run (decision 085).
 */
export type OrgGroup = 'seen' | 'unseen' | 'real' | 'added';

export const ORG_GROUPS: { group: OrgGroup; label: string }[] = [
  { group: 'seen', label: 'Taught on' },
  { group: 'unseen', label: 'Never seen' },
  { group: 'real', label: 'Never seen, real' },
  { group: 'added', label: 'Added later' },
];

export interface OrgColumn {
  org: string;
  name: string;
  group: OrgGroup;
  /** Every final-test task at this organization, all skills together. */
  score: Score;
  /** Measured as never seen, and taught on since in a later version of the field (decision 089). */
  taughtLater: boolean;
}

export interface OrgGrid {
  /** The groups that have an organization, in the order the grid reads them. */
  groups: { group: OrgGroup; label: string; columns: OrgColumn[] }[];
  /** One row per skill; a cell is null where the skill wasn't tested at that organization. */
  rows: { type: string; label: string; cells: (Score | null)[] }[];
}

function groupOf(result: OrgTypeResult): OrgGroup {
  if (result.seen) return 'seen';
  if (result.addedLater === true) return 'added';
  return result.synthetic ? 'unseen' : 'real';
}

/**
 * The final test as a skill by organization grid (decision 070), or null for a job with one
 * organization, whose report reads as it always has.
 */
export function organizationGrid(perOrg: readonly OrgTypeResult[] | undefined): OrgGrid | null {
  if (perOrg === undefined) return null;
  const columns: OrgColumn[] = [];
  const rows: { type: string; label: string }[] = [];
  for (const result of perOrg) {
    const column = columns.find((item) => item.org === result.org);
    if (column) {
      column.score = {
        pass: column.score.pass + result.pass,
        total: column.score.total + result.total,
      };
    } else {
      columns.push({
        org: result.org,
        name: result.orgName,
        group: groupOf(result),
        score: { pass: result.pass, total: result.total },
        taughtLater: result.taughtLater === true,
      });
    }
    if (!rows.some((row) => row.type === result.type)) {
      rows.push({ type: result.type, label: result.label });
    }
  }
  if (columns.length < 2) return null;
  const groups = ORG_GROUPS.map((group) => ({
    ...group,
    columns: columns.filter((column) => column.group === group.group),
  })).filter((group) => group.columns.length > 0);
  const ordered = groups.flatMap((group) => group.columns);
  return {
    groups,
    rows: rows.map((row) => ({
      ...row,
      cells: ordered.map((column) => {
        const cell = perOrg.find((item) => item.type === row.type && item.org === column.org);
        return cell ? { pass: cell.pass, total: cell.total } : null;
      }),
    })),
  };
}
