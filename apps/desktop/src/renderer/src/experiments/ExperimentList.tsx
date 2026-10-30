import type { ExperimentRecord } from '@architect/shared';
import { Button, DataTable, EmptyState, Skeleton } from '@architect/ui';
import { FlaskConical, Plus } from 'lucide-react';
import { useExperiment, useExperiments } from '../api/experiments';
import { ProblemState } from '../components/ProblemState';
import { formatCost, shortDate } from '../flow/format';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { ARM_NAMES, STATUS_WORDS } from './model';

/** What one experiment spent of a kind, against its total cap; absent before it ran. */
function SpendCell({
  record,
  kind,
}: {
  record: ExperimentRecord;
  kind: 'sparkUsd' | 'studentUsd';
}) {
  const detail = useExperiment(record.id);
  const spent = detail.data?.report?.totals[kind];
  const cap = formatCost(record.input.caps[kind]);
  if (spent === undefined || spent === null) {
    return (
      <span>
        <span aria-hidden>–</span>
        <span className="sr-only">None</span> of {cap}
      </span>
    );
  }
  return (
    <span className={spent > record.input.caps[kind] ? 'text-danger' : undefined}>
      <span className="font-medium">{formatCost(spent)}</span> of {cap}
    </span>
  );
}

/** Experiments: comparisons of ways of teaching, each designed, preregistered and run here. */
export function ExperimentsScreen() {
  const experiments = useExperiments();
  const create = (
    <Button variant="primary" size="md" onClick={() => navigate(paths.newExperiment())}>
      <Plus size={16} aria-hidden />
      New experiment
    </Button>
  );
  const rows = experiments.data;
  return (
    <PlacePage title="Experiments" action={rows && rows.length > 0 ? create : undefined}>
      {rows ? (
        rows.length === 0 ? (
          <EmptyState
            icon={<FlaskConical aria-hidden />}
            title="No experiments yet"
            description="Compare ways of teaching on one field, with the seeds and caps fixed before it runs."
            className="pt-16"
            actions={create}
          />
        ) : (
          <DataTable
            aria-label="Experiments"
            rows={rows}
            rowKey={(record) => record.id}
            onRowClick={(record) => navigate(paths.experiment(record.id))}
            initialSort={{ key: 'created', direction: 'descending' }}
            columns={[
              {
                key: 'name',
                header: 'Experiment',
                sortValue: (record) => record.input.name,
                cell: (record) => <span className="block truncate">{record.input.name}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                width: '128px',
                sortValue: (record) => STATUS_WORDS[record.status],
                cell: (record) => STATUS_WORDS[record.status],
              },
              {
                key: 'field',
                header: 'Field',
                sortValue: (record) => record.job.name,
                cell: (record) => record.job.name,
              },
              {
                key: 'arms',
                header: 'Arms',
                align: 'end',
                width: '88px',
                sortValue: (record) => record.input.arms.length,
                cell: (record) => (
                  <span title={record.input.arms.map((item) => ARM_NAMES[item.arm]).join(', ')}>
                    {record.input.arms.length}
                  </span>
                ),
              },
              {
                key: 'spark',
                header: 'Spark',
                align: 'end',
                width: '150px',
                cell: (record) => <SpendCell record={record} kind="sparkUsd" />,
              },
              {
                key: 'student',
                header: 'Student',
                align: 'end',
                width: '150px',
                cell: (record) => <SpendCell record={record} kind="studentUsd" />,
              },
              {
                key: 'created',
                header: 'Created',
                align: 'end',
                width: '112px',
                sortValue: (record) => record.createdAt,
                cell: (record) => shortDate(record.createdAt),
              },
            ]}
          />
        )
      ) : experiments.status === 'error' ? (
        <ProblemState
          error={experiments.error}
          title="Couldn't load your experiments"
          onRetry={experiments.reload}
        />
      ) : (
        <Skeleton className="h-48 rounded-card" />
      )}
    </PlacePage>
  );
}
