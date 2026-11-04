import type { WspExperiment, WspIteration } from '@architect/shared';
import { cn, DetailList, DrawerContent, DrawerSection, Skeleton } from '@architect/ui';
import { useWspProgram } from '../api/wsp';
import { CopyButton } from '../components/CopyButton';
import { ProblemState } from '../components/ProblemState';
import { mentorName, OUTCOME_WORDS, short } from './model';

const BLOCK =
  'm-0 max-h-[420px] overflow-auto whitespace-pre rounded-control bg-field px-4 py-3 font-mono text-small leading-5 scroll-quiet';

/** "8 of 13 passed, 2 of 16 looped": one measurement in counts. */
function counts(measurement: NonNullable<WspIteration['dev']>): string {
  const passed =
    measurement.passed === null ? null : `${measurement.passed} of ${measurement.checked} passed`;
  const looped = `${measurement.looped} of ${measurement.n} looped`;
  return passed === null ? looped : `${passed}, ${looped}`;
}

/** One program in full: what the mentor expected, its source as it ran, and what came of it. */
export function ProgramDrawer({
  experiment,
  iteration,
}: {
  experiment: WspExperiment;
  iteration: WspIteration;
}) {
  const source = useWspProgram(experiment.id, iteration.n);
  const mentor = mentorName(experiment.mentor);
  const failed = iteration.outcome === 'error' || iteration.outcome === 'timeout';
  return (
    <DrawerContent
      title={`Program ${iteration.n}`}
      subtitle={
        <span className="flex items-baseline gap-x-3">
          <span>{OUTCOME_WORDS[iteration.outcome]}</span>
          <span className="font-mono">{short(iteration.programSha256)}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-7">
        <DrawerSection title={`${mentor}'s hypothesis`} tone="mentor">
          <p className="m-0 text-ui text-pretty">{iteration.hypothesis}</p>
          {iteration.expected && (
            <p className="m-0 text-ui text-pretty">
              <span className="font-medium">Expected: </span>
              {iteration.expected}
            </p>
          )}
        </DrawerSection>

        <DrawerSection
          title="Program"
          actions={source.data ? <CopyButton text={source.data} label="Copy program" /> : undefined}
        >
          {source.data !== undefined ? (
            <pre aria-label="Program source" className={BLOCK}>
              {source.data}
            </pre>
          ) : source.status === 'error' ? (
            <ProblemState
              layout="inline"
              error={source.error}
              title="Couldn't load the program"
              onRetry={source.reload}
            />
          ) : (
            <Skeleton className="h-40 rounded-control" />
          )}
        </DrawerSection>

        <DrawerSection title="Output">
          <pre
            aria-label="Program output"
            className={cn(BLOCK, 'whitespace-pre-wrap', failed && 'text-danger')}
          >
            {iteration.output || 'It printed nothing.'}
          </pre>
        </DrawerSection>

        {iteration.reason && (
          <DrawerSection
            title={iteration.outcome === 'refused' ? 'Why it was refused' : 'How it ended'}
          >
            <p className="m-0 text-ui text-pretty text-danger">{iteration.reason}</p>
          </DrawerSection>
        )}

        {iteration.edits && iteration.edits.length > 0 && (
          <DrawerSection title="Tensors replaced">
            <DetailList
              valueFont="text"
              items={iteration.edits.map((edit) => ({
                label: edit.tensor,
                value: `${edit.changed.toLocaleString('en-US')} of ${edit.total.toLocaleString('en-US')} changed, ${(edit.relativeChange * 100).toFixed(2)}% by norm`,
              }))}
            />
          </DrawerSection>
        )}

        {iteration.candidateId && (
          <DrawerSection title="Candidate">
            <DetailList
              valueFont="text"
              items={[
                { label: 'Id', value: <span className="font-mono">{iteration.candidateId}</span> },
                ...(iteration.decision
                  ? [
                      {
                        label: 'Decision',
                        value: iteration.decision === 'kept' ? 'Kept' : 'Discarded',
                      },
                    ]
                  : []),
                ...(iteration.dev ? [{ label: 'On dev', value: counts(iteration.dev) }] : []),
              ]}
            />
          </DrawerSection>
        )}
      </div>
    </DrawerContent>
  );
}
