import { Meter, NumberTicker, type NumberKind } from '@architect/ui';
import { CircleDollarSign, Clock, Repeat, type LucideIcon } from 'lucide-react';
import { formatDuration, formatUsd } from '../../lib/format';
import { useWords } from '../../shell/edition';
import { Counted } from '../counted';
import { budgetMeters, type LiveRun } from './run-state';

function share(used: number, max: number): number {
  return max === 0 ? 1 : used / max;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Time, money and rounds used against the job's caps, one under another. A cap is a hard stop, so each
 * count shows how near the run is to it.
 */
export function Budget({ live, mentor }: { live: LiveRun; mentor: string }) {
  const w = useWords();
  const { minutes, usd, rounds } = budgetMeters(live);
  // Training stops at the time limit, and the final test still runs: its time counts here too.
  // An improvement takes no final test, so it says only that the limit was reached.
  const testedPast =
    live.improves === null &&
    minutes.used > minutes.max &&
    (live.run.phase === 'testing' || live.run.graduateId !== undefined);
  return (
    <section aria-label="Budget" className="flex flex-col gap-5 border-t border-line pt-6">
      <BudgetMeter
        icon={Clock}
        label="Time"
        value={minutes.used * 60_000}
        kind="duration"
        used={formatDuration(minutes.used * 60_000)}
        max={formatDuration(minutes.max * 60_000)}
        fraction={share(minutes.used, minutes.max)}
        reachedHint={
          testedPast ? `Training stopped at the limit, then the ${w.finalTest} ran` : undefined
        }
      />
      {/* Only the mentor's bill has a cap; what an online student costs is billed apart, so the
          label names the bill it counts, as the estimate's line for it does. */}
      <BudgetMeter
        icon={CircleDollarSign}
        tone="mentor"
        label={`${mentor} teaching`}
        value={roundCents(usd.used)}
        kind="currency"
        used={formatUsd(roundCents(usd.used))}
        max={formatUsd(usd.max)}
        fraction={share(usd.used, usd.max)}
      />
      <BudgetMeter
        icon={Repeat}
        label="Rounds"
        value={rounds.used}
        kind="integer"
        used={String(rounds.used)}
        max={String(rounds.max)}
        fraction={share(rounds.used, rounds.max)}
      />
    </section>
  );
}

function BudgetMeter({
  icon: Icon,
  tone = 'fg',
  label,
  value,
  kind,
  used,
  max,
  fraction,
  reachedHint,
}: {
  icon: LucideIcon;
  tone?: 'fg' | 'mentor';
  label: string;
  /** What has been used, as a number that rolls to its new value. */
  value: number;
  kind: NumberKind;
  /** The same as text, for the meter's reading. */
  used: string;
  max: string;
  fraction: number;
  /** More to say, on hover, once the count reaches the cap. */
  reachedHint?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.8} aria-hidden className="shrink-0" />
        <span className="min-w-0 truncate">
          {label}
          {/* A cap is checked between steps, so the last step can carry the count past it. */}
          {fraction >= 1 && <span title={reachedHint}>, limit reached</span>}
        </span>
        <span className="ml-auto shrink-0 tabular-nums">
          <Counted said={used}>
            <span className="font-medium">
              <NumberTicker value={value} kind={kind} />
            </span>
          </Counted>{' '}
          <span>/ {max}</span>
        </span>
      </div>
      <Meter
        label={label}
        value={fraction}
        valueText={`${used} of ${max}`}
        tone={tone}
        thickness={4}
      />
    </div>
  );
}
