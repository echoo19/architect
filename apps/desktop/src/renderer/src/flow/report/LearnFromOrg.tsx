import { useState } from 'react';
import type { FieldView, Job, ReportCard, Run, Score } from '@architect/shared';
import { Button } from '@architect/ui';
import { api } from '../../api/client';
import { useQuery } from '../../api/query';
import { bestCandidate, readField } from '../../fields/model';
import { newerVersion, TeachOnDialog } from '../../fields/TeachOn';
import { formatPercent } from '../../lib/format';
import { shortModelName } from '../../lib/names';
import { Section } from '../ledger';
import { organizationGrid, type OrgGrid } from './org-grid';
import { Organizations } from './Organizations';

/*
 * Learning from a never-seen organization in the Lab (decision 089): the report's grid offers to
 * teach on each one in a new version of the field, and a version made that way shows each
 * organization before and after, against the best version of the field it came from.
 */

/** A score as rows say it, with where the organization stood: "65% · 31 of 48, never seen". */
function said(score: Score, standing: string): string {
  return `${formatPercent(score)} · ${score.pass} of ${score.total}, ${standing}`;
}

interface Place {
  org: string;
  name: string;
  before: string | null;
  after: string | null;
}

/** Each organization's final test before, in the best version of the earlier field, and now. */
function places(
  before: ReportCard | null,
  report: ReportCard,
  job: Job | null,
  run: Run | null,
  moved: string,
): Place[] {
  const columns = (card: ReportCard | null) =>
    organizationGrid(card?.test.perOrg)?.groups.flatMap((group) => group.columns) ?? [];
  const standing = (seen: boolean) => (seen ? 'taught on' : 'never seen');
  const rows: Place[] = columns(before).map((column) => ({
    org: column.org,
    name: column.name,
    before: said(column.score, standing(column.group === 'seen')),
    after: null,
  }));
  for (const column of columns(report)) {
    const now = said(column.score, standing(column.group === 'seen'));
    const row = rows.find((item) => item.org === column.org);
    if (row) row.after = now;
    else rows.push({ org: column.org, name: column.name, before: null, after: now });
  }
  // The organization now taught on has no final test here: its check tasks say how it does.
  const movedId = job?.organizations?.find((org) => org.name === moved)?.id;
  const checks = run?.devByOrg?.find((score) => score.org === movedId);
  const row = rows.find((item) => item.org === movedId);
  if (row && checks) row.after = said(checks, 'check tasks, taught on');
  return rows;
}

function BeforeAfter({
  versionOf,
  report,
  job,
  run,
}: {
  versionOf: NonNullable<FieldView['versionOf']>;
  report: ReportCard;
  job: Job | null;
  run: Run | null;
}) {
  const earlier = useQuery(`field-best:${versionOf.jobId}`, async () =>
    bestCandidate((await readField(versionOf.jobId)).candidates),
  );
  if (earlier.status !== 'success') return null;
  const rows = places(earlier.data?.report ?? null, report, job, run, versionOf.org);
  return (
    <Section title="Before and after" id="before-after">
      <div className="overflow-x-auto border-b border-line">
        <table
          aria-label="Each organization before and after"
          className="w-full min-w-[640px] table-fixed border-collapse text-ui"
        >
          <thead>
            <tr>
              <th className="w-[30%]" />
              <th scope="col" className="pb-3 pl-6 text-left font-medium">
                {versionOf.name}
              </th>
              <th scope="col" className="pb-3 pl-6 text-left font-medium">
                {job?.name ?? 'This version'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.org} className="border-t border-line">
                <th scope="row" className="py-3.5 pr-4 text-left font-normal">
                  {row.name}
                </th>
                <td className="py-3.5 pl-6 tabular-nums">{row.before ?? '–'}</td>
                <td className="py-3.5 pl-6 tabular-nums">{row.after ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

/**
 * The report's grid in the Lab: each never-seen organization of the newest version of a field
 * can be taught on, and a version made by teaching on one shows each organization before and
 * after.
 */
export function LabOrganizations({
  grid,
  report,
  job,
  run,
}: {
  grid: OrgGrid;
  report: ReportCard;
  job: Job | null;
  run: Run | null;
}) {
  const field = useQuery(`field-view:${report.jobId}`, () => api.field(report.jobId));
  const [teaching, setTeaching] = useState<string | null>(null);
  const view = field.data ?? null;
  const open = view !== null && newerVersion(view) === null;
  const sealed = new Set(view?.sealed.map((org) => org.name));
  return (
    <div className="flex flex-col gap-12">
      <Organizations
        grid={grid}
        columnAction={(column) =>
          open && job !== null && sealed.has(column.name) ? (
            <Button
              variant="ghost"
              size="sm"
              className="-ml-2.5 mt-1"
              aria-label={`Teach on ${column.name}`}
              onClick={() => setTeaching(column.name)}
            >
              Teach on it
            </Button>
          ) : null
        }
      />
      {view?.versionOf !== undefined && (
        <BeforeAfter versionOf={view.versionOf} report={report} job={job} run={run} />
      )}
      {teaching !== null && view !== null && job !== null && (
        <TeachOnDialog
          view={view}
          jobName={job.name}
          org={teaching}
          teacher={shortModelName(job.mentor.label)}
          onClose={() => setTeaching(null)}
        />
      )}
    </div>
  );
}
