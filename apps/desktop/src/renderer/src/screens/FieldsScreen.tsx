import { useState } from 'react';
import { Button, DataTable, EmptyState, PageTabs, Skeleton } from '@architect/ui';
import { Boxes, Building2, LayoutGrid, Library, Package } from 'lucide-react';
import { useJobs } from '../api/hooks';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { Assets } from '../fields/Assets';
import { Candidates } from '../fields/Candidates';
import {
  bestCandidate,
  fieldKey,
  orgCounts,
  rateOf,
  readField,
  type FieldSummary,
} from '../fields/model';
import { Organizations } from '../fields/Organizations';
import { Overview } from '../fields/Overview';
import { scoreCell } from '../fields/parts';
import { shortDate } from '../flow/format';
import { navigate, paths } from '../lib/router';
import { PlacePage } from '../shell/PlacePage';

const newField = () => navigate(paths.newAgent());

/** Fields: every job, each a field of one or several organizations, with its best candidate. */
export function FieldsScreen() {
  const jobs = useJobs();
  return (
    <PlacePage
      title="Fields"
      action={
        <Button variant="primary" size="md" onClick={newField}>
          New field
        </Button>
      }
    >
      {jobs.data ? (
        jobs.data.length === 0 ? (
          <NoFields />
        ) : (
          <FieldList ids={jobs.data.map((job) => job.id)} />
        )
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
      description="A field is one job taught across organizations and tested on ones it never saw."
      className="pt-16"
    />
  );
}

function FieldList({ ids }: { ids: readonly string[] }) {
  const read = useQuery(`fields:${ids.join(',')}`, () => Promise.all(ids.map(readField)));
  if (!read.data) {
    return read.status === 'error' ? (
      <ProblemState error={read.error} title="Couldn't read your fields" onRetry={read.reload} />
    ) : (
      <Skeleton aria-busy="true" className="h-48 rounded-card" />
    );
  }
  const rows = read.data.map((field) => ({
    field,
    counts: orgCounts(field.view),
    best: bestCandidate(field.candidates)?.scores ?? null,
  }));
  return (
    <DataTable
      aria-label="Fields"
      rows={rows}
      rowKey={(row) => row.field.job.id}
      onRowClick={(row) => navigate(paths.field(row.field.job.id))}
      initialSort={{ key: 'activity', direction: 'descending' }}
      columns={[
        {
          key: 'name',
          header: 'Field',
          cell: (row) => row.field.job.name,
          sortValue: (row) => row.field.job.name,
        },
        {
          key: 'taught',
          header: 'Taught on',
          align: 'end',
          cell: (row) => row.counts.taughtOn,
          sortValue: (row) => row.counts.taughtOn,
        },
        {
          key: 'sealed',
          header: 'Sealed',
          align: 'end',
          cell: (row) => row.counts.sealed,
          sortValue: (row) => row.counts.sealed,
        },
        {
          key: 'realOrgs',
          header: 'Real orgs',
          align: 'end',
          cell: (row) => row.counts.real,
          sortValue: (row) => row.counts.real,
        },
        {
          key: 'seen',
          header: 'Seen',
          align: 'end',
          cell: (row) => scoreCell(row.best?.seen ?? null),
          sortValue: (row) => rateOf(row.best?.seen),
        },
        {
          key: 'unseen',
          header: 'Unseen',
          align: 'end',
          cell: (row) => scoreCell(row.best?.unseen ?? null),
          sortValue: (row) => rateOf(row.best?.unseen),
        },
        {
          key: 'real',
          header: 'Real',
          align: 'end',
          cell: (row) => scoreCell(row.best?.real ?? null),
          sortValue: (row) => rateOf(row.best?.real),
        },
        {
          key: 'activity',
          header: 'Last activity',
          align: 'end',
          cell: (row) => shortDate(row.field.lastActivity),
          sortValue: (row) => row.field.lastActivity,
        },
      ]}
    />
  );
}

type FieldTab = 'overview' | 'organizations' | 'candidates' | 'assets';

const TABS = [
  { value: 'overview', label: 'Overview', icon: <LayoutGrid strokeWidth={1.8} /> },
  { value: 'organizations', label: 'Organizations', icon: <Building2 strokeWidth={1.8} /> },
  { value: 'candidates', label: 'Candidates', icon: <Boxes strokeWidth={1.8} /> },
  { value: 'assets', label: 'Assets', icon: <Package strokeWidth={1.8} /> },
] as const;

/** One field: its overview, organizations, candidates and assets, a tab each. */
export function FieldScreen({ jobId }: { jobId: string }) {
  const read = useQuery(fieldKey(jobId), () => readField(jobId));
  if (!read.data) {
    return (
      <PlacePage title="Field">
        {read.status === 'error' ? (
          <ProblemState
            error={read.error}
            title="Couldn't load this field"
            onRetry={read.reload}
            exit={{ label: 'All fields', onClick: () => navigate(paths.fields()) }}
          />
        ) : (
          <Skeleton aria-busy="true" className="h-48 rounded-card" />
        )}
      </PlacePage>
    );
  }
  return <Field field={read.data} />;
}

function Field({ field }: { field: FieldSummary }) {
  const [tab, setTab] = useState<FieldTab>('overview');
  const { job } = field;
  return (
    <PlacePage
      title={job.name}
      action={
        <Button size="md" onClick={() => navigate(paths.define(job.id))}>
          Open the job
        </Button>
      }
    >
      <PageTabs aria-label={job.name} tabs={TABS} value={tab} onValueChange={setTab}>
        {tab === 'overview' && <Overview field={field} />}
        {tab === 'organizations' && <Organizations view={field.view} />}
        {tab === 'candidates' && <Candidates field={field} />}
        {tab === 'assets' && <Assets jobId={job.id} />}
      </PageTabs>
    </PlacePage>
  );
}
