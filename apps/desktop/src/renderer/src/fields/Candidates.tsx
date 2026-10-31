import { METHOD_LABELS } from '@architect/shared';
import { Badge, DataTable } from '@architect/ui';
import { useGraduates } from '../api/hooks';
import { shortDate } from '../flow/format';
import { shortModelName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { useRegistry, versionOfRun } from '../models/load';
import { bestCandidate, rateOf, type Candidate, type FieldSummary } from './model';
import { scoreCell } from './parts';

/**
 * Every version of the field that took its final test, with its scores on the organizations it
 * was taught on, generated ones it never saw and real ones it never saw. A row opens the version
 * in Models with its panel open, or the run's results while no agent holds it.
 */
export function Candidates({ field }: { field: FieldSummary }) {
  const graduates = useGraduates();
  const registry = useRegistry();
  const versionOf = (candidate: Candidate) =>
    registry.data ? versionOfRun(registry.data, candidate.run.id) : undefined;
  const open = (candidate: Candidate) => {
    const version = versionOf(candidate);
    navigate(version ? paths.models(version.key) : paths.report(candidate.run.id));
  };
  const best = bestCandidate(field.candidates);
  /** The agent that holds it, with the version it is there: "Academy desk v2". */
  const agentName = (candidate: Candidate) => {
    const id = candidate.run.graduateId;
    const name =
      id === undefined ? null : graduates.data?.find((graduate) => graduate.id === id)?.name;
    if (!name) return null;
    const version = versionOf(candidate);
    return version ? `${name} v${version.version.version}` : name;
  };
  return (
    <div className="flex flex-col gap-4">
      <DataTable
        aria-label="Versions"
        rows={field.candidates}
        rowKey={(candidate) => candidate.run.id}
        onRowClick={open}
        initialSort={{ key: 'tested', direction: 'descending' }}
        empty="No version has taken its final test yet"
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
            header: 'Model',
            cell: (candidate) => shortModelName(candidate.report.student.label),
            sortValue: (candidate) => candidate.report.student.label,
          },
          {
            key: 'harness',
            header: 'Harness',
            align: 'end',
            cell: (candidate) => `v${candidate.run.currentVersion}`,
            sortValue: (candidate) => candidate.run.currentVersion,
          },
          {
            key: 'seen',
            header: 'Taught on',
            align: 'end',
            cell: (candidate) => scoreCell(candidate.scores.seen),
            sortValue: (candidate) => rateOf(candidate.scores.seen),
          },
          {
            key: 'unseen',
            header: 'Never seen',
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
            cell: agentName,
            sortValue: agentName,
          },
        ]}
      />
    </div>
  );
}
