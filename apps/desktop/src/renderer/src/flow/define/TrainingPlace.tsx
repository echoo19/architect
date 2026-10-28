import { useId } from 'react';
import type { Job } from '@architect/shared';
import { Checkbox, cn, Heading, RadioCard, RadioCardGroup, Slider } from '@architect/ui';
import { RotateCw } from 'lucide-react';
import { formatUsd } from '../../lib/format';
import { mentorIntro, studentIntro } from '../../lib/names';
import { currentPlatform, deviceInSentence, deviceLabel } from '../../lib/platform';
import { inSentence, listInSentence } from '../../workspace/labels';
import { modelNames } from '../names';
import {
  aboutUsd,
  capText,
  comparisonCost,
  comparisonSeconds,
  estimateMentorUsd,
  estimateTime,
  finalTestSummary,
  formatAbout,
  limitText,
  practiceUsd,
  roundsLine,
  taskTimeText,
  testSeconds,
  tooSlow,
  trainingSummary,
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
  const pricing = job.student.hosted ? presetOf(job.student.hosted)?.pricing : null;
  const hostedBill = pricing ? inSentence(aboutUsd(practiceUsd(pricing, remote))) : null;
  const biller = provider ?? 'the host';

  // The mentor's expected cost counts the rounds that fit in the time limit.
  const countedRounds =
    chosen.rounds.most > 0 ? Math.min(chosen.rounds.most, maxRounds) : maxRounds;
  const expected = usual === null ? null : (usual / maxRounds) * countedRounds;
  const counted =
    countedRounds < maxRounds
      ? `${countedRounds} rounds, the most that fit in the ${limit} limit`
      : `all ${maxRounds} rounds`;

  const extra = comparisonCost(job, chosen, pricing);
  const adds = listInSentence(
    [
      formatAbout(comparisonSeconds(job, chosen)),
      ...(extra.hostedUsd === null ? [] : [`${aboutUsd(extra.hostedUsd)} billed by ${biller}`]),
      ...(extra.mentorUsd === null ? [] : [`${aboutUsd(extra.mentorUsd)} of ${mentor}`]),
    ],
    'and',
  );

  return (
    <section
      aria-labelledby="train-where"
      className="flex flex-col gap-[18px] border-t border-line-card pt-10"
    >
      <div className="flex flex-col gap-1.5">
        <Heading id="train-where">Where should it train?</Heading>
        <p className="m-0 max-w-[720px] text-fg-secondary text-pretty">
          {studentIntro(student)}, practices where you pick. {mentorIntro(mentor)}, is a cloud model
          that coaches it in rounds: each round, {mentor} changes {student}&apos;s instructions,
          skills or tools and checks whether that helped.
        </p>
        <p className="m-0 max-w-[720px] text-fg-secondary text-pretty">
          Training stops at the {Math.round(job.requirements.passRate * 100)}% target
          {chosen.rounds.most >= maxRounds && `, after ${maxRounds} rounds,`} or after{' '}
          {capText(maxWallMinutes)}, whichever comes first, or sooner if changes stop helping. Then
          the final test runs on {device}.
        </p>
      </div>
      <RadioCardGroup
        aria-label="Where should it train?"
        value={job.student.trainOn}
        onValueChange={onPlaceChange}
      >
        <RadioCard value="local" title={deviceLabel(currentPlatform())}>
          <span>
            {student} practices on {device}, {taskTimeText('local')} a task. The practice is free.
          </span>
          {localSlow && <span>{localSlow}</span>}
        </RadioCard>
        <RadioCard
          value="hosted"
          title={provider ? `Hosted on ${provider}` : 'A hosted copy'}
          disabled={!hosted.available}
          className={cn(
            !hosted.available && 'disabled:opacity-100 [&>span:first-child]:text-fg-muted',
          )}
        >
          <span>
            A hosted copy of {student}
            {provider ? ` on ${provider}` : ''}, {taskTimeText('hosted')} a task. Your practice
            tasks and the files they read are sent there.
          </span>
          {hosted.available ? (
            <>
              {hostedBill && (
                <span>
                  Up to {hostedBill} for practice, billed to your {biller} account.
                </span>
              )}
              {remoteSlow && <span>{remoteSlow}</span>}
            </>
          ) : (
            <span>{hosted.reason}</span>
          )}
        </RadioCard>
      </RadioCardGroup>
      <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-md">
        <dt className="text-fg-secondary">Training</dt>
        <dd className="m-0 text-pretty">
          {trainingSummary(job, chosen, onHost ? (provider ?? 'the hosted copy') : device)}
        </dd>
        <dt className="text-fg-secondary">Final test</dt>
        <dd className="m-0 text-pretty">{finalTestSummary(job, device)}</dd>
      </dl>
      <details className="text-sm text-fg-secondary">
        <summary className="cursor-pointer select-none text-fg-muted transition-colors duration-150 hover:text-fg-secondary">
          How this is estimated
        </summary>
        <ul className="m-0 mt-2.5 flex list-disc flex-col gap-1.5 pl-5 text-pretty">
          <li>
            Training stops after {capText(maxWallMinutes)} (set in Advanced settings), wherever it
            runs. The final test is separate: it runs on {device} afterwards.
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
          {baselines && (
            <li>
              The three simpler versions add three more final tests,{' '}
              {inSentence(formatAbout(testSeconds(job)))} each, and {student} revising its own,
              which has the same {capText(maxWallMinutes)} limit.
            </li>
          )}
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
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <label htmlFor={capId} className="text-md">
            {mentor} spending cap
          </label>
          <span className="text-md text-fg-secondary">
            {expected !== null && expected < cap && `${inSentence(aboutUsd(expected))} expected, `}
            never more than <span className="font-mono text-fg">{formatUsd(cap)}</span>
          </span>
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
            ? `No price on file for ${mentor}. Training stops before a call would go over the cap.`
            : expected < cap
              ? `Based on ${counted}. Training stops before a call would go over the cap.`
              : `${aboutUsd(expected)} for ${counted}, more than this cap. Training may stop early.`}
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
          <p className="m-0 pl-7 text-base text-fg-secondary text-pretty">Adds {adds}.</p>
          <p className="m-0 pl-7 text-sm text-fg-muted text-pretty">
            {student} on its own, instructions {mentor} writes in one go, and {student} revising its
            own. They run after this agent, and the report puts all four side by side.
          </p>
        </div>
      )}
    </section>
  );
}
