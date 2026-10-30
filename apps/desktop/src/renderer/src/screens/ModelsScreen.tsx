import type { GraduateSummary } from '@architect/shared';
import { AgentAvatar, Button, DataTable, EmptyState, Skeleton } from '@architect/ui';
import { Boxes } from 'lucide-react';
import { useGraduates } from '../api/hooks';
import { ProblemState } from '../components/ProblemState';
import { activeVersionName, agentModelName } from '../lib/names';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';
import { openAgent } from '../lab/open-agent';

const STATUS: Record<GraduateSummary['status'], string> = {
  ready: 'Ready',
  needs_attention: 'Needs a look',
  blocked: 'Blocked',
  unchecked: 'Not checked',
};

/** Models: every agent on this computer, with the model it runs on and its version. */
export function ModelsScreen() {
  const graduates = useGraduates();
  return (
    <PlacePage title="Models">
      {graduates.data ? (
        graduates.data.length === 0 ? (
          <EmptyState
            icon={<Boxes aria-hidden />}
            title="No models yet"
            description="Each agent Architect teaches is kept here, with every version of it."
            className="pt-16"
            actions={
              <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
                New agent
              </Button>
            }
          />
        ) : (
          <DataTable
            aria-label="Models"
            rows={graduates.data}
            rowKey={(graduate) => graduate.id}
            onRowClick={openAgent}
            initialSort={{ key: 'name', direction: 'ascending' }}
            columns={[
              {
                key: 'name',
                header: 'Agent',
                sortValue: (graduate) => graduate.name,
                cell: (graduate) => (
                  <span className="flex items-center gap-2.5">
                    <AgentAvatar name={graduate.name} />
                    {graduate.name}
                  </span>
                ),
              },
              {
                key: 'model',
                header: 'Base model',
                sortValue: (graduate) => agentModelName(graduate.manifest.student),
                cell: (graduate) => agentModelName(graduate.manifest.student),
              },
              {
                key: 'version',
                header: 'Version',
                sortValue: (graduate) => graduate.activeVersion,
                cell: (graduate) => activeVersionName(graduate),
              },
              {
                key: 'versions',
                header: 'Versions',
                align: 'end',
                sortValue: (graduate) => graduate.versions,
                cell: (graduate) => graduate.versions,
              },
              {
                key: 'status',
                header: 'Status',
                sortValue: (graduate) => STATUS[graduate.status],
                cell: (graduate) => STATUS[graduate.status],
              },
            ]}
          />
        )
      ) : graduates.status === 'error' ? (
        <ProblemState
          error={graduates.error}
          title="Couldn't load your agents"
          onRetry={graduates.reload}
        />
      ) : (
        <Skeleton className="h-48 rounded-card" />
      )}
    </PlacePage>
  );
}
