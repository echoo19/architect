import { useId, type ReactNode } from 'react';
import { studentPricing, type Job, type StudentTarget } from '@architect/shared';
import { Checkbox, cn, Heading, RadioCard, RadioCardGroup, Slider } from '@architect/ui';
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
  estimateMentorUsd,
  estimateTime,
  expectedMentorUsd,
  fittingRounds,
  formatAboutUsd,
  limitText,
  minutesForOneRound,
  planBills,
  placePhrase,
  planSeconds,
  practiceUsd,
  roundsLine,
  shortDuration,
  shortSpan,
  shownTotalUsd,
  taskTimeText,
  teacherWorks,
  testSeconds,
  tooSlow,
  trainHereLine,
  wontTeachBody,
  wontTeachTitle,
} from './estimates';
import { providerName, type HostedAvailability } from './hosted';
import { WontTeach, type Alternative } from './WontTeach';

interface TrainingPlaceProps {
  job: Job;
  hosted: HostedAvailability;
  /** Where the final test runs, which sets its time and who bills it. */
  testPlace: StudentTarget;
  onPlaceChange: (place: Job['student']['trainOn']) => void;
  onCapChange: (usd: number) => void;
  /** Present when checking for the hosted copy's key failed. */
  onRetryKeys?: (() => void) | undefined;
  /** Opens the time limit, for a place too slow to fit a round in it. */
  onRaiseLimit: () => void;
  /** Sets the time limit, to one the callout offers because a round fits in it. */
  onAllowTime: (minutes: number) => void;
  /** Opens where the online copy is chosen and its key saved. */
  onSetUpOnline: () => void;
  /** Present when comparison mode is on. */
  baselines?: { checked: boolean; onCheckedChange: (checked: boolean) => void } | undefined;
}

/** One line of the plan: what it is, a quiet detail under it, and its figure on the right. */
interface PlanLine {
  label: string;
  detail: ReactNode;
  value: string;
}

