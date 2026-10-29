import type { ReactNode } from 'react';
import { cn, Meter, Panel } from '@architect/ui';
import type { MentoringRecords } from '../../api/mentoring';
import { formatDuration, formatUsd } from '../../lib/format';
import { draftRoundOf } from './draft';
import { budgetMeters, changeCounts, type LiveRun } from './run-state';

function share(used: number, max: number): number {
  return max === 0 ? 1 : used / max;
}

/**
 * Changes kept of those tried: from the experiment records when the run has them, rejected,
 * invalid and stopped ones included, else from its rounds. The first draft is the starting
 * point, not a change, so it isn't counted among them.
 */
function keptChanges(live: LiveRun, records: MentoringRecords | null) {
  const changes = records?.experiments.filter((experiment) => experiment.kind !== 'draft') ?? [];
  if (changes.length > 0) {
    return {
      kept: changes.filter((experiment) => experiment.disposition === 'kept').length,
      tried: changes.length,
    };
  }
  const draft = draftRoundOf(live);
  return changeCounts(live.rounds.filter((round) => round.index !== draft));
}

/**
 * Time, money and rounds used against the job's caps, and how the student is doing on them.
 * While the mentoring records can't be read, the changes kept aren't counted from anything else.
 */
export function Resources({
  live,
  mentor,
  records,
  recordsFailed,
}: {
  live: LiveRun;
  mentor: string;
  records: MentoringRecords | null;
  recordsFailed: boolean;
}) {
  const { minutes, usd, rounds } = budgetMeters(live);
  const changes = recordsFailed ? null : keptChanges(live, records);
  // Training stops at the time limit, and the final test still runs: its time counts here too.
  // An improvement takes no final test, so it says only that the limit was reached.
  const testedPast =
    live.improves === null &&
    minutes.used > minutes.max &&
    (live.run.phase === 'testing' || live.run.graduateId !== undefined);
  return (
    <Panel
      padded
      aria-label="Resources"
      className="min-w-0 flex-[5_1_360px] justify-between gap-[18px]"
    >
      <BudgetMeter
        label="Time"
        used={formatDuration(minutes.used * 60_000)}
        max={formatDuration(minutes.max * 60_000)}
        fraction={share(minutes.used, minutes.max)}
        reached={testedPast ? 'limit reached, then the final test' : undefined}
      />
      <BudgetMeter
        label={`${mentor}'s cost`}
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
      <Fact label="Changes kept" className="border-t border-line-row-strong pt-[18px]">
        {changes === null ? (
          <span className="text-fg-muted">–</span>
        ) : (
          <span className="font-mono tabular-nums">
            {changes.kept} <span className="text-fg-muted">/ {changes.tried}</span>
          </span>
        )}
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
  reached = 'limit reached',
}: {
  label: string;
  used: string;
  max: string;
  fraction: number;
  /** What the count says once it reaches the cap. */
  reached?: string | undefined;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-fg-secondary">
          {label}
          {/* A cap is checked between steps, so the last step can carry the count past it. */}
          {fraction >= 1 && <span className="text-fg-muted"> · {reached}</span>}
        </span>
        <span className="font-mono tabular-nums">
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
    <div className={cn('flex items-baseline justify-between gap-3', className)}>
      <span className="text-fg-secondary">{label}</span>
      <span>{children}</span>
    </div>
  );
}
