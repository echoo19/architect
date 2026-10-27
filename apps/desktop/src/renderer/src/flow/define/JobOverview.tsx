import type { ReactNode } from 'react';
import type { Job, PermissionMode } from '@architect/shared';
import { Badge, cn, Heading, Segmented, Stat } from '@architect/ui';
import { Check, CircleMinus, Laptop } from 'lucide-react';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { WRITE_MODE_LABELS, WRITE_MODES } from '../../workspace/labels';
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
        Once trained, runs offline on {deviceInSentence(currentPlatform())}
      </Badge>
    </div>
  );
}

/** A section heading with one plain line under it saying what the section means. */
function SectionHeading({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Heading id={id}>{title}</Heading>
      <p className="m-0 text-fg-secondary text-pretty">{children}</p>
    </div>
  );
}

/** What the agent will and won't do, side by side under the design's own headings. */
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
    <section aria-labelledby={id} className={cn('flex flex-col gap-4 px-7 py-[26px]', className)}>
      <Heading id={id} className="text-fg">
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
      <SectionHeading id="ready-when" title="Ready when">
        Training aims for this; a final test on tasks it has never seen confirms it. You can change
        it in Advanced settings.
      </SectionHeading>
      <div className="flex flex-wrap gap-10">
        <Stat size="lg" value={`${Math.round(passRate * 100)}%`} label="of new tasks right" />
        {p95LatencyMs !== undefined && (
          <Stat size="lg" value={formatTimeLimit(p95LatencyMs)} label="per answer" />
        )}
      </div>
    </section>
  );
}

interface AsksFirstProps {
  job: Job;
  onChange: (permissions: Job['permissions']) => void;
}

/** What the graduate must ask about before doing it in the workspace. */
export function AsksFirst({ job, onChange }: AsksFirstProps) {
  const { permissions } = job;
  const rows = [
    { key: 'writes', label: 'Saving changes to your files' },
    { key: 'unseenFiles', label: "Opening a file it hasn't seen" },
  ] as const;
  return (
    <section aria-labelledby="asks-first" className="flex flex-col gap-2.5">
      <div className="mb-2">
        <SectionHeading id="asks-first" title="Asks you first">
          Ask first: it waits for your OK each time. Allow: it goes ahead. Never: it can&apos;t.
        </SectionHeading>
      </div>
      {rows.map((row, index) => (
        <div
          key={row.key}
          className={
            index < rows.length - 1
              ? 'flex min-h-12 items-center justify-between gap-4 border-b border-line-card'
              : 'flex min-h-12 items-center justify-between gap-4'
          }
        >
          <span>{row.label}</span>
          <Segmented
            aria-label={row.label}
            options={MODES}
            value={permissions[row.key]}
            onValueChange={(mode) => onChange({ ...permissions, [row.key]: mode })}
          />
        </div>
      ))}
    </section>
  );
}
