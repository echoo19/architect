import { Meter, NumberTicker, type NumberKind } from '@architect/ui';
import { formatDuration, formatUsd } from '../../lib/format';
import { Counted } from '../counted';
import { budgetMeters, type LiveRun } from './run-state';

function share(used: number, max: number): number {
  return max === 0 ? 1 : used / max;
}

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * Time, money and rounds used against the job's caps, in one row. A cap is a hard stop, so each
 * count shows how near the run is to it.
 */
export function Budget({ live, mentor }: { live: LiveRun; mentor: string }) {
  const { minutes, usd, rounds } = budgetMeters(live);
  // Training stops at the time limit, and the final test still runs: its time counts here too.
  // An improvement takes no final test, so it says only that the limit was reached.
  const testedPast =
    live.improves === null &&
    minutes.used > minutes.max &&
    (live.run.phase === 'testing' || live.run.graduateId !== undefined);
  return (
    <section
      aria-label="Budget"
      className="grid grid-cols-1 gap-x-12 gap-y-5 border-b border-line pb-8 sm:grid-cols-3"
    >
      <BudgetMeter
        label="Time"
        value={minutes.used * 60_000}
        kind="duration"
        used={formatDuration(minutes.used * 60_000)}
        max={formatDuration(minutes.max * 60_000)}
        fraction={share(minutes.used, minutes.max)}
        reachedHint={
          testedPast ? 'Training stopped at the limit, then the final test ran' : undefined
        }
      />
      <BudgetMeter
        label={`${mentor}'s cost`}
        value={roundCents(usd.used)}
        kind="currency"
        used={formatUsd(roundCents(usd.used))}
        max={formatUsd(usd.max)}
        fraction={share(usd.used, usd.max)}
      />
      <BudgetMeter
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
  label,
  value,
  kind,
  used,
  max,
  fraction,
  reachedHint,
}: {
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
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate">
          {label}
          {/* A cap is checked between steps, so the last step can carry the count past it. */}
          {fraction >= 1 && <span title={reachedHint}> · limit reached</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          <Counted said={used}>
            <NumberTicker value={value} kind={kind} />
          </Counted>{' '}
          <span>/ {max}</span>
        </span>
      </div>
      <Meter label={label} value={fraction} valueText={`${used} of ${max}`} />
    </div>
  );
}
