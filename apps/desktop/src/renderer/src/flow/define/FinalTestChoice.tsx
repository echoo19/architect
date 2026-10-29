import type { Job, StudentTarget } from '@architect/shared';
import { RadioCard, RadioCardGroup, SettingsSection } from '@architect/ui';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { finalTestFacts, FINAL_TEST_MARKS } from './final-test';
import { aKey, providerName, type HostedAvailability } from './hosted';

/** Why the online copy can't take the final test, said from inside Advanced settings. */
function unavailableReason(job: Job, hosted: Exclude<HostedAvailability, { available: true }>) {
  if (hosted.why === 'no_host') return "Choose an online copy under Agent's model first";
  if (hosted.why === 'no_key' && job.student.hosted) {
    return `Add ${aKey(providerName(job.student.hosted))} under Agent's model first`;
  }
  return hosted.reason;
}

interface FinalTestChoiceProps {
  job: Job;
  place: StudentTarget;
  onPlaceChange: (place: StudentTarget) => void;
  hosted: HostedAvailability;
}

/**
 * Where the agent takes the final test: on this computer, which is what the agent is later run
 * on, or on the online copy, which is faster and leaves the agent marked as tested online until it
 * is tested here. Each says how long it takes and what it costs.
 */
export function FinalTestChoice({ job, place, onPlaceChange, hosted }: FinalTestChoiceProps) {
  return (
    <SettingsSection title="Final test">
      <RadioCardGroup
        aria-label="Where the final test runs"
        value={place}
        onValueChange={onPlaceChange}
        className="grid-cols-1"
      >
        <RadioCard value="local" title={`On ${deviceInSentence(currentPlatform())}`}>
          <span>{finalTestFacts(job, 'local')}</span>
          <span>{FINAL_TEST_MARKS.local}</span>
        </RadioCard>
        <RadioCard value="hosted" title="On the online copy" unavailable={!hosted.available}>
          {hosted.available ? (
            <>
              <span>{finalTestFacts(job, 'hosted')}</span>
              <span>{FINAL_TEST_MARKS.hosted}</span>
            </>
          ) : (
            <span>{unavailableReason(job, hosted)}</span>
          )}
        </RadioCard>
      </RadioCardGroup>
    </SettingsSection>
  );
}
