import type { Experiment, Intervention, Job, Round, RunStopReason } from '@architect/shared';
import { cn, Panel, PanelHeader, PanelRow, Spinner } from '@architect/ui';
import { ArrowRight } from 'lucide-react';
import { ProblemState } from '../../components/ProblemState';
import { percent } from '../format';
import { outcomeNote } from './decision';
import { DISPOSITIONS, TRAINING_END_ICONS, trainingEnd } from './evidence-words';
import { questionOfRound } from './questions';

/** What a round is doing before the mentor has named its change. */
function untitled(round: Round): string {
  switch (round.status) {
    case 'attempting':
      return 'Practice tasks';
    case 'diagnosing':
      return 'Reading the failures';
    case 'teaching':
      return 'Checking corrections';
    case 'training':
      return 'Training weights';
    case 'clarifying':
      return 'Waiting for your answer';
    case 'evaluating':
      return 'Scoring the change';
    case 'decided':
    case 'failed':
      return 'Untitled change';
  }
}

export interface RoundsFooter {
  label: string;
  onClick: () => void;
}

/** What the mentoring records say about each round, when there are any. */
export interface RoundRecords {
  experiments: readonly Experiment[];
  interventions: readonly Intervention[];
}

/**
 * Every round, newest first: the change it tried and its kind, what the change did to the check
 * tasks, how it ended and, when it isn't in the agent, why in a few words. When training is over,
 * the reason it ended closes the list.
 */
export function Rounds({
  job,
  rounds,
  running,
  ended,
  draftRound,
  records,
  failure,
  stopReason,
  onOpen,
  footer,
}: {
  job: Job;
  rounds: readonly Round[];
  /** The newest unfinished round shows a spinner while the run is going. */
  running: boolean;
  /** The run is over, so a question still unanswered never will be. */
  ended: boolean;
  /** The round that wrote the first full draft, or null when the run started from a setup. */
  draftRound: number | null;
  records: RoundRecords | null;
  /** The mentoring records couldn't be read: the rounds can't say how they ended. */
  failure: { error: Error; reload: () => void } | null;
  /** Why training ended, once it has. */
  stopReason: RunStopReason | undefined;
  onOpen: (round: Round) => void;
  footer: RoundsFooter | null;
}) {
  const EndIcon = stopReason ? TRAINING_END_ICONS[stopReason] : null;
  return (
    <Panel aria-label="Rounds" className="min-w-0 flex-[5_1_360px]">
      <PanelHeader title="Rounds" />
      {failure ? (
        <PanelRow className="py-3">
          <ProblemState
            layout="inline"
            error={failure.error}
            title="Couldn't load how the rounds ended"
            onRetry={failure.reload}
          />
        </PanelRow>
      ) : rounds.length === 0 ? (
        <PanelRow className="text-fg-muted">No rounds yet</PanelRow>
      ) : (
        <ol className="m-0 max-h-[372px] list-none overflow-y-auto p-0">
          {stopReason && EndIcon && (
            <li>
              <PanelRow className="grid-cols-[28px_minmax(0,1fr)] text-fg-secondary">
                <EndIcon size={14} strokeWidth={1.8} aria-hidden className="justify-self-center" />
                <span className="truncate">{trainingEnd(stopReason, job)}</span>
              </PanelRow>
            </li>
          )}
          {[...rounds].reverse().map((round) => (
            <li key={round.index}>
              <RoundRow
                job={job}
                round={round}
                draft={round.index === draftRound}
                running={running}
                ended={ended}
                experiment={records?.experiments.find((item) => item.round === round.index)}
                asked={records ? questionOfRound(round, records.interventions) : undefined}
                onOpen={() => onOpen(round)}
              />
            </li>
          ))}
        </ol>
      )}
      {footer && (
        <button
          type="button"
          onClick={footer.onClick}
          className="group mt-auto flex min-h-[54px] items-center justify-end gap-3 border-t border-line-row px-7 text-left transition-colors duration-150"
        >
          <span className="flex shrink-0 items-center gap-2 text-fg-secondary group-hover:text-fg">
            {footer.label}
            <ArrowRight size={14} strokeWidth={2} aria-hidden />
          </span>
        </button>
      )}
    </Panel>
  );
}

function RoundRow({
  job,
  round,
  draft,
  running,
  ended,
  experiment,
  asked,
  onOpen,
}: {
  job: Job;
  round: Round;
  draft: boolean;
  running: boolean;
  ended: boolean;
  experiment: Experiment | undefined;
  /** The question the round put to the person, when it was one. */
  asked: Intervention | undefined;
  onOpen: () => void;
}) {
  const disposition = experiment?.disposition ?? round.decision;
  // A change that isn't in the agent reads quieter than one that is, and is never struck out.
  const quiet = disposition !== undefined && disposition !== 'kept';
  // A draft is the whole first setup, so it says how it came about; a question, what was asked.
  const note = draft
    ? 'Written from the job'
    : asked
      ? asked.answer
        ? `Your answer: ${asked.answer.text}`
        : asked.question
      : experiment
        ? outcomeNote(experiment, job)
        : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'grid min-h-[62px] w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-7 py-2 text-left',
        'transition-colors duration-150 hover:bg-row-hover',
        quiet && 'text-fg-muted',
      )}
    >
      <span className={cn('font-mono', !quiet && 'text-fg-secondary')}>
        {String(round.index).padStart(2, '0')}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="truncate">{round.title ?? untitled(round)}</span>
        {note && <span className="truncate text-sm text-fg-muted">{note}</span>}
      </span>
      <RoundResult
        round={round}
        draft={draft}
        running={running}
        ended={ended}
        experiment={experiment}
        asked={asked}
      />
    </button>
  );
}

function RoundResult({
  round,
  draft,
  running,
  ended,
  experiment,
  asked,
}: {
  round: Round;
  draft: boolean;
  running: boolean;
  ended: boolean;
  experiment: Experiment | undefined;
  asked: Intervention | undefined;
}) {
  const disposition = experiment?.disposition ?? round.decision;
  const before = experiment?.devBefore ?? round.devBefore;
  const after = experiment?.devAfter ?? round.devAfter;
  if (disposition) {
    const words = DISPOSITIONS[disposition];
    return (
      <span className="flex items-baseline gap-3">
        {before && after && (
          <span className="font-mono text-sm tabular-nums">
            {percent(before)}% → {percent(after)}%
          </span>
        )}
        <span
          title={draft ? undefined : words.meaning}
          className={cn(
            'min-w-[84px] whitespace-nowrap text-right text-sm',
            draft ? 'text-student' : words.tone,
          )}
        >
          {draft ? 'First draft' : words.label}
        </span>
      </span>
    );
  }
  // A question tries no change, so it has no result to measure: it waits, was answered, or the run
  // ended without anyone answering it.
  if (asked) {
    return (
      <span
        className={cn(
          'min-w-[84px] whitespace-nowrap text-right text-sm',
          !asked.answer && ended ? 'text-fg-muted' : 'text-mentor',
        )}
      >
        {asked.answer ? 'Answered' : ended ? 'Not answered' : 'Needs you'}
      </span>
    );
  }
  if (round.status === 'failed') return <span className="text-sm text-danger">Failed</span>;
  if (running) {
    return (
      <span className="flex items-center gap-2 text-sm text-fg-muted">
        In progress
        <Spinner tone="mentor" />
      </span>
    );
  }
  return <span className="text-sm text-fg-muted">Not finished</span>;
}
