import { METHOD_LABELS } from '@architect/shared';
import { Badge, Button, DataTable } from '@architect/ui';
import { useGraduates } from '../api/hooks';
import { shortDate } from '../flow/format';
import { navigate, paths } from '../lib/router';
import { bestCandidate, rateOf, type FieldSummary } from './model';
import { scoreCell } from './parts';

/**
 * Every run of the field that took its final test, with its scores on the organizations it was
 * taught on, generated ones it never saw and real ones it never saw. A row opens its report.
 */
export function Candidates({ field }: { field: FieldSummary }) {
  const graduates = useGraduates();
  const best = bestCandidate(field.candidates);
  const agentName = (id: string | undefined) =>
    id === undefined
      ? null
      : (graduates.data?.find((graduate) => graduate.id === id)?.name ?? null);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => navigate(paths.models())}>
          Open Models
        </Button>
      </div>
      <DataTable
        aria-label="Candidates"
        rows={field.candidates}
        rowKey={(candidate) => candidate.run.id}
        onRowClick={(candidate) => navigate(paths.report(candidate.run.id))}
        initialSort={{ key: 'tested', direction: 'descending' }}
        empty="No candidate has taken its final test yet"
        columns={[
          {
            key: 'tested',
            header: 'Tested',
            cell: (candidate) => (
              <span className="flex items-center gap-3">
                {shortDate(candidate.report.createdAt)}
                {candidate === best && <Badge>Best</Badge>}
              </span>
            ),
            sortValue: (candidate) => candidate.report.createdAt,
          },
          {
            key: 'method',
            header: 'Method',
            cell: (candidate) => METHOD_LABELS[candidate.report.method],
            sortValue: (candidate) => METHOD_LABELS[candidate.report.method],
          },
          {
            key: 'student',
            header: 'Student',
            cell: (candidate) => candidate.report.student.label,
            sortValue: (candidate) => candidate.report.student.label,
          },
          {
            key: 'version',
            header: 'Version',
            align: 'end',
            cell: (candidate) => candidate.run.currentVersion,
            sortValue: (candidate) => candidate.run.currentVersion,
          },
          {
            key: 'seen',
            header: 'Seen',
            align: 'end',
            cell: (candidate) => scoreCell(candidate.scores.seen),
            sortValue: (candidate) => rateOf(candidate.scores.seen),
          },
          {
            key: 'unseen',
            header: 'Unseen',
            align: 'end',
            cell: (candidate) => scoreCell(candidate.scores.unseen),
            sortValue: (candidate) => rateOf(candidate.scores.unseen),
          },
          {
            key: 'real',
            header: 'Real',
            align: 'end',
            cell: (candidate) => scoreCell(candidate.scores.real),
            sortValue: (candidate) => rateOf(candidate.scores.real),
          },
          {
            key: 'agent',
            header: 'Agent',
            cell: (candidate) => agentName(candidate.run.graduateId),
            sortValue: (candidate) => agentName(candidate.run.graduateId),
          },
        ]}
      />
    </div>
  );
}
