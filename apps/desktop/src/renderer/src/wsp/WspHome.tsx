import type { WspExperiment } from '@architect/shared';
import { Button, DataTable, EmptyState, Skeleton, useWindowBelow } from '@architect/ui';
import { FlaskConical, Plus } from 'lucide-react';
import { useWspExperiments } from '../api/wsp';
import { ProblemState } from '../components/ProblemState';
import { formatCost, shortDate } from '../flow/format';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { bestChange, metricOf, METRIC_WORDS, pointsText, STAGE_WORDS, STATUS_WORDS } from './model';

/** What a row's mentor spent of its cap; before it starts, only the cap. */
function MentorSpend({ experiment }: { experiment: WspExperiment }) {
  const cap = formatCost(experiment.limits.mentorUsd);
  const used = experiment.costs.mentorUsd;
  if (experiment.approval === null && used === 0) return <span>Up to {cap}</span>;
  return (
    <span className={used > experiment.limits.mentorUsd ? 'text-danger' : undefined}>
      <span className="font-medium">{formatCost(used)}</span> of {cap}
    </span>
  );
}

/** Architect WSP's home: every weight-space programming experiment on this computer. */
export function WspHome() {
  const experiments = useWspExperiments();
  const narrow = useWindowBelow(1280);
  const create = (
    <Button variant="primary" size="md" onClick={() => navigate(paths.wspNew())}>
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
            description="Have a model's weights edited for one behavior, and every edit measured."
            className="pt-16"
            actions={create}
          />
        ) : (
          <DataTable
            aria-label="Experiments"
            rows={rows}
            rowKey={(experiment) => experiment.id}
            onRowClick={(experiment) => navigate(paths.wspExperiment(experiment.id))}
            initialSort={{ key: 'created', direction: 'descending' }}
            columns={[
              {
                key: 'title',
                header: 'Experiment',
                sortValue: (experiment) => experiment.title,
                cell: (experiment) => <span className="text-pretty">{experiment.title}</span>,
              },
              {
                key: 'model',
                header: 'Base model',
                sortValue: (experiment) => experiment.base.name,
                cell: (experiment) => (
                  <span className="whitespace-nowrap">{experiment.base.name}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                sortValue: (experiment) => STATUS_WORDS[experiment.status],
                cell: (experiment) => (
                  <span className="whitespace-nowrap">{STATUS_WORDS[experiment.status]}</span>
                ),
              },
              {
                key: 'stage',
                header: 'Stage',
                hidden: narrow,
                cell: (experiment) =>
                  experiment.approval === null ? null : (
                    <span className="whitespace-nowrap">{STAGE_WORDS[experiment.stage]}</span>
                  ),
              },
              {
                key: 'best',
                header: 'Best change',
                hint: "The most a candidate moved the brief's metric on dev, against the base",
                align: 'end',
                sortValue: (experiment) => bestChange(experiment),
                cell: (experiment) => {
                  const best = bestChange(experiment);
                  return best === null ? null : (
                    <span className="whitespace-nowrap" title={METRIC_WORDS[metricOf(experiment)]}>
                      {pointsText(best)}
                    </span>
                  );
                },
              },
              {
                key: 'mentor',
                header: 'Mentor spend',
                align: 'end',
                cell: (experiment) => (
                  <span className="whitespace-nowrap">
                    <MentorSpend experiment={experiment} />
                  </span>
                ),
              },
              {
                key: 'created',
                header: 'Created',
                align: 'end',
                sortValue: (experiment) => experiment.createdAt,
                cell: (experiment) => (
                  <span className="whitespace-nowrap">{shortDate(experiment.createdAt)}</span>
                ),
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
