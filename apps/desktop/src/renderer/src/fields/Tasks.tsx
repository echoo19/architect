import { useState } from 'react';
import type { BrowsableSplit, Expected, Job, Task, TaskListing } from '@architect/shared';
import {
  DataTable,
  DetailList,
  Drawer,
  DrawerContent,
  DrawerSection,
  Segmented,
  Select,
  Skeleton,
  Tooltip,
} from '@architect/ui';
import { Lock } from 'lucide-react';
import { api } from '../api/client';
import { useQuery } from '../api/query';
import { ProblemState } from '../components/ProblemState';
import { taskTitle } from '../flow/format';
import { typeLabel } from '../flow/names';
import { count, plural } from './parts';

/*
 * A field's tasks as a developer reads them (decision 084): the practice and check tasks in full,
 * filtered by type and organization, each opening beside the table. The final test and the
 * calibration tasks are sealed, so they show as counts and nothing else.
 */

const SPLIT_WORDS: Record<BrowsableSplit, string> = { train: 'Practice', dev: 'Check' };

const EXPECTED_WORDS: Record<Expected['kind'], string> = {
  answer: 'Answer',
  facts: 'Facts',
  end_state: 'End state',
};

const ALL = 'all';

interface Listings {
  train: TaskListing;
  dev: TaskListing;
  calibration: TaskListing;
  test: TaskListing;
}

async function readListings(jobId: string): Promise<Listings> {
  const [train, dev, calibration, test] = await Promise.all([
    api.tasks(jobId, 'train'),
    api.tasks(jobId, 'dev'),
    api.tasks(jobId, 'calibration'),
    api.tasks(jobId, 'test'),
  ]);
  return { train, dev, calibration, test };
}

const tasksOf = (listing: TaskListing): Task[] => ('tasks' in listing ? listing.tasks : []);

export function Tasks({ job }: { job: Job }) {
  const read = useQuery(`fieldTasks:${job.id}`, () => readListings(job.id));
  if (!read.data) {
    return read.status === 'error' ? (
      <ProblemState
        error={read.error}
        title="Couldn't read this field's tasks"
        onRetry={read.reload}
      />
    ) : (
      <Skeleton aria-busy="true" className="h-48 rounded-card" />
    );
  }
  return <TaskBrowser job={job} listings={read.data} />;
}

