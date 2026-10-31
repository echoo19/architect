import type { Job, ReportCard, Run, Score } from '@architect/shared';
import { formatPercent } from '../../lib/format';
import { organizationGrid } from './org-grid';

/*
 * "Before and after" on a later version's report: each organization's final test, then each of
 * its skills, in the earlier version and in this one. The version is either taught on a
 * never-seen organization (decision 089), whose after comes from its check tasks since it has no
 * final test there any more, or carried to another model (decision 094), measured on the same
 * sealed final test.
 */

/** A score as rows say it, with where the organization stood: "65% · 31 of 48, never seen". */
function said(score: Score, standing: string): string {
  return `${formatPercent(score)} · ${score.pass} of ${score.total}, ${standing}`;
}

/** A skill's score in a row of its own: "65% · 31 of 48". */
function skillSaid(score: Score): string {
  return `${formatPercent(score)} · ${score.pass} of ${score.total}`;
}

export interface SkillPlace {
  type: string;
  label: string;
  before: string | null;
  after: string | null;
}

export interface Place {
  org: string;
  name: string;
  before: string | null;
  after: string | null;
  /** Each skill the final test measured there, in either version. */
  skills: SkillPlace[];
}

/** Each organization's final test before and now, with its skills. */
export function places(
  before: ReportCard | null,
  report: ReportCard,
  job: Job | null,
  run: Run | null,
  moved: string | undefined,
): Place[] {
  const columns = (card: ReportCard | null) =>
    organizationGrid(card?.test.perOrg)?.groups.flatMap((group) => group.columns) ?? [];
  const standing = (seen: boolean) => (seen ? 'taught on' : 'never seen');
  const rows: Place[] = columns(before).map((column) => ({
    org: column.org,
    name: column.name,
    before: said(column.score, standing(column.group === 'seen')),
    after: null,
    skills: [],
  }));
  for (const column of columns(report)) {
    const now = said(column.score, standing(column.group === 'seen'));
    const row = rows.find((item) => item.org === column.org);
    if (row) row.after = now;
    else rows.push({ org: column.org, name: column.name, before: null, after: now, skills: [] });
  }
  const skillsAt = (card: ReportCard | null, org: string) =>
    (card?.test.perOrg ?? []).filter((result) => result.org === org && result.total > 0);
  for (const row of rows) {
    for (const [side, card] of [
      ['before', before],
      ['after', report],
    ] as const) {
      for (const result of skillsAt(card, row.org)) {
        let skill = row.skills.find((item) => item.type === result.type);
        if (!skill) {
          skill = { type: result.type, label: result.label, before: null, after: null };
          row.skills.push(skill);
        }
        skill[side] = skillSaid(result);
      }
    }
  }
  // The organization now taught on has no final test here: its check tasks say how it does.
  const movedId =
    moved === undefined ? undefined : job?.organizations?.find((org) => org.name === moved)?.id;
  const checks = run?.devByOrg?.find((score) => score.org === movedId);
  const row = rows.find((item) => item.org === movedId);
  if (row && checks) row.after = said(checks, 'check tasks, taught on');
  return rows;
}
