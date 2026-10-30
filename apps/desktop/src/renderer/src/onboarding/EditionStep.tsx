import type { Edition } from '@architect/shared';
import { RadioCard, RadioCardGroup } from '@architect/ui';
import { EDITIONS } from '../shell/edition';
import { StepIntro } from './SetupShell';

const ORDER: readonly Edition[] = ['personal', 'lab'];

export interface EditionStepProps {
  edition: Edition;
  onChoose: (edition: Edition) => void;
}

/** The first step: the app for one job, or the Lab. Either can be changed in Settings later. */
export function EditionStep({ edition, onChoose }: EditionStepProps) {
  return (
    <>
      <StepIntro title="Welcome to Architect">
        Choose how you&apos;ll use it. You can switch in Settings at any time.
      </StepIntro>
      <RadioCardGroup<Edition>
        aria-label="Edition"
        value={edition}
        onValueChange={onChoose}
        className="w-full max-w-[720px] gap-3.5"
      >
        {ORDER.map((option) => (
          <RadioCard key={option} value={option} title={EDITIONS[option].name}>
            {EDITIONS[option].says}
          </RadioCard>
        ))}
      </RadioCardGroup>
    </>
  );
}
