import { useId } from 'react';
import type { Job } from '@architect/shared';
import { Checkbox, cn, Heading, RadioCard, RadioCardGroup, Slider } from '@architect/ui';
import { RotateCw } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { mentorIntro, studentIntro } from '../../lib/names';
import { currentPlatform, deviceInSentence, deviceLabel } from '../../lib/platform';
import { modelNames } from '../names';
import {
  aboutUsd,
  estimateMentorUsd,
  estimateTime,
  formatAbout,
  hostedAdvantage,
  roundsLine,
} from './estimates';
import { providerName, type HostedAvailability } from './hosted';

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
  const advantage = hosted.available ? hostedAdvantage(job, local, remote) : null;
  const provider = job.student.hosted ? providerName(job.student.hosted) : null;

  return (
    <section
      aria-labelledby="train-where"
      className="flex flex-col gap-[18px] border-t border-line-card pt-10"
    >
      <div className="flex flex-col gap-1.5">
        <Heading id="train-where">Where should it train?</Heading>
        <p className="m-0 max-w-[720px] text-fg-secondary text-pretty">
          {studentIntro(names.student)}, practices where you choose while{' '}
          {mentorIntro(names.mentor)}, coaches it from the cloud. Times include the final test,
          which always runs on {device}.
        </p>
      </div>
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard value="local" title={deviceLabel(currentPlatform())}>
          <span>{formatAbout(local.seconds)} here</span>
          <span>{roundsLine(job, local)}</span>
          {advantage && <span className="text-fg">{advantage}</span>}
          <span>Files stay on {device}</span>
        </RadioCard>
        <RadioCard
          value="hosted"
          title={provider ? `Hosted on ${provider}` : 'A hosted copy'}
          disabled={!hosted.available}
          className={cn(
            !hosted.available && 'disabled:opacity-100 [&>span:first-child]:text-fg-muted',
          )}
        >
          {hosted.available ? (
            <>
              <span>{formatAbout(remote.seconds)}</span>
              <span>{roundsLine(job, remote)}</span>
              <span>Tasks go to {provider ?? 'the host'} while training</span>
            </>
          ) : (
            <>
              <span className="text-fg-muted">{formatAbout(remote.seconds)}</span>
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
        <span className="text-fg-secondary text-pretty">
          {usual === null
            ? `No price on file for ${mentor}. Training stops before a call would go over the cap.`
            : `${aboutUsd(usual)} for ${job.budget.maxRounds} rounds. Training stops before a call would go over the cap.`}
        </span>
      </div>

      {baselines && (
        <div className="flex flex-col gap-1.5">
          <Checkbox
            checked={baselines.checked}
            onCheckedChange={baselines.onCheckedChange}
            label="Also run the three baselines for comparison"
            className="self-start"
          />
          <p className="m-0 pl-7 text-sm text-fg-muted text-pretty">
            {names.student} with no setup, a setup {names.mentor} writes once, and {names.student}{' '}
            correcting itself. The report puts all four side by side.
          </p>
        </div>
      )}
    </section>
  );
}
