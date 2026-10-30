import type { ReactNode } from 'react';
import { studentPricing, type Job, type StudentTarget } from '@architect/shared';
import {
  Button,
  Checkbox,
  Collapse,
  Disclosure,
  NumberTicker,
  RadioCard,
  RadioCardGroup,
} from '@architect/ui';
import { ChevronRight, RotateCw } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { currentPlatform, deviceInSentence, deviceLabel } from '../../lib/platform';
import { modelNames } from '../names';
import {
  aboutUsd,
  allowingLine,
  type Bills,
  capText,
  comparisonSeconds,
  estimateNotes,
  estimateTime,
  fittingRounds,
  formatAboutUsd,
  limitText,
  minutesForOneRound,
  planBills,
  placePhrase,
  planSeconds,
  practiceUsd,
  shortDuration,
  shortSpan,
  shownTotalUsd,
  taskTimeText,
  testSeconds,
  tooSlow,
  trainHereLine,
  TRAIN_ONLINE_LINE,
  wontTeachBody,
  wontTeachTitle,
} from './estimates';
import type { HostedAvailability } from './hosted';
import { SheetRow } from './SheetRow';
import { WontTeach, type Alternative } from './WontTeach';

/** What the plan is made from, for the choice of a place and for the figures under it. */
interface PlanFacts {
  job: Job;
  hosted: HostedAvailability;
  /** Where the final test runs, which sets its time and who bills it. */
  testPlace: StudentTarget;
  /** Present when comparison mode is on. */
  baselines?: { checked: boolean; onCheckedChange: (checked: boolean) => void } | undefined;
}

function factsOf({ job, hosted, baselines }: PlanFacts) {
  const names = modelNames(job);
  const device = deviceInSentence(currentPlatform());
  const local = estimateTime(job, 'local');
  const remote = estimateTime(job, 'hosted');
  const onHost = job.student.trainOn === 'hosted';
  const chosen = onHost ? remote : local;
  const pricing = job.student.hosted ? (studentPricing(job.student.hosted) ?? null) : null;
  return {
    names,
    device,
    local,
    remote,
    localSlow: tooSlow(job, local),
    remoteSlow: tooSlow(job, remote),
    onHost,
    chosen,
    fits: chosen.rounds.most > 0,
    pricing,
    comparing: baselines?.checked === true,
    hostedReady: hosted.available && job.student.hosted !== undefined,
  };
}

/** "About 2.5 minutes a task": how fast a place practices. */
function perTask(place: 'local' | 'hosted'): string {
  const time = taskTimeText(place);
  return `${time.charAt(0).toUpperCase()}${time.slice(1)} a task`;
}

interface TrainingPlaceProps extends PlanFacts {
  onPlaceChange: (place: Job['student']['trainOn']) => void;
  /** Present when checking for the hosted copy's key failed. */
  onRetryKeys?: (() => void) | undefined;
  /** Opens the time limit, for a place too slow to fit a round in it. */
  onRaiseLimit: () => void;
  /** Sets the time limit, to one the callout offers because a round fits in it. */
  onAllowTime: (minutes: number) => void;
  /** Opens where the online copy is chosen and its key saved. */
  onSetUpOnline: () => void;
}

/**
 * The choice of where it trains: this computer or online, each with how fast it practices and what
 * it costs, and under it what leaves this computer and, where the place chosen can't fit a round,
 * the callout with the ways out.
 */
