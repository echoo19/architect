import type { Job, JobSummary } from '@architect/shared';
import { Button, Card, CardRow, DataTable, EmptyState, Skeleton } from '@architect/ui';
import { Library } from 'lucide-react';
import { api } from '../api/client';
import { useJob, useJobs } from '../api/hooks';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

/** Fields: every job that serves several organizations of one field. */
export function FieldsScreen() {
  const jobs = useJobs();
  return (
    <PlacePage title="Fields">
      {jobs.data ? (
        <FieldList jobs={jobs.data} />
      ) : jobs.status === 'error' ? (
        <ProblemState error={jobs.error} title="Couldn't load your jobs" onRetry={jobs.reload} />
      ) : (
        <Skeleton className="h-48 rounded-card" />
      )}
    </PlacePage>
  );
}

function NoFields() {
  return (
    <EmptyState
      icon={<Library aria-hidden />}
      title="No fields yet"
      description="A field is one job taught across several organizations and tested on ones it never saw."
      className="pt-16"
      actions={
        <Button variant="primary" size="md" onClick={() => navigate(paths.newAgent())}>
          Describe a field
        </Button>
      }
    />
  );
}

function FieldList({ jobs }: { jobs: readonly JobSummary[] }) {
  const ids = jobs.map((job) => job.id);
  const read = useQuery(`fields:${ids.join(',')}`, () => Promise.all(ids.map(api.job)));
  if (!read.data) {
    return read.status === 'error' ? (
      <ProblemState error={read.error} title="Couldn't read your jobs" onRetry={read.reload} />
    ) : (
      <Skeleton className="h-48 rounded-card" />
    );
  }
  const fields = read.data.filter(
    (job): job is Job & { organizations: NonNullable<Job['organizations']> } =>
      Boolean(job.organizations),
  );
  if (fields.length === 0) return <NoFields />;
  const summaryOf = (id: string) => jobs.find((job) => job.id === id);
  return (
    <DataTable
      aria-label="Fields"
      rows={fields}
      rowKey={(job) => job.id}
      onRowClick={(job) => navigate(paths.field(job.id))}
      initialSort={{ key: 'name', direction: 'ascending' }}
      columns={[
        { key: 'name', header: 'Field', cell: (job) => job.name, sortValue: (job) => job.name },
        {
          key: 'orgs',
          header: 'Organizations',
          align: 'end',
          cell: (job) => job.organizations.length,
          sortValue: (job) => job.organizations.length,
        },
        {
          key: 'skills',
          header: 'Skills',
          align: 'end',
          cell: (job) => job.taskTypes.length,
          sortValue: (job) => job.taskTypes.length,
        },
        {
          key: 'tasks',
          header: 'Tasks',
          align: 'end',
          cell: (job) => summaryOf(job.id)?.taskCount ?? null,
          sortValue: (job) => summaryOf(job.id)?.taskCount ?? null,
        },
      ]}
    />
  );
}

/** One field: its organizations, and the way into its job. */
export function FieldScreen({ jobId }: { jobId: string }) {
  const job = useJob(jobId);
  if (!job.data) {
    return (
      <PlacePage title="Field">
        {job.status === 'error' ? (
          <ProblemState
            error={job.error}
            title="Couldn't load this field"
            onRetry={job.reload}
            exit={{ label: 'All fields', onClick: () => navigate(paths.fields()) }}
          />
        ) : (
          <Skeleton className="h-48 rounded-card" />
        )}
      </PlacePage>
    );
  }
  const orgs = job.data.organizations ?? [];
  return (
    <PlacePage
      title={job.data.name}
      action={
        <Button variant="primary" size="md" onClick={() => navigate(paths.define(jobId))}>
          Open the job
        </Button>
      }
    >
      <Card title="Organizations" flush className="max-w-[720px]">
        {orgs.length === 0 ? (
          <p className="m-0 px-6 pb-6 text-ui">This job serves one organization</p>
        ) : (
          orgs.map((org) => (
            <CardRow key={org.id} title={org.name} end={org.synthetic ? 'Generated' : 'Real'} />
          ))
        )}
      </Card>
    </PlacePage>
  );
}
