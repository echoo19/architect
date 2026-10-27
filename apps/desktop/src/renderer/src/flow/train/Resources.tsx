import type { ReactNode } from 'react';
import { cn, Meter, Panel } from '@architect/ui';
import { Lock } from 'lucide-react';
import { formatDuration, formatUsd } from '../../lib/format';
import { formatAnswerTime } from '../format';
import { budgetMeters, changeCounts, medianLatencyMs, type LiveRun } from './run-state';

function share(used: number, max: number): number {
  return max === 0 ? 1 : used / max;
}

/** Time, money and rounds used against the job's caps, and how the student is doing on them. */
export function Resources({
  live,
  mentor,
  studentPlace,
}: {
  live: LiveRun;
  mentor: string;
  /** Where the student answers right now, which sets how long a task takes. */
  studentPlace: string;
}) {
  const { minutes, usd, rounds } = budgetMeters(live);
  const speed = medianLatencyMs(live.attempts);
  const changes = changeCounts(live.rounds);
  return (
    <Panel
      padded
      aria-label="Resources"
      className="min-w-0 flex-[5_1_360px] justify-between gap-[18px]"
    >
      <BudgetMeter
        label="Training time"
        used={formatDuration(minutes.used * 60_000)}
        max={formatDuration(minutes.max * 60_000)}
        fraction={share(minutes.used, minutes.max)}
      />
      <BudgetMeter
        label={`${mentor} spending`}
        used={formatUsd(roundCents(usd.used))}
        max={formatUsd(usd.max)}
        fraction={share(usd.used, usd.max)}
      />
      <BudgetMeter
        label="Rounds"
        used={String(rounds.used)}
        max={String(rounds.max)}
        fraction={share(rounds.used, rounds.max)}
      />
      <Fact
        label={`Time per task, ${studentPlace}`}
        className="border-t border-line-row-strong pt-[18px]"
      >
        {speed === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <span className="font-mono">{formatAnswerTime(speed)}</span>
        )}
      </Fact>
      <Fact label="Changes kept">
        <span className="font-mono">{changes.kept}</span>{' '}
        <span className="text-fg-muted">
          of <span className="font-mono">{changes.tried}</span>
        </span>
      </Fact>
      <Fact
        label={
          <span className="flex items-center gap-2">
            <Lock size={13} strokeWidth={1.8} aria-hidden />
            Final test, locked until training ends
          </span>
        }
      >
        <span className="font-mono">{live.job.splits.test}</span>{' '}
        <span className="text-fg-muted">tasks</span>
      </Fact>
    </Panel>
  );
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function BudgetMeter({
  label,
  used,
  max,
  fraction,
}: {
  label: string;
  used: string;
  max: string;
  fraction: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-fg-secondary">{label}</span>
        <span>
          <span className="font-mono">{used}</span>{' '}
          <span className="text-fg-muted">
            of <span className="font-mono">{max}</span>
          </span>
        </span>
      </div>
      <Meter label={label} value={fraction} valueText={`${used} of ${max}`} />
    </div>
  );
}

function Fact({
  label,
  children,
  className,
}: {
  label: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <span className="text-fg-secondary">{label}</span>
      <span>{children}</span>
    </div>
  );
}
