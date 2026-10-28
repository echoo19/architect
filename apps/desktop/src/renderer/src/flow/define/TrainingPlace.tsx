import { useId } from 'react';
import type { Job } from '@architect/shared';
import { Checkbox, cn, Heading, RadioCard, RadioCardGroup, Slider } from '@architect/ui';
import { RotateCw } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { mentorIntro, studentIntro } from '../../lib/names';
import { currentPlatform, deviceInSentence, deviceLabel } from '../../lib/platform';
import { modelNames } from '../names';
import {
  aboutSpan,
  aboutUsd,
  capText,
  comparisonSeconds,
  estimateMentorUsd,
  estimateTime,
  formatAbout,
  practiceUsd,
  roundsLine,
  runSeconds,
  testSeconds,
} from './estimates';
import { presetOf, providerName, type HostedAvailability } from './hosted';

interface TrainingPlaceProps {
  job: Job;
  hosted: HostedAvailability;
  onPlaceChange: (place: Job['student']['trainOn']) => void;
  onCapChange: (usd: number) => void;
  /** Present when checking for the hosted copy's key failed. */
  onRetryKeys?: (() => void) | undefined;
  /** Present when comparison mode is on. */
  baselines?: { checked: boolean; onCheckedChange: (checked: boolean) => void } | undefined;
}

export function TrainingPlace({
  job,
  hosted,
  onPlaceChange,
  onCapChange,
  onRetryKeys,
  baselines,
}: TrainingPlaceProps) {
  const capId = useId();
  const names = modelNames(job);
  const device = deviceInSentence(currentPlatform());
  const mentor = names.mentor;
  const cap = job.budget.maxMentorUsd;
  const usual = estimateMentorUsd(job);
  const capMax = Math.max(20, Math.ceil(cap), Math.ceil((usual ?? 0) * 3));
  const local = estimateTime(job, 'local');
  const remote = estimateTime(job, 'hosted');
  const onHost = job.student.trainOn === 'hosted';
  const chosen = onHost ? remote : local;
  const comparing = baselines?.checked === true;
  const provider = job.student.hosted ? providerName(job.student.hosted) : null;
  const pricing = job.student.hosted ? presetOf(job.student.hosted)?.pricing : null;
  const hostedUsd = pricing ? aboutUsd(practiceUsd(pricing, remote)).toLowerCase() : null;
  const parts = [
    `${aboutSpan(chosen.trainingSeconds).toLowerCase()} of training ${onHost ? `on ${provider ?? 'the hosted copy'}` : `on ${device}`}`,
    `${formatAbout(testSeconds(job)).toLowerCase()} for the final test on ${device}`,
    ...(comparing
      ? [
          `up to ${formatAbout(comparisonSeconds(job, chosen)).toLowerCase()} for the three simpler versions`,
        ]
      : []),
  ];
  const joined = parts.join(', then ');
  const breakdown = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`;
  const placeLabel = onHost ? `${provider ?? 'the hosted'}'s copy` : device;
  const summary = `${aboutSpan(runSeconds(job, chosen, comparing))} in all on ${placeLabel}${
    onHost && hostedUsd ? `, ${hostedUsd} billed by ${provider ?? 'the host'}` : ''
  }, plus up to ${formatUsd(cap)} of ${mentor}.`;

  return (
    <section
      aria-labelledby="train-where"
      className="flex flex-col gap-[18px] border-t border-line-card pt-10"
    >
      <div className="flex flex-col gap-1.5">
        <Heading id="train-where">Where should it train?</Heading>
        <p className="m-0 max-w-[720px] text-fg-secondary text-pretty">
          {studentIntro(names.student)}, practices where you pick while {mentorIntro(names.mentor)},
          coaches it.
        </p>
      </div>
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard value="local" title={deviceLabel(currentPlatform())}>
          <span>
            {local.rounds.most === 0
              ? `Too slow for the time limit of ${capText(job.budget.maxWallMinutes)}`
              : `${aboutSpan(runSeconds(job, local, comparing))} in all, at no cost`}
          </span>
        </RadioCard>
        <RadioCard
          value="hosted"
          title={provider ? `Hosted on ${provider}` : 'A hosted copy'}
          disabled={!hosted.available}
          className={cn(
            !hosted.available && 'disabled:opacity-100 [&>span:first-child]:text-fg-muted',
          )}
        >
          <span className={hosted.available ? undefined : 'text-fg-secondary'}>
            {hosted.available
              ? `${aboutSpan(runSeconds(job, remote, comparing))} in all${
                  hostedUsd ? `, ${hostedUsd} billed by ${provider ?? 'the host'}` : ''
                }`
              : hosted.reason}
          </span>
        </RadioCard>
      </RadioCardGroup>
      <p className="m-0 text-lg font-medium text-pretty">{summary}</p>
      <details className="text-sm text-fg-secondary">
        <summary className="cursor-pointer select-none text-fg-muted transition-colors duration-150 hover:text-fg-secondary">
          How this is estimated
        </summary>
        <ul className="m-0 mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-pretty">
          <li>
            Training stops after {capText(job.budget.maxWallMinutes)} (set in Advanced settings),
            then the final test runs on {device}. {breakdown}
          </li>
          <li>
            {deviceLabel(currentPlatform())}: {roundsLine(job, local)}. Practice runs here, and{' '}
            {mentor} sees only the attempts and file samples it needs.
          </li>
          {hosted.available && provider && (
            <li>
              {provider}: {roundsLine(job, remote)}. It uses your {provider} key from Settings, and
              the practice tasks and the data they read go to {provider}.
            </li>
          )}
          <li>
            A round takes longer when its change looks promising, because the change is tested twice
            before it stays.
          </li>
        </ul>
      </details>
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

      <div className="flex flex-col gap-2.5 rounded-2xl border border-line-card bg-card px-[22px] py-5">
        <div className="flex items-baseline justify-between gap-4">
          <label htmlFor={capId} className="text-md">
            {mentor} spending cap
          </label>
          <span className="font-mono text-md">{formatUsd(cap)}</span>
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
          {usual === null
            ? `No price on file for ${mentor}. Training stops before a call would go over the cap.`
            : chosen.rounds.most > 0 && chosen.rounds.most < job.budget.maxRounds
              ? `${aboutUsd((usual / job.budget.maxRounds) * chosen.rounds.most)} for up to ${chosen.rounds.most} rounds, as many as fit. Training stops before a call would go over the cap.`
              : `${aboutUsd(usual)} if all ${job.budget.maxRounds} rounds run. Training stops before a call would go over the cap.`}
        </span>
      </div>

      {baselines && (
        <div className="flex flex-col gap-1.5">
          <Checkbox
            checked={baselines.checked}
            onCheckedChange={baselines.onCheckedChange}
            label="Also train three simpler versions to compare against"
            className="self-start"
          />
          <p className="m-0 pl-7 text-sm text-fg-muted text-pretty">
            {names.student} on its own, instructions {names.mentor} writes in one go, and{' '}
            {names.student} revising its own. They run after this agent, and the report puts all
            four side by side.
          </p>
        </div>
      )}
    </section>
  );
}