function TaskBrowser({ job, listings }: { job: Job; listings: Listings }) {
  const [split, setSplit] = useState<BrowsableSplit>('train');
  const [type, setType] = useState(ALL);
  const [org, setOrg] = useState(ALL);
  const [open, setOpen] = useState<Task | null>(null);
  const [shown, setShown] = useState(false);
  const orgs = (job.organizations ?? []).filter((item) => item.role === 'train');
  const orgName = (id: string | undefined) =>
    id === undefined ? undefined : (orgs.find((item) => item.id === id)?.name ?? id);
  const rows = tasksOf(listings[split]).filter(
    (task) => (type === ALL || task.type === type) && (org === ALL || task.org === org),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented<BrowsableSplit>
          aria-label="Tasks"
          value={split}
          onValueChange={setSplit}
          options={(['train', 'dev'] as const).map((value) => ({
            value,
            label: `${SPLIT_WORDS[value]} ${count(listings[value].count)}`,
          }))}
        />
        <Select
          aria-label="Type"
          value={type}
          onValueChange={setType}
          options={[
            { value: ALL, label: 'Every type' },
            ...job.taskTypes.map((item) => ({ value: item.id, label: item.label })),
          ]}
        />
        {orgs.length > 0 && (
          <Select
            aria-label="Organization"
            value={org}
            onValueChange={setOrg}
            options={[
              { value: ALL, label: 'Every organization' },
              ...orgs.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
        )}
        <div className="ml-auto flex items-center gap-5 text-ui">
          <Sealed label="Final test" count={listings.test.count} />
          {listings.calibration.count > 0 && (
            <Sealed label="Calibration" count={listings.calibration.count} />
          )}
        </div>
      </div>
      <DataTable
        aria-label={`${SPLIT_WORDS[split]} tasks`}
        rows={rows}
        rowKey={(task) => task.id}
        maxHeight={600}
        selectedKey={shown ? open?.id : undefined}
        onRowClick={(task) => {
          setOpen(task);
          setShown(true);
        }}
        empty="No tasks match"
        columns={[
          {
            key: 'request',
            header: 'Request',
            cell: (task) => (
              <span className="block max-w-[360px] truncate font-normal" title={task.prompt}>
                {taskTitle(task.prompt)}
              </span>
            ),
          },
          {
            key: 'type',
            header: 'Type',
            cell: (task) => <span className="whitespace-nowrap">{typeLabel(job, task.type)}</span>,
            sortValue: (task) => typeLabel(job, task.type),
          },
          ...(orgs.length > 0
            ? [
                {
                  key: 'org',
                  header: 'Organization',
                  cell: (task: Task) => (
                    <span className="whitespace-nowrap">{orgName(task.org)}</span>
                  ),
                  sortValue: (task: Task) => orgName(task.org),
                },
              ]
            : []),
          {
            key: 'expected',
            header: 'Expected',
            cell: (task) => EXPECTED_WORDS[task.expected.kind],
            sortValue: (task) => EXPECTED_WORDS[task.expected.kind],
          },
          {
            key: 'family',
            header: 'Family',
            cell: (task) => (
              <span className="block max-w-[180px] truncate font-mono text-small">
                {task.family}
              </span>
            ),
            sortValue: (task) => task.family,
          },
        ]}
      />
      <Drawer open={shown} onOpenChange={setShown}>
        {open && (
          <TaskPanel
            task={open}
            type={typeLabel(job, open.type)}
            org={orgName(open.org)}
            split={split}
          />
        )}
      </Drawer>
    </div>
  );
}

/** A sealed split by its count, with a lock: nothing else of it leaves the vault. */
function Sealed({ label, count: tasks }: { label: string; count: number }) {
  return (
    <Tooltip content="Sealed: only the count is shown" side="bottom">
      <span tabIndex={0} className="inline-flex items-center gap-1.5 tabular-nums">
        <Lock size={14} strokeWidth={1.8} aria-hidden />
        {label} {plural(tasks, 'task')}
      </span>
    </Tooltip>
  );
}

function TaskPanel({
  task,
  type,
  org,
  split,
}: {
  task: Task;
  type: string;
  org: string | undefined;
  split: BrowsableSplit;
}) {
  return (
    <DrawerContent
      title={taskTitle(task.prompt)}
      subtitle={[type, org, `${SPLIT_WORDS[split]} task`].filter(Boolean).join(' · ')}
    >
      <div className="flex flex-col gap-7">
        <DrawerSection title="Request">
          <p className="m-0 whitespace-pre-wrap break-words rounded-control bg-field px-3 py-2 text-ui">
            {task.prompt}
          </p>
        </DrawerSection>
        <DrawerSection title={`Expected ${EXPECTED_WORDS[task.expected.kind].toLowerCase()}`}>
          <pre className="m-0 overflow-auto whitespace-pre-wrap break-words rounded-control bg-field px-3 py-2 font-mono text-small">
            {expectedText(task.expected)}
          </pre>
        </DrawerSection>
        <DetailList
          items={[
            { label: 'Task', value: task.id },
            { label: 'Family', value: task.family },
            ...(task.org === undefined ? [] : [{ label: 'Organization', value: task.org }]),
          ]}
        />
      </div>
    </DrawerContent>
  );
}

/** What a task is checked against, as a person reads it. */
function expectedText(expected: Expected): string {
  const json = (value: unknown) => JSON.stringify(value, null, 2);
  switch (expected.kind) {
    case 'answer':
      return json(expected.value);
    case 'facts':
      return expected.facts
        .map((fact) => `${fact.path} = ${JSON.stringify(fact.value)}`)
        .join('\n');
    case 'end_state':
      return [
        `${expected.validator}(${JSON.stringify(expected.params)})`,
        ...(expected.writes ? [`writes ${expected.writes.join(', ')}`] : []),
      ].join('\n');
  }
}
