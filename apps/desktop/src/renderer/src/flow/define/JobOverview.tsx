import type { ReactNode } from 'react';
import type { Job, PermissionMode } from '@architect/shared';
import { Badge, cn, Heading, Segmented, SettingsValue, Stat } from '@architect/ui';
import { Check, CircleMinus, Laptop } from 'lucide-react';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { WRITE_MODE_LABELS, WRITE_MODES, WRITE_SETTING } from '../../workspace/labels';
import { formatTimeLimit } from '../format';
import { changeableOf, type Changeable } from './permissions';

/** The same words as the agent's own setting, under its message box. */
const MODES: readonly { value: PermissionMode; label: string }[] = WRITE_MODES.map((value) => ({
  value,
  label: WRITE_MODE_LABELS[value],
}));

export function JobHeader({ job }: { job: Job }) {
  return (
    <div className="flex flex-col gap-3.5">
      <Heading as="h1" size="display">
        {job.name}
      </Heading>
      <p className="m-0 max-w-[620px] text-h2 text-fg text-pretty">
        {job.summary ?? job.description}
      </p>
      <Badge
        tone="neutral"
        size="lg"
        icon={<Laptop size={14} strokeWidth={1.6} aria-hidden />}
        className="self-start"
      >
        Once trained, runs offline on {deviceInSentence(currentPlatform())}
      </Badge>
    </div>
  );
}

/** What the agent will and won't do, side by side under quiet headings. */
export function Capabilities({ job }: { job: Job }) {
  if (job.does.length === 0 && job.doesNot.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] overflow-hidden rounded-card bg-card shadow-edge">
      <CapabilityList
        id="does"
        title="What it does"
        items={job.does}
        icon={<Check size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />}
      />
      <CapabilityList
        id="does-not"
        title="What it won't do"
        items={job.doesNot}
        icon={
          <CircleMinus
            size={18}
            strokeWidth={1.8}
            className="mt-0.5 shrink-0 text-fg"
            aria-hidden
          />
        }
        className="border-l border-line bg-field text-fg"
      />
    </div>
  );
}

function CapabilityList({
  id,
  title,
  items,
  icon,
  className,
}: {
  id: string;
  title: string;
  items: readonly string[];
  icon: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-4 px-7 py-[26px]', className)}>
      <Heading id={id} className="text-small font-normal text-fg">
        {title}
      </Heading>
      {items.length === 0 ? (
        <p className="m-0 text-body text-fg">Nothing listed</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-body">
          {items.map((item) => (
            <li key={item} className="flex items-start gap-3">
              {icon}
              {item}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReadyWhen({ job }: { job: Job }) {
  const { passRate, p95LatencyMs } = job.requirements;
  return (
    <section aria-labelledby="ready-when" className="flex flex-col gap-[18px]">
      <Heading id="ready-when">Ready when</Heading>
      <div className="flex flex-wrap gap-10">
        <Stat size="lg" value={`${Math.round(passRate * 100)}%`} label="of new tasks right" />
        {p95LatencyMs !== undefined && (
          <Stat size="lg" value={formatTimeLimit(p95LatencyMs)} label="per answer" />
        )}
      </div>
    </section>
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
 * section says so in plain words instead of offering a choice about something that can't happen.
 */
export function FilePermissions({ job, onChange }: FilePermissionsProps) {
  const { permissions } = job;
  const changeable = changeableOf(job);
  return (
    <section aria-labelledby="permissions" className="flex flex-col">
      <Heading id="permissions" className="mb-2.5">
        Permissions
      </Heading>
      {changeable === null ? (
        <PermissionRow label="Files it can change">
          <SettingsValue>None</SettingsValue>
        </PermissionRow>
      ) : (
        <PermissionRow label={WRITE_SETTING} detail={<Covers changeable={changeable} />}>
          <Segmented
            aria-label={WRITE_SETTING}
            options={MODES}
            value={permissions.writes}
            onValueChange={(writes) => onChange({ ...permissions, writes })}
          />
        </PermissionRow>
      )}
    </section>
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

function PermissionRow({
  label,
  detail,
  children,
}: {
  label: string;
  /** A quiet line under the label, such as the files the setting covers. */
  detail?: ReactNode;
  /** What is on the right: the choice, or the one fact there is when there is no choice. */
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line py-2 last:border-b-0">
      <div className="flex min-w-0 flex-[1_1_12rem] flex-col gap-0.5">
        <span>{label}</span>
        {detail && <span className="text-small text-fg text-pretty">{detail}</span>}
      </div>
      {children}
    </div>
  );
}
