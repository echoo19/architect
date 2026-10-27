import { useId } from 'react';
import type { Job } from '@architect/shared';
import { Checkbox, cn, Heading, RadioCard, RadioCardGroup, Slider } from '@architect/ui';
import { RotateCw } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { mentorName } from '../../lib/names';
import { currentPlatform, deviceLabel } from '../../lib/platform';
import {
  estimateMentorUsd,
  estimateTime,
  formatAbout,
  formatAboutUsd,
  type TrainPlace,
} from './estimates';
import { providerName, type HostedAvailability } from './hosted';

interface TrainingPlaceProps {
  job: Job;
  hosted: HostedAvailability;
  onPlaceChange: (place: TrainPlace) => void;
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
  const mentor = mentorName(job.mentor);
  const cap = job.budget.maxMentorUsd;
  const usual = estimateMentorUsd(job);
  const capMax = Math.max(20, Math.ceil(cap), Math.ceil((usual ?? 0) * 3));

  return (
    <section
      aria-labelledby="train-where"
      className="flex flex-col gap-[18px] border-t border-line-card pt-10"
    >
      <Heading id="train-where">Where should it train?</Heading>
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard value="local" title={deviceLabel(currentPlatform())}>
          <PlaceLines job={job} place="local" data="Files stay here" />
        </RadioCard>
        <RadioCard
          value="hosted"
          title={
            job.student.hosted ? `Hosted on ${providerName(job.student.hosted)}` : 'A hosted copy'
          }
          disabled={!hosted.available}
          className={cn(
            !hosted.available && 'disabled:opacity-100 [&>span:first-child]:text-fg-muted',
          )}
        >
          {hosted.available ? (
            <PlaceLines job={job} place="hosted" data="Tasks are sent to the host while training" />
          ) : (
            <>
              <span className="text-fg-muted">
                {formatAbout(estimateTime(job, 'hosted').seconds)}
              </span>
              <span className="text-fg-secondary">{hosted.reason}</span>
            </>
          )}
        </RadioCard>
      </RadioCardGroup>
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
        <span className="text-fg-secondary">
          {usual === null
            ? `No price on file for ${mentor}`
            : `Usually about ${formatAboutUsd(usual)}`}
        </span>
      </div>

      {baselines && (
        <Checkbox
          checked={baselines.checked}
          onCheckedChange={baselines.onCheckedChange}
          label="Also run the three baselines for comparison"
          className="self-start"
        />
      )}
    </section>
  );
}

function PlaceLines({ job, place, data }: { job: Job; place: TrainPlace; data: string }) {
  const estimate = estimateTime(job, place);
  const { maxRounds } = job.budget;
  return (
    <>
      <span>{formatAbout(estimate.seconds)}</span>
      {estimate.rounds < maxRounds && (
        <span>
          {estimate.rounds === 0
            ? 'The time cap ends it during the first round'
            : `The time cap fits ${estimate.rounds} of ${maxRounds} rounds`}
        </span>
      )}
      <span>{data}</span>
    </>
  );
}
