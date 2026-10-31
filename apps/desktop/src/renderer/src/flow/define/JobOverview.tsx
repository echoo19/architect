import type { ReactNode } from 'react';
import type { Job, PermissionMode } from '@architect/shared';
import { Heading, NumberTicker, Segmented, SettingsValue } from '@architect/ui';
import { Check, X, type LucideIcon } from 'lucide-react';
import { WRITE_MODE_LABELS, WRITE_MODES, WRITE_SETTING } from '../../workspace/labels';
import { formatTimeLimit } from '../format';
import { changeableOf, type Changeable } from './permissions';
import { SheetRow } from './SheetRow';

/** The same words as the agent's own setting, under its message box. */
const MODES: readonly { value: PermissionMode; label: string }[] = WRITE_MODES.map((value) => ({
  value,
  label: WRITE_MODE_LABELS[value],
}));

/** The page's one title: the job, and in a sentence what it is for. */
export function JobHeader({ job }: { job: Job }) {
  return (
    <header className="flex flex-col gap-3">
      <Heading as="h1" size="display">
        {job.name}
      </Heading>
      <p className="m-0 max-w-[640px] text-body text-pretty">{job.summary ?? job.description}</p>
    </header>
  );
}

/** What the agent will and won't do, side by side: a check for each thing it does, a cross for each it won't. */
export function Capabilities({ job }: { job: Job }) {
  if (job.does.length === 0 && job.doesNot.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-x-12 gap-y-8">
      <CapabilityList label="What it does" items={job.does} icon={Check} />
      <CapabilityList label="What it won't do" items={job.doesNot} icon={X} />
    </div>
  );
}

function CapabilityList({
  label,
  items,
  icon: Icon,
}: {
  label: string;
  items: readonly string[];
  icon: LucideIcon;
}) {
  return (
    <section aria-label={label}>
      {items.length === 0 ? (
        <p className="m-0 text-body">Nothing listed</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0 text-body">
          {items.map((item) => (
            <li
              key={item}
              className="flex items-start gap-3 border-t border-line py-3 first:border-t-0 first:pt-0"
            >
              <Icon size={18} strokeWidth={1.8} className="mt-0.5 shrink-0" aria-hidden />
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One figure and what it counts: "90%" and "of new tasks right". */
function Figure({ value, label }: { value: ReactNode; label: string }) {
  return (
    <span className="flex items-baseline gap-2">
      <span className="font-display text-h2 font-semibold tabular-nums">{value}</span>
      {label}
    </span>
  );
}

/** What the agent must reach before training is done: the share of new tasks it gets right. */
export function ReadyWhen({ job }: { job: Job }) {
  const { passRate, p95LatencyMs } = job.requirements;
  return (
    <SheetRow label="Ready when">
      <div className="flex min-h-10 flex-wrap items-center gap-x-8 gap-y-1">
        <Figure
          value={
            <span role="img" aria-label={`${Math.round(passRate * 100)}%`}>
              <NumberTicker value={Math.round(passRate * 100)} kind="percent" />
            </span>
          }
          label={
            (job.organizations ?? []).length > 1
              ? 'on the final test, organizations it was taught on'
              : 'of new tasks right'
          }
        />
        {p95LatencyMs !== undefined && (
          <Figure value={formatTimeLimit(p95LatencyMs)} label="per answer" />
        )}
      </div>
    </SheetRow>
  );
}

interface FilePermissionsProps {
  job: Job;
  onChange: (permissions: Job['permissions']) => void;
}

/**
 * What the trained agent may do with files. The one choice is when it must ask first: before it
 * saves a change to a file it works on, a data file the job lets it write or its output folder.
 * It is offered only where the agent can change something (`changeableOf`). Where it can't, the
 * row says so in plain words instead of offering a choice about something that can't happen.
 */
export function FilePermissions({ job, onChange }: FilePermissionsProps) {
  const { permissions } = job;
  const changeable = changeableOf(job);
  if (changeable === null) {
    return (
      <SheetRow label="Files it can change" region="Permissions">
        <div className="flex min-h-10 items-center">
          <SettingsValue>None</SettingsValue>
        </div>
      </SheetRow>
    );
  }
  return (
    <SheetRow label={WRITE_SETTING} region="Permissions">
      <div className="flex flex-col items-start gap-2">
        <Segmented
          aria-label={WRITE_SETTING}
          options={MODES}
          value={permissions.writes}
          onValueChange={(writes) => onChange({ ...permissions, writes })}
        />
        <span className="text-small text-pretty">
          <Covers changeable={changeable} />
        </span>
      </div>
    </SheetRow>
  );
}

/** What the saving setting covers: the files the agent may write, and its output folder. */
function Covers({ changeable }: { changeable: Changeable }) {
  const { files, folder } = changeable;
  if (files.length === 0) return <>Its output folder</>;
  return (
    <>
      <span className="font-mono">{files.join(', ')}</span>
      {folder && ' and its output folder'}
    </>
  );
}
