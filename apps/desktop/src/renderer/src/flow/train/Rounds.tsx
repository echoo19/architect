import type { Experiment, Intervention, Round } from '@architect/shared';
import { cn, Panel, PanelHeader, PanelRow, Spinner } from '@architect/ui';
import { ArrowRight, Flag } from 'lucide-react';
import { percent } from '../format';
import { DISPOSITIONS, FIRST_DRAFT, INTERVENTIONS, type Named } from './evidence-words';

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
 * Every round, newest first: the intervention it tried, what its change did to the check tasks
 * and how it ended. When training is over, the reason it ended closes the list.
 */
export function Rounds({
  rounds,
  running,
  draftRound,
  records,
  ended,
  onOpen,
  footer,
}: {
  rounds: readonly Round[];
  /** The newest unfinished round shows a spinner while the run is going. */
  running: boolean;
  /** The round that wrote the first full draft, or null when the run started from a setup. */
  draftRound: number | null;
  records: RoundRecords | null;
  /** Why training ended, once it has. */
  ended: string | null;
  onOpen: (round: Round) => void;
  footer: RoundsFooter | null;
}) {
  return (
    <Panel aria-label="Rounds" className="min-w-0 flex-[5_1_360px]">
      <PanelHeader title="Rounds" />
      {rounds.length === 0 ? (
        <PanelRow className="text-fg-muted">No rounds yet</PanelRow>
      ) : (
        <ol className="m-0 max-h-[324px] list-none overflow-y-auto p-0">
          {ended && (
            <li>
              <PanelRow className="grid-cols-[28px_minmax(0,1fr)] text-fg-secondary">
                <Flag size={14} strokeWidth={1.8} aria-hidden className="justify-self-center" />
                <span className="truncate">{ended}</span>
              </PanelRow>
            </li>
          )}
          {[...rounds].reverse().map((round) => (
            <li key={round.index}>
              <RoundRow
                round={round}
                draft={round.index === draftRound}
                running={running}
                experiment={records?.experiments.find((item) => item.round === round.index)}
                intervention={records?.interventions.find((item) => item.round === round.index)}
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
  round,
  draft,
  running,
  experiment,
  intervention,
  onOpen,
}: {
  round: Round;
  draft: boolean;
  running: boolean;
  experiment: Experiment | undefined;
  intervention: Intervention | undefined;
  onOpen: () => void;
}) {
  const disposition = experiment?.disposition ?? round.decision;
  const struck = disposition !== undefined && disposition !== 'kept';
  const kind: Named | null = draft
    ? FIRST_DRAFT
    : intervention
      ? INTERVENTIONS[intervention.type]
      : null;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'grid min-h-[54px] w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-7 text-left',
        'transition-colors duration-150 hover:bg-row-hover',
        struck && 'text-fg-muted',
      )}
    >
      <span className={cn('font-mono', !struck && 'text-fg-secondary')}>
        {String(round.index).padStart(2, '0')}
      </span>
      <span className="flex min-w-0 items-center gap-2.5">
        {kind && (
          <kind.icon
            size={14}
            strokeWidth={1.8}
            role="img"
            aria-label={kind.label}
            className={cn('shrink-0', struck ? 'text-fg-faint' : 'text-mentor')}
          />
        )}
        <span className={cn('truncate', struck && 'line-through decoration-fg-ghost')}>
          {round.title ?? untitled(round)}
        </span>
      </span>
      <RoundResult round={round} draft={draft} running={running} experiment={experiment} />
    </button>
  );
}

function RoundResult({
  round,
  draft,
  running,
  experiment,
}: {
  round: Round;
  draft: boolean;
  running: boolean;
  experiment: Experiment | undefined;
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
          className={cn(
            'w-[74px] text-sm',
            draft ? 'text-student' : disposition === 'reverted' ? 'text-fg-muted' : words.tone,
          )}
        >
          {draft ? 'First draft' : words.label}
        </span>
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
