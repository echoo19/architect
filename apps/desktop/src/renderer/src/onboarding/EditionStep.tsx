import type { Edition } from '@architect/shared';
import { RadioCard, RadioCardGroup } from '@architect/ui';
import { EDITIONS } from '../shell/edition';
import { StepIntro } from './SetupShell';

const ORDER: readonly Edition[] = ['personal', 'lab'];

/** What Architect does, in the words of the edition chosen: plain for one job, the Lab's own. */
const EDITION_PITCH: Record<Edition, string> = {
  personal:
    'A large model teaches a small one to do your work, tests it on tasks kept from both, and leaves it to run offline on this computer.',
  lab: "A frontier model engineers a small open model's harness and fine-tunes it on your work, judges it on tests sealed from both, and leaves it to run on-premise.",
};

export interface EditionStepProps {
  edition: Edition;
  onChoose: (edition: Edition) => void;
}

/** The first step: the app for one job, or the Lab. Either can be changed in Settings later. */
export function EditionStep({ edition, onChoose }: EditionStepProps) {
  return (
    <>
      <StepIntro title="Welcome to Architect">{EDITION_PITCH[edition]}</StepIntro>
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
