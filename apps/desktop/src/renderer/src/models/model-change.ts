import type { GraduateVersion, ReportCard, Score } from '@architect/shared';
import { formatPercent } from '../lib/format';
import { shortModelName } from '../lib/names';
import { compareCards, formatPoints, type OrgGroup } from './registry';

/*
 * Switching an agent to a version on another model (decision 095): what the new model gains and
 * loses at each organization, from the two versions' own final tests where both took the same
 * one. The agent switches only when the person says so, and can go back.
 */

/** Whether making `next` the version in use would change the model the agent answers on. */
export function changesModel(next: GraduateVersion, active: GraduateVersion): boolean {
  return next.manifest.model.base.name !== active.manifest.model.base.name;
}

/** The model a version runs on, by the short name people know it. */
export function versionModel(version: GraduateVersion): string {
  return shortModelName(version.manifest.model.label);
}

export interface OrgChange {
  org: string;
  name: string;
  group: OrgGroup;
  before: Score;
  after: Score;
  /** Percentage points, after minus before. */
  points: number;
}

/**
 * Each organization both cards measured on the same tasks, all skills together, in the grid's
 * order: taught on, never seen, never seen and real. Empty when no organization compares.
 */
export function orgChanges(before: ReportCard, after: ReportCard): OrgChange[] {
  const compared = compareCards(before, after);
  if (compared.kind === 'apart') return [];
  const columns = compared.scores.groups.flatMap((group) =>
    group.columns.map((column) => ({ ...column, group: group.group })),
  );
  return columns.flatMap((column, index) => {
    const cell = compared.scores.totals[index];
    return cell
      ? [
          {
            org: column.org,
            name: column.name,
            group: column.group,
            before: cell.before,
            after: cell.after,
            points: cell.points,
          },
        ]
      : [];
  });
}

/** "Gains 8 points", "Loses 3 points", "No change". */
export function changeWords(points: number): string {
  if (points === 0) return 'No change';
  const size = Math.abs(points);
  return `${points > 0 ? 'Gains' : 'Loses'} ${size} ${size === 1 ? 'point' : 'points'}`;
}

/** "75% → 83%", then the change in points: "+8". */
export function changeFigures(change: OrgChange): { scores: string; points: string } {
  return {
    scores: `${formatPercent(change.before)} → ${formatPercent(change.after)}`,
    points: formatPoints(change.points),
  };
}
