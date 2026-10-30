import { StepTransition } from '@architect/ui';
import { Clarify } from '../flow/describe/Clarify';
import { DescribeHero } from '../flow/describe/DescribeHero';
import { useDraftStore } from '../flow/describe/draft-store';
import { FlowShell } from '../shell/FlowShell';

/**
 * Step one of a new agent: describe the job, then answer the mentor's few questions until it has
 * drafted the job to review. The description and the conversation are two pages of the step.
 */
export function DescribeScreen() {
  const started = useDraftStore((state) => state.conversation.entries.length > 0);
  return (
    <FlowShell title="New agent" step="Describe">
      <StepTransition
        transitionKey={started ? 'conversation' : 'description'}
        direction={started ? 1 : -1}
        className="h-full"
      >
        {started ? <Clarify /> : <DescribeHero />}
      </StepTransition>
    </FlowShell>
  );
}
