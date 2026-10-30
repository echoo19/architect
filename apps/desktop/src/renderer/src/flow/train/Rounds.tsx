import type { ReactNode } from 'react';
import type { Experiment, Intervention, Job, Round, RunStopReason } from '@architect/shared';
import { cn, Collapse, NumberTicker, Spinner, Stagger, StaggerItem } from '@architect/ui';
import { CircleAlert } from 'lucide-react';
import { ProblemState } from '../../components/ProblemState';
import { Appear, useFirstKeys } from '../appear';
import { Counted } from '../counted';
import { percent } from '../format';
import { RowButton, Section } from '../ledger';
import { outcomeNote } from './decision';
import {
  DISPOSITIONS,
  FIRST_DRAFT,
  INTERVENTIONS,
  TRAINING_END_ICONS,
  trainingEnd,
} from './evidence-words';
import { questionOfRound } from './questions';
import { changeCounts } from './run-state';

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

/** What the mentoring records say about each round, when there are any. */
export interface RoundRecords {
  experiments: readonly Experiment[];
  interventions: readonly Intervention[];
}

/**
 * Changes kept of those tried: from the experiment records when the run has them, rejected,
 * invalid and stopped ones included, else from its rounds. The first draft is the starting
 * point, not a change, so it isn't counted among them.
 */
function keptChanges(
  rounds: readonly Round[],
  draftRound: number | null,
  records: RoundRecords | null,
): { kept: number; tried: number } {
  const changes = records?.experiments.filter((experiment) => experiment.kind !== 'draft') ?? [];
  if (changes.length > 0) {
    return {
      kept: changes.filter((experiment) => experiment.disposition === 'kept').length,
      tried: changes.length,
    };
  }
  return changeCounts(rounds.filter((round) => round.index !== draftRound));
}

/**
 * Every round, newest first: the change it tried, what it did to the check tasks and how it ended.
 * The newest round is open under its line, with what is happening in it. When training is over,
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
  current,
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
  /** The newest round, opened: what is happening in it. */
  current: ReactNode;
}) {
  const EndIcon = stopReason ? TRAINING_END_ICONS[stopReason] : null;
  const first = useFirstKeys(rounds.map((round) => String(round.index)));
  const newest = rounds.at(-1)?.index;
  const counts = failure ? null : keptChanges(rounds, draftRound, records);
  return (
    <Section
      title="Rounds"
      actions={
        counts &&
        counts.tried > 0 && (
          <span className="text-small tabular-nums">
            <Counted said={`${counts.kept} of ${counts.tried}`}>
              <NumberTicker value={counts.kept} /> of <NumberTicker value={counts.tried} />
            </Counted>{' '}
            kept
          </span>
        )
      }
    >
      {failure ? (
        <div className="border-y border-line py-3">
          <ProblemState
            layout="inline"
            error={failure.error}
            title="Couldn't load how the rounds ended"
            onRetry={failure.reload}
          />
        </div>
      ) : rounds.length === 0 ? (
        <p className="m-0 border-y border-line py-3.5">
          {stopReason === 'target_met'
            ? 'No rounds were needed'
            : stopReason === undefined
              ? 'No rounds yet'
              : 'No rounds ran'}
        </p>
      ) : (
        <Stagger as="ol" className="m-0 list-none border-b border-line p-0">
          {stopReason && EndIcon && (
            <StaggerItem as="li" className="border-t border-line">
              <div className="grid min-h-12 grid-cols-[28px_minmax(0,1fr)] items-center gap-x-4">
                <EndIcon size={15} strokeWidth={1.8} aria-hidden />
                <span className="truncate">{trainingEnd(stopReason, job)}</span>
              </div>
            </StaggerItem>
          )}
          {[...rounds].reverse().map((round) => (
            <StaggerItem as="li" key={round.index} className="border-t border-line">
              <Appear added={!first.has(String(round.index))}>
                <RoundRow
                  job={job}
                  round={round}
                  draft={round.index === draftRound}
                  running={running}
                  ended={ended}
                  experiment={records?.experiments.find((item) => item.round === round.index)}
                  asked={records ? questionOfRound(round, records.interventions) : undefined}
                  open={round.index === newest}
                  onOpen={() => onOpen(round)}
                />
                <Collapse open={round.index === newest}>{current}</Collapse>
              </Appear>
            </StaggerItem>
          ))}
        </Stagger>
      )}
    </Section>
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
  open,
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
  /** The round is the newest, open under its line, which says what it asked and was answered. */
  open: boolean;
  onOpen: () => void;
}) {
  // A question says what was asked, or what the person answered, unless the round is open under
  // its line and says so there; a change that was made worse says what it harmed. Every other
  // outcome says all of it in its own words.
  const note = asked
    ? open
      ? null
      : asked.answer
        ? `Your answer: ${asked.answer.text}`
        : asked.question
    : experiment && !draft
      ? outcomeNote(experiment, job)
      : null;
  return (
    <RowButton
      onClick={onOpen}
      className={cn('min-h-12 grid-cols-[28px_minmax(0,1fr)_auto] py-2', note && 'py-2.5')}
    >
      <span className="font-mono text-small tabular-nums">
        {String(round.index).padStart(2, '0')}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{round.title ?? untitled(round)}</span>
        {note && <span className="truncate text-small">{note}</span>}
      </span>
      <RoundResult
        round={round}
        draft={draft}
        running={running}
        ended={ended}
        experiment={experiment}
        asked={asked}
      />
    </RowButton>
  );
}

/** Before and after on the check tasks, then how the change ended, in a column of its own. */
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
    const named = draft ? FIRST_DRAFT : words;
    return (
      <span className="flex items-center justify-end gap-6">
        {before && after && (
          <span className="w-[112px] text-right font-mono text-small tabular-nums">
            {percent(before)}% → {percent(after)}%
          </span>
        )}
        <Outcome
          icon={named.icon}
          tone={draft ? 'text-student' : words.tone}
          title={draft ? undefined : words.meaning}
        >
          {named.label}
        </Outcome>
      </span>
    );
  }
  // A question tries no change, so it has no result to measure: it waits, was answered, or the run
  // ended without anyone answering it.
  if (asked) {
    const { icon: Icon } = INTERVENTIONS.clarification;
    return (
      <Outcome icon={Icon} tone={asked.answer || ended ? '' : 'text-mentor'}>
        {asked.answer ? 'Answered' : ended ? 'Not answered' : 'Needs you'}
      </Outcome>
    );
  }
  if (round.status === 'failed') {
    return (
      <Outcome icon={CircleAlert} tone="text-danger">
        Failed
      </Outcome>
    );
  }
  if (running) {
    return (
      <span className="flex w-[128px] items-center justify-end gap-2 text-small">
        In progress
        <Spinner tone="mentor" />
      </span>
    );
  }
  return <span className="w-[128px] text-right text-small">Not finished</span>;
}

function Outcome({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof CircleAlert;
  tone: string;
  title?: string | undefined;
  children: ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'flex w-[128px] items-center justify-end gap-2 whitespace-nowrap text-small',
        tone,
      )}
    >
      <Icon size={14} strokeWidth={2} aria-hidden className="shrink-0" />
      {children}
    </span>
  );
}
