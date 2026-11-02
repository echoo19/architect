import { StepTransition } from '@architect/ui';
import { Clarify } from '../flow/describe/Clarify';
import { DescribeHero } from '../flow/describe/DescribeHero';
import { useDraftStore } from '../flow/describe/draft-store';
import { useEdition } from '../shell/edition';
import { FlowShell } from '../shell/FlowShell';

/**
 * Step one of a new agent: describe the job, then answer the mentor's few questions until it has
 * drafted the job to review. The description and the conversation are two pages of the step.
 */
export function DescribeScreen() {
  const started = useDraftStore((state) => state.conversation.entries.length > 0);
  // A field of several organizations is the Lab's, and the header names what is being made.
  const field = useDraftStore((state) => state.organizations !== null);
  const lab = useEdition() === 'lab';
  return (
    <FlowShell title={field && lab ? 'New field' : 'New agent'} step="Describe">
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
