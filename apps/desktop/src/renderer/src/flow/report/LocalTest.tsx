import type { ReactNode } from 'react';
import { CodedError, type ReportCard } from '@architect/shared';
import { Button, Heading, Skeleton, StatusMark } from '@architect/ui';
import { Laptop } from 'lucide-react';
import { ProblemState } from '../../components/ProblemState';
import { currentPlatform, deviceInSentence } from '../../lib/platform';
import { formatAnswerTime, formatRate } from '../format';
import { localTestTime, type RetestView } from './retest';
import { missedRequirements } from './requirements';
import { useLocalCard, useRetest } from './use-retest';

/** "About 2.5 hours" in the middle of a sentence: "It takes about 2.5 hours". */
function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** A run whose records aren't on this computer, such as an agent that came from another one. */
function isGone(error: Error): boolean {
  return error instanceof CodedError && error.code === 'run_not_found';
}

/** What the card says: a mark, what it is about, and a line or two under it. */
interface Say {
  mark: ReactNode;
  title: string;
  lines: string;
}

function say(view: RetestView, local: ReportCard | null, report: ReportCard, device: string): Say {
  switch (view.phase) {
    case 'idle':
      return {
        mark: <Laptop size={18} strokeWidth={1.6} className="text-fg" aria-hidden />,
        title: `Test it on ${device}`,
        lines: `Run its final test here to see how the agent does on its own. It takes ${lowerFirst(localTestTime(report.test.score.total))} and uses the graphics card.`,
      };
    case 'testing': {
      const far =
        view.done === null || view.total === null
          ? 'Waiting for the first answer.'
          : `${view.done} of ${view.total} tasks scored.`;
      return {
        mark: <StatusMark state="working" size={18} label="Testing" />,
        title: `Testing on ${device}`,
        lines: `${far} You can leave this page. The test keeps going.`,
      };
    }
    case 'paused':
      return {
        mark: <StatusMark state="attention" size={18} label="Stopped" />,
        title: `The test on ${device} stopped`,
        lines: view.error,
      };
    case 'finished': {
      if (local === null) {
        return {
          mark: <StatusMark state="working" size={18} label="Loading" />,
          title: `Testing on ${device} is done`,
          lines: 'Reading its result.',
        };
      }
      const passed = missedRequirements(local).length === 0;
      const { score, latencyMs } = local.test;
      return {
        mark: <StatusMark state={passed ? 'ok' : 'attention'} size={18} />,
        title: passed ? `Passed on ${device}` : `Below the target on ${device}`,
        lines: `${score.pass} of ${score.total} right (${formatRate(score)}). Typical answer time ${formatAnswerTime(latencyMs.p50)}, 95% within ${formatAnswerTime(latencyMs.p95)}. Online it got ${report.test.score.pass} of ${report.test.score.total}.`,
      };
    }
  }
}

/**
 * The final test of an agent whose own ran on the online copy, taken again on this computer:
 * the offer to run it, with how long it takes and that it uses the graphics card, how far it has
 * got, why it stopped, and its result when it is done. An agent whose records aren't here can't
 * be tested here, and the offer isn't made.
 */
export function LocalTest({ report }: { report: ReportCard }) {
  const { detail, view, starting, start } = useRetest(report);
  const local = useLocalCard(report);
  const device = deviceInSentence(currentPlatform());

  if (detail.status === 'error' && detail.data === undefined) {
    if (isGone(detail.error)) return null;
    return (
      <ProblemState
        layout="inline"
        error={detail.error}
        title={`Couldn't check whether this was tested on ${device}`}
        onRetry={detail.reload}
      />
    );
  }
  if (detail.data === undefined) return <Skeleton className="h-[92px] w-full rounded-card" />;

  const { mark, title, lines } = say(view, local.data ?? null, report, device);
  return (
    <section
      aria-label={`Test on ${device}`}
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 rounded-card bg-card px-[22px] py-5 shadow-edge"
    >
      <div className="flex min-w-0 flex-[1_1_360px] items-start gap-3.5">
        <span className="mt-0.5 flex shrink-0">{mark}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <Heading as="h2">{title}</Heading>
          <p className="m-0 text-fg text-pretty">{lines}</p>
        </div>
      </div>
      {(view.phase === 'idle' || view.phase === 'paused') && (
        <Button size="md" loading={starting} onClick={() => void start()}>
          {view.phase === 'idle' ? `Test on ${device}` : 'Try again'}
        </Button>
      )}
    </section>
  );
}
