import { Fragment, type ReactNode } from 'react';
import type { Job, PermissionMode } from '@architect/shared';
import { Badge, cn, Heading, Segmented, Stat } from '@architect/ui';
import { Check, CircleMinus, Laptop } from 'lucide-react';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import {
  WRITE_MODE_LABELS,
  WRITE_MODE_MEANINGS,
  WRITE_MODES,
  WRITE_SETTING,
} from '../../workspace/labels';
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

interface FilePermissionsProps {
  job: Job;
  onChange: (permissions: Job['permissions']) => void;
}

/** What the three choices mean for a file the job doesn't list, in one line. */
const UNSEEN_FILES_MEANING =
  "Ask first waits for your OK before opening one. Allow opens it without asking. Never can't open one.";

/** File names in a sentence, in mono: "a.csv", "a.csv and b.csv", "a.csv, b.csv and c.md". */
function FileNames({ files }: { files: readonly { name: string }[] }) {
  return files.map((file, index) => (
    <Fragment key={file.name}>
      {index > 0 && (index === files.length - 1 ? ' and ' : ', ')}
      <span className="font-mono text-sm text-fg">{file.name}</span>
    </Fragment>
  ));
}

/** The job's files, what the agent may do with them in the workspace, and when it must ask first. */
export function FilePermissions({ job, onChange }: FilePermissionsProps) {
  const { permissions } = job;
  const changeable = job.data.files.filter((file) => file.access === 'write');
  const readOnly = job.data.files.filter((file) => file.access === 'read');
  return (
    <section aria-labelledby="file-writes" className="flex flex-col gap-4">
      <SectionHeading id="file-writes" title={WRITE_SETTING}>
        {changeable.length > 0 ? (
          <>
            Once trained, it can change <FileNames files={changeable} />.
          </>
        ) : (
          'The job lists no file it can change.'
        )}
        {readOnly.length > 0 && (
          <>
            {' '}
            It only reads <FileNames files={readOnly} />.
          </>
        )}
      </SectionHeading>
      <Segmented
        aria-label={WRITE_SETTING}
        options={MODES}
        value={permissions.writes}
        onValueChange={(writes) => onChange({ ...permissions, writes })}
        className="self-start"
      />
      <dl className="m-0 flex flex-col gap-1.5 text-sm">
        {WRITE_MODES.map((mode) => (
          <div key={mode} className="flex items-baseline gap-3">
            <dt
              className={cn(
                'w-[68px] shrink-0',
                mode === permissions.writes ? 'text-fg' : 'text-fg-secondary',
              )}
            >
              {WRITE_MODE_LABELS[mode]}
            </dt>
            <dd
              className={cn(
                'm-0 text-pretty',
                mode === permissions.writes ? 'text-fg-secondary' : 'text-fg-muted',
              )}
            >
              {WRITE_MODE_MEANINGS[mode]}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2 border-t border-line-card pt-4">
        <span>Opening a file the job doesn&apos;t list</span>
        <p className="m-0 text-sm text-fg-muted text-pretty">
          Any file besides the ones above. {UNSEEN_FILES_MEANING}
        </p>
        <Segmented
          aria-label="Opening a file the job doesn't list"
          options={MODES}
          value={permissions.unseenFiles}
          onValueChange={(unseenFiles) => onChange({ ...permissions, unseenFiles })}
          className="self-start"
        />
      </div>
    </section>
  );
}
