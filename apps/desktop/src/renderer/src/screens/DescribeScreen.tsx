import { Clarify } from '../flow/describe/Clarify';
import { DescribeHero } from '../flow/describe/DescribeHero';
import { useDraftStore } from '../flow/describe/draft-store';
import { FlowShell } from '../shell/FlowShell';

/**
 * Step one of a new agent: describe the job, then answer the mentor's few questions until it has
 * drafted the job to review.
 */
export function DescribeScreen() {
  const started = useDraftStore((state) => state.conversation.entries.length > 0);
  return (
    <FlowShell title="New agent" step="Describe">
      {started ? <Clarify /> : <DescribeHero />}
    </FlowShell>
  );
}
