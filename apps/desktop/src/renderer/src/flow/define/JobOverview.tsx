import type { ReactNode } from 'react';
import type { Job, PermissionMode } from '@architect/shared';
import { Badge, cn, Heading, Segmented, Stat } from '@architect/ui';
import { Check, CircleMinus, Laptop } from 'lucide-react';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { WRITE_MODE_LABELS, WRITE_MODES, WRITE_SETTING } from '../../workspace/labels';
import { formatTimeLimit } from '../format';

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
      <p className="m-0 max-w-[620px] text-xl text-fg-secondary text-pretty">
        {job.summary ?? job.description}
      </p>
      <Badge
        tone="neutral"
        size="lg"
        icon={<Laptop size={14} strokeWidth={1.6} aria-hidden />}
        className="self-start"
      >
        Runs offline on {deviceInSentence(currentPlatform())}
      </Badge>
    </div>
  );
}

/** What the agent will and won't do, side by side; the marks tell the two lists apart. */
export function Capabilities({ job }: { job: Job }) {
  if (job.does.length === 0 && job.doesNot.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] overflow-hidden rounded-3xl border border-line-card bg-card">
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
            className="mt-0.5 shrink-0 text-fg-muted"
            aria-hidden
          />
        }
        className="border-l border-line-card bg-list text-fg-secondary"
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
    <section aria-labelledby={id} className={cn('px-7 py-[26px]', className)}>
      <Heading id={id} className="sr-only">
        {title}
      </Heading>
      {items.length === 0 ? (
        <p className="m-0 text-md text-fg-muted">Nothing listed</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3.5 p-0 text-md">
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

/** When the trained agent must ask first: before it saves a change, and before it opens a file. */
export function FilePermissions({ job, onChange }: FilePermissionsProps) {
  const { permissions } = job;
  const changeable = job.data.files.filter((file) => file.access === 'write');
  return (
    <section aria-labelledby="permissions" className="flex flex-col">
      <Heading id="permissions" className="mb-2.5">
        Permissions
      </Heading>
      <PermissionRow
        label="Saving changes"
        detail={
          changeable.length > 0 ? (
            <span className="font-mono">{changeable.map((file) => file.name).join(', ')}</span>
          ) : (
            'No file it can change'
          )
        }
        setting={WRITE_SETTING}
        value={permissions.writes}
        onValueChange={(writes) => onChange({ ...permissions, writes })}
      />
      <PermissionRow
        label="Opening other files"
        setting="Opening other files"
        value={permissions.unseenFiles}
        onValueChange={(unseenFiles) => onChange({ ...permissions, unseenFiles })}
      />
    </section>
  );
}

function PermissionRow({
  label,
  detail,
  setting,
  value,
  onValueChange,
}: {
  label: string;
  /** A quiet line under the label, such as the files the setting covers. */
  detail?: ReactNode;
  /** The control's accessible name, the same words the agent's own setting uses. */
  setting: string;
  value: PermissionMode;
  onValueChange: (value: PermissionMode) => void;
}) {
  return (
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-card py-2 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span>{label}</span>
        {detail && <span className="truncate text-sm text-fg-muted">{detail}</span>}
      </div>
      <Segmented aria-label={setting} options={MODES} value={value} onValueChange={onValueChange} />
    </div>
  );
}
