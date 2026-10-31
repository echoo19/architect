import { Fragment, useState } from 'react';
import type { FieldView, Job, ReportCard, Run } from '@architect/shared';
import { Button } from '@architect/ui';
import { api } from '../../api/client';
import { graduatesApi } from '../../api/graduates';
import { useQuery } from '../../api/query';
import { bestCandidate, readField } from '../../fields/model';
import { newerVersion, TeachOnDialog } from '../../fields/TeachOn';
import { shortModelName } from '../../lib/names';
import { Section } from '../ledger';
import { places } from './before-after';
import type { OrgGrid } from './org-grid';
import { Organizations } from './Organizations';

/*
 * Later versions of a field in the Lab: the report's grid offers to teach on each never-seen
 * organization in a new version (decision 089), and a version made that way, or by carrying the
 * field to another model (decision 094), shows each organization and its skills before and
 * after: against the best version of the field it came from, or the version it carried.
 */

/** The card a later version is read against: the version it carried, else the earlier best. */
async function earlierCard(versionOf: NonNullable<FieldView['versionOf']>) {
  const carried = versionOf.model?.carried;
  if (carried !== undefined) return graduatesApi.report(carried.graduateId, carried.version);
  return bestCandidate((await readField(versionOf.jobId)).candidates)?.report ?? null;
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
  const earlier = useQuery(`field-earlier:${report.jobId}`, () => earlierCard(versionOf));
  if (earlier.status !== 'success') return null;
  const rows = places(earlier.data, report, job, run, versionOf.org);
  const { model } = versionOf;
  const heading = (name: string, on: string | undefined) => (on ? `${name} · ${on}` : name);
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
                {heading(versionOf.name, model?.from)}
              </th>
              <th scope="col" className="pb-3 pl-6 text-left font-medium">
                {heading(job?.name ?? 'This version', model?.to)}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.org}>
                <tr className="border-t border-line">
                  <th scope="row" className="py-3.5 pr-4 text-left font-medium">
                    {row.name}
                  </th>
                  <td className="py-3.5 pl-6 tabular-nums">{row.before ?? '–'}</td>
                  <td className="py-3.5 pl-6 tabular-nums">{row.after ?? '–'}</td>
                </tr>
                {row.skills.map((skill) => (
                  <tr key={skill.type} className="text-small">
                    <th scope="row" className="pb-2.5 pl-4 pr-4 text-left font-normal">
                      {skill.label}
                    </th>
                    <td className="pb-2.5 pl-6 tabular-nums">{skill.before ?? '–'}</td>
                    <td className="pb-2.5 pl-6 tabular-nums">{skill.after ?? '–'}</td>
                  </tr>
                ))}
              </Fragment>
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