export function TrainingPlace(props: TrainingPlaceProps) {
  const { job, hosted, onPlaceChange, onRetryKeys, onRaiseLimit, onAllowTime, onSetUpOnline } =
    props;
  const facts = factsOf(props);
  const { names, device, remote, localSlow, remoteSlow, onHost, chosen, fits, pricing } = facts;
  const { mentor, student } = names;
  const hostedPrice = pricing ? aboutUsd(practiceUsd(pricing, remote)) : null;

  // Where training would run out of time before the teacher changed anything, the two ways out
  // are said next to the choice: more time, or training online, which is offered when it fits and
  // otherwise says what it needs. Online is the faster place, so when it is the one that is too
  // slow, this computer is no better and there is nothing else to offer.
  let alternative: Alternative | null = null;
  if (!onHost && !hosted.available) {
    // Where a button takes the person to set it up, it does the rest and says no more.
    const setUp = hosted.why === 'no_host' || hosted.why === 'no_key';
    alternative = setUp
      ? { kind: 'missing', onSetUp: onSetUpOnline }
      : { kind: 'missing', text: `Online training isn't ready. ${hosted.reason}.` };
  } else if (!onHost && remoteSlow === null) {
    alternative = {
      kind: 'switch',
      label: 'Train online instead',
      onSwitch: () => onPlaceChange('hosted'),
    };
  }
  const roomy = fits ? null : minutesForOneRound(job, job.student.trainOn);
  return (
    <div className="flex flex-col gap-3">
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard
          value="local"
          title={`Train on ${device}`}
          unavailable={localSlow !== null}
          className="px-5 py-4"
        >
          <span>{perTask('local')}</span>
          <span>Free</span>
          {/* The callout says it for the place chosen, so the card does not say it again. */}
          {localSlow && onHost && <span>{localSlow}</span>}
        </RadioCard>
        <RadioCard
          value="hosted"
          title="Train online"
          unavailable={!hosted.available || remoteSlow !== null}
          className="px-5 py-4"
        >
          <span>{perTask('hosted')}</span>
          {hostedPrice && <span>{hostedPrice}</span>}
          {hosted.available ? (
            remoteSlow && !onHost && <span>{remoteSlow}</span>
          ) : (
            <span>{hosted.reason}</span>
          )}
        </RadioCard>
      </RadioCardGroup>
      <p className="m-0 text-small text-pretty">
        {onHost ? TRAIN_ONLINE_LINE : trainHereLine(job, { mentor, student }, device)}
      </p>
      <Collapse open={!fits}>
        {!fits && (
          <WontTeach
            title={wontTeachTitle(job, job.student.trainOn, device)}
            body={wontTeachBody(job, chosen)}
            allow={
              roomy === null
                ? null
                : {
                    label: `Allow ${capText(roomy)}`,
                    gives: allowingLine(roomy),
                    onAllow: () => onAllowTime(roomy),
                  }
            }
            onRaiseLimit={onRaiseLimit}
            alternative={alternative}
          />
        )}
      </Collapse>
      {fits && (localSlow || remoteSlow) && (
        <Button variant="ghost" size="xs" className="-ml-3 self-start" onClick={onRaiseLimit}>
          Allow more time
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden />
        </Button>
      )}
      {onRetryKeys && (
        <Button variant="ghost" size="xs" className="-mr-3 self-end" onClick={onRetryKeys}>
          <RotateCw size={12} aria-hidden />
          Check for the key again
        </Button>
      )}
    </div>
  );
}

/** One line of the breakdown: what it is, a detail beside it, and its figure on the right. */
interface PlanLine {
  label: string;
  detail?: ReactNode;
  value: string;
}

/**
 * The figures of the plan as rows of the page: what it all takes and costs, with the lines it
 * adds up from a click away. The caps they keep to are in the inspector's Budget.
 */