export function TrainingPlace({
  job,
  hosted,
  testPlace,
  onPlaceChange,
  onCapChange,
  onRetryKeys,
  onRaiseLimit,
  onAllowTime,
  onSetUpOnline,
  baselines,
}: TrainingPlaceProps) {
  const capId = useId();
  const { mentor, student } = modelNames(job);
  const device = deviceInSentence(currentPlatform());
  const { maxRounds, maxWallMinutes, maxMentorUsd: cap } = job.budget;
  const limit = limitText(maxWallMinutes);
  const usual = estimateMentorUsd(job);
  const capMax = Math.max(20, Math.ceil(cap), Math.ceil((usual ?? 0) * 3));
  const local = estimateTime(job, 'local');
  const remote = estimateTime(job, 'hosted');
  const localSlow = tooSlow(job, local);
  const remoteSlow = tooSlow(job, remote);
  const onHost = job.student.trainOn === 'hosted';
  const chosen = onHost ? remote : local;
  const provider = job.student.hosted ? providerName(job.student.hosted) : null;
  const pricing = job.student.hosted ? (studentPricing(job.student.hosted) ?? null) : null;
  const hostedPrice = pricing ? aboutUsd(practiceUsd(pricing, remote)) : null;
  const expected = expectedMentorUsd(job, chosen);

  // Every dollar figure sits under what it pays for; the comparison's share adds in when ticked.
  const comparing = baselines?.checked === true;
  const bills = planBills(job, chosen, pricing, comparing, testPlace);
  const billLines = (shares: Bills): PlanLine[] => [
    ...(shares.hostedUsd === null
      ? []
      : [
          {
            label: 'Online practice',
            detail: `${student} practicing online`,
            value: formatAboutUsd(shares.hostedUsd),
          },
        ]),
    ...(shares.testUsd === null
      ? []
      : [
          {
            label: 'Online final test',
            detail: `${student} taking the final test online`,
            value: formatAboutUsd(shares.testUsd),
          },
        ]),
    ...(shares.mentorUsd === null
      ? []
      : [{ label: mentor, detail: 'Teaching', value: formatAboutUsd(shares.mentorUsd) }]),
  ];
  const fits = chosen.rounds.most > 0;
  const place = placePhrase(job.student.trainOn, device);
  // When every round fits, the time is a ceiling: training stops once the check tasks reach the
  // target, often well before the last round.
  const allFit = chosen.rounds.fewest >= job.budget.maxRounds;
  const time: PlanLine[] = [
    {
      label: 'Training',
      detail: fits ? (
        allFit ? (
          `Up to ${job.budget.maxRounds} rounds ${place}, fewer if it reaches the target first`
        ) : (
          `${fittingRounds(job, chosen)} ${place}`
        )
      ) : (
        <span className="text-danger">No round fits the {limit} limit</span>
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
  const cost = billLines(bills.total);
  const costTotal = shownTotalUsd(bills.total);
  const adds = [
    shortDuration(comparisonSeconds(job, chosen, testPlace)),
    ...billLines(bills.comparison).map((line) => `${line.value} ${line.label}`),
  ].join(' · ');

  // Where training would run out of time before the teacher changed anything, the two ways out
  // are said next to the choice: more time, or training online, which is offered when it fits and
  // otherwise says what it needs. Online is the faster place, so when it is the one that is too
  // slow, this computer is no better and there is nothing else to offer.
  let alternative: Alternative | null = null;
  if (!onHost && !hosted.available) {
    // Where a button takes the person to set it up, it does the rest and the sentence is short.
    const setUp = hosted.why === 'no_host' || hosted.why === 'no_key';
    alternative = {
      kind: 'missing',
      text: setUp
        ? "Online training isn't set up yet."
        : `Online training isn't ready. ${hosted.reason}.`,
      ...(setUp ? { onSetUp: onSetUpOnline } : {}),
    };
  } else if (!onHost && remoteSlow === null) {
    alternative = {
      kind: 'switch',
      label: 'Train online instead',
      onSwitch: () => onPlaceChange('hosted'),
    };
  }
  const roomy = fits ? null : minutesForOneRound(job, job.student.trainOn);
  return (
    <section aria-labelledby="train-where" className="flex flex-col gap-[18px]">
      <Heading id="train-where">Where should it train?</Heading>
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard value="local" title={`Train on ${device}`} unavailable={localSlow !== null}>
          <span>Slower: {taskTimeText('local')} a task</span>
          <span>{trainHereLine(job, { mentor, student }, device)}</span>
          {/* The callout says it for the place chosen, so the card does not say it again. */}
          {localSlow && onHost && <span>{localSlow}</span>}
        </RadioCard>
        <RadioCard
          value="hosted"
          title="Train online"
          unavailable={!hosted.available || remoteSlow !== null}
        >
          <span>Faster: {taskTimeText('hosted')} a task</span>
          {/* What it costs and what leaves this computer are said wherever the app knows them. */}
          <span>
            {[hostedPrice, `${hostedPrice ? 'sends' : 'Sends'} tasks and files online`]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {hosted.available ? (
            remoteSlow && !onHost && <span>{remoteSlow}</span>
          ) : (
            <span>{hosted.reason}</span>
          )}
        </RadioCard>
      </RadioCardGroup>
      {!fits && (
        <WontTeach
          title={wontTeachTitle(job, job.student.trainOn, device)}
          body={wontTeachBody(job, job.student.trainOn, chosen, { mentor, student })}
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
      {fits && (localSlow || remoteSlow) && (
        <button
          type="button"
          onClick={onRaiseLimit}
          className="-mt-1.5 inline-flex items-center gap-1 self-start rounded-xs text-sm text-fg-secondary transition-colors duration-150 hover:text-fg"
        >
          Allow more time
          <ChevronRight size={13} strokeWidth={1.8} aria-hidden />
        </button>
      )}
      {onRetryKeys && (
        <button
          type="button"
          onClick={onRetryKeys}
          className="-mt-1.5 inline-flex items-center gap-1.5 self-end rounded-xs text-sm text-fg-secondary transition-colors duration-150 hover:text-fg"
        >
          <RotateCw size={12} aria-hidden />
          Check for the key again
        </button>
      )}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] overflow-hidden rounded-2xl border border-line-card bg-card">
        <PlanColumn
          title="Estimated time"
          lines={time}
          total={shortSpan(planSeconds(job, chosen, comparing, testPlace))}
        />
        <PlanColumn
          title="Estimated cost"
          lines={cost}
          total={costTotal === null ? '–' : formatUsd(costTotal)}
          className="border-l border-line-card"
        />
      </div>

      <div className="flex flex-col gap-2.5 rounded-2xl border border-line-card bg-card px-[22px] py-5">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={capId} className="text-md">
            {mentor} spending cap
          </label>
          <span className="font-mono text-md tabular-nums">{formatUsd(cap)}</span>
        </div>
        <Slider
          id={capId}
          min={Math.min(1, Math.floor(cap))}
          max={capMax}
          step={1}
          value={cap}
          onValueChange={onCapChange}
          aria-label={`${mentor} spending cap`}
          aria-valuetext={formatUsd(cap)}
        />
        <span className="text-fg-secondary text-pretty">
          {expected === null
            ? `No price on file for ${mentor}`
            : expected < cap
              ? `${aboutUsd(expected)} expected`
              : `${aboutUsd(expected)} expected, more than the cap, so training may stop early`}
        </span>
      </div>

      {baselines && (
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={baselines.checked}
            onCheckedChange={baselines.onCheckedChange}
            label="Also train three simpler versions to compare"
            className="self-start"
          />
          <p className="m-0 pl-7 text-sm text-fg-muted">Adds {adds}</p>
        </div>
      )}

      <details className="group text-sm text-fg-secondary">
        <summary className="inline-flex cursor-pointer select-none list-none items-center gap-1.5 rounded-xs text-fg-muted transition-colors duration-150 hover:text-fg-secondary [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={13}
            strokeWidth={1.8}
            aria-hidden
            className="transition-transform duration-200 group-open:rotate-90"
          />
          How this is estimated
        </summary>
        <ul className="m-0 mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-pretty">
          <li>
            Training stops at the {Math.round(job.requirements.passRate * 100)}% target, after{' '}
            {maxRounds} rounds or after {capText(maxWallMinutes)}, or sooner once changes stop
            helping. Paused time doesn&apos;t count.
          </li>
          <li>
            {deviceLabel(currentPlatform())}: {roundsLine(job, local)}.
          </li>
          {hosted.available && provider && <li>Online: {roundsLine(job, remote)}.</li>}
          <li>A promising change is measured twice, so its round takes longer.</li>
          <li>
            {mentor} {teacherWorks(job, device)} and sees the practice attempts and the file samples
            it needs.
          </li>
          {baselines && (
            <li>
              The three simpler versions are {student} on its own, a setup {mentor} writes in one
              go, and {student} revising its own. They run after this agent.
            </li>
          )}
          <li>Only {mentor}&apos;s bill has a hard cap.</li>
        </ul>
      </details>
    </section>
  );
}

function PlanColumn({
  title,
  lines,
  total,
  className,
}: {
  title: string;
  lines: readonly PlanLine[];
  total: string;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col px-[22px] pb-4 pt-5', className)}>
      <h3 id={id} className="m-0 mb-1.5 text-sm font-normal text-fg-muted">
        {title}
      </h3>
      <dl className="m-0 flex flex-1 flex-col">
        {lines.map((line) => (
          <div key={line.label} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="flex min-w-0 flex-col gap-0.5">
              <span>{line.label}</span>
              <span className="text-sm text-fg-muted">{line.detail}</span>
            </dt>
            <dd className="m-0 shrink-0 tabular-nums">{line.value}</dd>
          </div>
        ))}
        <div className="mt-auto flex items-baseline justify-between gap-4 border-t border-line-card pt-3">
          <dt className="font-medium">In all</dt>
          <dd className="m-0 font-medium tabular-nums">{total}</dd>
        </div>
      </dl>
    </section>
  );
}
