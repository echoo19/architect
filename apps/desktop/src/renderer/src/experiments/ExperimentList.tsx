import type { ExperimentRecord } from '@architect/shared';
import { Button, DataTable, defineTerm, EmptyState, Skeleton, useWindowBelow } from '@architect/ui';
import { FlaskConical, Plus } from 'lucide-react';
import { useExperiment, useExperiments } from '../api/experiments';
import { ProblemState } from '../components/ProblemState';
import { formatCost, shortDate } from '../flow/format';
import { useSettings } from '../api/hooks';
import { mentorName, shortModelName, studentName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { ARM_NAMES, STATUS_WORDS } from './model';

/** States in which an experiment has spent nothing: only its cap is known. */
const NOT_STARTED = new Set<ExperimentRecord['status']>(['draft', 'calibrating', 'preregistered']);

/**
 * What one experiment spent of a kind, against its total cap, with the model that spent it under
 * it, since the list spans fields taught by different models. Before it starts there is no spend
 * to show, only the cap: "Up to $6.00".
 */
function SpendCell({
  record,
  kind,
  heading,
}: {
  record: ExperimentRecord;
  kind: 'sparkUsd' | 'studentUsd';
  /** The model the column is headed by; a cell names its own model only when it is another. */
  heading: string | undefined;
}) {
  const detail = useExperiment(record.id);
  const cap = formatCost(record.input.caps[kind]);
  const spent = NOT_STARTED.has(record.status) ? undefined : detail.data?.report?.totals[kind];
  const names = detail.data?.names;
  const model = names && shortModelName(kind === 'sparkUsd' ? names.mentor : names.student);
  return (
    <span className="flex flex-col items-end whitespace-nowrap leading-5">
      {spent === undefined || spent === null ? (
        <span>Up to {cap}</span>
      ) : (
        <span className={spent > record.input.caps[kind] ? 'text-danger' : undefined}>
          <span className="font-medium">{formatCost(spent)}</span> of {cap}
        </span>
      )}
      {model && model !== heading && <span className="text-small">{model}</span>}
    </span>
  );
}

/** Experiments: comparisons of ways of teaching, each designed, preregistered and run here. */
export function ExperimentsScreen() {
  const experiments = useExperiments();
  const settings = useSettings();
  // On a narrow window the arms and the date step aside, so each figure keeps one line; the
  // date still sorts the list.
  const narrow = useWindowBelow(1280);
  // The spend columns are headed by the models that spent it, as the rest of the Lab names them.
  const mentor = settings.data ? mentorName(settings.data.defaultMentor) : undefined;
  const student = settings.data ? studentName(settings.data.defaultStudent) : undefined;
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
            description="Compare harnesses on one field, preregistered before anything runs."
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
                cell: (record) => <span className="text-pretty">{record.input.name}</span>,
              },
              {
                key: 'status',
                header: 'Status',
                sortValue: (record) => STATUS_WORDS[record.status],
                cell: (record) => (
                  <span className="whitespace-nowrap">{STATUS_WORDS[record.status]}</span>
                ),
              },
              {
                key: 'field',
                header: 'Field',
                sortValue: (record) => record.job.name,
                cell: (record) => <span className="whitespace-nowrap">{record.job.name}</span>,
              },
              {
                key: 'arms',
                header: 'Arms',
                hint: defineTerm('arm'),
                align: 'end',
                hidden: narrow,
                sortValue: (record) => record.input.arms.length,
                cell: (record) => (
                  <span title={record.input.arms.map((item) => ARM_NAMES[item.arm]).join(', ')}>
                    {record.input.arms.length}
                  </span>
                ),
              },
              {
                key: 'spark',
                header: `${mentor ?? 'Teacher'} spend`,
                hint: "What the field's teacher spent of its cap",
                align: 'end',
                cell: (record) => <SpendCell record={record} kind="sparkUsd" heading={mentor} />,
              },
              {
                key: 'student',
                header: `${student ?? 'Specialist'} spend`,
                hint: 'What its hosted copy spent of its cap while it practiced',
                align: 'end',
                cell: (record) => <SpendCell record={record} kind="studentUsd" heading={student} />,
              },
              {
                key: 'created',
                header: 'Created',
                align: 'end',
                hidden: narrow,
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
