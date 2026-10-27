import type { ReactNode } from 'react';
import { cn, Meter, Panel } from '@architect/ui';
import { Lock } from 'lucide-react';
import { formatClock, formatUsd } from '../../lib/format';
import { formatAnswerTime } from '../format';
import { budgetMeters, changeCounts, medianLatencyMs, type LiveRun } from './run-state';

function share(used: number, max: number): number {
  return max === 0 ? 1 : used / max;
}

/** Time, money and rounds used against the job's caps, and how the student is doing on them. */
export function Resources({ live, mentor }: { live: LiveRun; mentor: string }) {
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
        label="Time"
        used={formatClock(minutes.used * 60_000)}
        max={formatClock(minutes.max * 60_000)}
        fraction={share(minutes.used, minutes.max)}
      />
      <BudgetMeter
        label={mentor}
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
      <Fact label="Answer speed" className="border-t border-line-row-strong pt-[18px]">
        {speed === null ? <span className="text-fg-muted">–</span> : formatAnswerTime(speed)}
      </Fact>
      <Fact label="Changes kept">
        {changes.kept} <span className="text-fg-muted">/ {changes.tried}</span>
      </Fact>
      <Fact
        label={
          <span className="flex items-center gap-2">
            <Lock size={13} strokeWidth={1.8} aria-hidden />
            Final test
          </span>
        }
      >
        {live.job.splits.test}
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
      <div className="flex items-baseline justify-between">
        <span className="text-fg-secondary">{label}</span>
        <span className="font-mono">
          {used} <span className="text-fg-muted">/ {max}</span>
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
    <div className={cn('flex items-baseline justify-between', className)}>
      <span className="text-fg-secondary">{label}</span>
      <span className="font-mono">{children}</span>
    </div>
  );
}