export function TrainingRows(props: PlanFacts) {
  const { job, testPlace, baselines } = props;
  const facts = factsOf(props);
  const { names, device, local, remote, chosen, fits, pricing, comparing, hostedReady } = facts;
  const { mentor } = names;
  const { maxRounds, maxWallMinutes } = job.budget;
  const bills = planBills(job, chosen, pricing, comparing, testPlace);
  const place = placePhrase(job.student.trainOn, device);
  // When every round fits, the time is a ceiling: training stops once the check tasks reach the
  // target, often well before the last round.
  const allFit = chosen.rounds.fewest >= maxRounds;
  const time: PlanLine[] = [
    {
      label: 'Training',
      detail: fits ? (
        allFit ? (
          `Up to ${maxRounds} rounds ${place}, fewer if it reaches the target first`
        ) : (
          `${fittingRounds(job, chosen)} ${place}`
        )
      ) : (
        <span className="text-danger">No round fits the {limitText(maxWallMinutes)} limit</span>
      ),
      value: allFit
        ? `at most ${shortDuration(chosen.trainingSeconds.most)}`
        : shortSpan(chosen.trainingSeconds),
    },
    {
      label: 'Final test',
      detail: `${job.splits.test} new tasks ${testPlace === 'hosted' ? 'online' : `on ${device}`}`,
      value: shortDuration(testSeconds(job, testPlace)),
    },
    ...(comparing
      ? [
          {
            label: 'Comparison',
            detail: 'Three simpler versions',
            value: shortDuration(comparisonSeconds(job, chosen, testPlace)),
          },
        ]
      : []),
  ];
  const billLines = (shares: Bills): PlanLine[] => [
    ...(shares.hostedUsd === null
      ? []
      : [{ label: 'Online practice', value: formatAboutUsd(shares.hostedUsd) }]),
    ...(shares.testUsd === null
      ? []
      : [{ label: 'Online final test', value: formatAboutUsd(shares.testUsd) }]),
    ...(shares.mentorUsd === null
      ? []
      : [{ label: `${mentor} teaching`, value: formatAboutUsd(shares.mentorUsd) }]),
  ];
  const cost = billLines(bills.total);
  const costTotal = shownTotalUsd(bills.total);
  const adds = [
    shortDuration(comparisonSeconds(job, chosen, testPlace)),
    ...billLines(bills.comparison).map((line) => `${line.value} ${line.label}`),
  ].join(' · ');
  const notes = estimateNotes(job, {
    names,
    device: { inSentence: device, label: deviceLabel(currentPlatform()) },
    local,
    remote: hostedReady ? remote : null,
    baselines: baselines !== undefined,
  });

  return (
    <>
      <SheetRow label="Estimate" region="Estimate">
        <div className="flex flex-col gap-1">
          <div className="flex min-h-10 flex-wrap items-center gap-x-8 gap-y-1 font-display text-h2 font-semibold tabular-nums">
            <span>{shortSpan(planSeconds(job, chosen, comparing, testPlace))}</span>
            {costTotal === null ? (
              <span>–</span>
            ) : (
              <span role="img" aria-label={formatUsd(costTotal)}>
                <NumberTicker value={costTotal} kind="currency" />
              </span>
            )}
          </div>
          <Disclosure label="Breakdown">
            <div className="flex flex-col gap-6 pb-1 pt-1">
              <div className="grid grid-cols-[repeat(auto-fit,minmax(min(280px,100%),1fr))] gap-x-10 gap-y-6">
                <PlanList label="Estimated time" lines={time} />
                {cost.length > 0 && <PlanList label="Estimated cost" lines={cost} />}
              </div>
              <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-small text-pretty">
                {notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          </Disclosure>
        </div>
      </SheetRow>
      {baselines && (
        <SheetRow label="Comparison">
          <div className="flex flex-col gap-1 pt-2.5">
            <Checkbox
              checked={baselines.checked}
              onCheckedChange={baselines.onCheckedChange}
              label="Also train three simpler versions to compare"
              className="self-start"
            />
            <p className="m-0 pl-7 text-small">Adds {adds}</p>
          </div>
        </SheetRow>
      )}
    </>
  );
}

/** The lines of one part of the breakdown, a figure to each, split by hairlines. */
function PlanList({ label, lines }: { label: string; lines: readonly PlanLine[] }) {
  return (
    <section aria-label={label}>
      <dl className="m-0 flex flex-col">
        {lines.map((line) => (
          <div
            key={line.label}
            className="flex items-baseline justify-between gap-4 border-t border-line py-2.5 first:border-t-0 first:pt-0"
          >
            <dt className="flex min-w-0 flex-col">
              <span>{line.label}</span>
              {line.detail && <span className="text-small text-pretty">{line.detail}</span>}
            </dt>
            <dd className="m-0 shrink-0 tabular-nums">{line.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
