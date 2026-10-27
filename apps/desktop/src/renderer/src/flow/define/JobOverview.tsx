import type { Job, PermissionMode } from '@architect/shared';
import { Badge, Heading, Segmented, Stat } from '@architect/ui';
import { Check, CircleMinus, Laptop } from 'lucide-react';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatTimeLimit } from '../format';

const MODES = [
  { value: 'ask', label: 'Ask' },
  { value: 'allow', label: 'Allow' },
  { value: 'never', label: 'Never' },
] as const satisfies readonly { value: PermissionMode; label: string }[];

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

/** What the agent will and won't do, side by side. */
export function Capabilities({ job }: { job: Job }) {
  if (job.does.length === 0 && job.doesNot.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] overflow-hidden rounded-3xl border border-line-card bg-card">
      <ul
        aria-label="It will"
        className="m-0 flex list-none flex-col gap-3.5 px-7 py-[26px] text-md"
      >
        {job.does.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <Check size={18} strokeWidth={2} className="mt-0.5 shrink-0" aria-hidden />
            {item}
          </li>
        ))}
      </ul>
      <ul
        aria-label="It won't"
        className="m-0 flex list-none flex-col gap-3.5 border-l border-line-card bg-list px-7 py-[26px] text-md text-fg-secondary"
      >
        {job.doesNot.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <CircleMinus
              size={18}
              strokeWidth={1.8}
              className="mt-0.5 shrink-0 text-fg-muted"
              aria-hidden
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
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
      <Heading id="asks-first" className="mb-2">
        Asks you first
      </Heading>
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
