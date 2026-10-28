import type { Round } from '@architect/shared';
import { cn, Panel, PanelHeader, PanelRow, Spinner } from '@architect/ui';
import { ArrowRight } from 'lucide-react';
import { percent } from '../format';

/** What a round is doing before the mentor has named its change. */
function untitled(round: Round): string {
  switch (round.status) {
    case 'attempting':
      return 'Practice tasks';
    case 'diagnosing':
      return 'Reading the failures';
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

/** Every round, newest first, with what its change did to the check tasks and the decision. */
export function Rounds({
  rounds,
  running,
  draftRound,
  onOpen,
  footer,
}: {
  rounds: readonly Round[];
  /** The newest unfinished round shows a spinner while the run is going. */
  running: boolean;
  /** The round that wrote the first full draft, or null when the run started from a setup. */
  draftRound: number | null;
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
          {[...rounds].reverse().map((round) => (
            <li key={round.index}>
              <RoundRow
                round={round}
                draft={round.index === draftRound}
                running={running}
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
  onOpen,
}: {
  round: Round;
  draft: boolean;
  running: boolean;
  onOpen: () => void;
}) {
  const reverted = round.decision === 'reverted';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'grid min-h-[54px] w-full grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3.5 border-t border-line-row px-7 text-left',
        'transition-colors duration-150 hover:bg-row-hover',
        reverted && 'text-fg-muted',
      )}
    >
      <span className={cn('font-mono', !reverted && 'text-fg-secondary')}>
        {String(round.index).padStart(2, '0')}
      </span>
      <span className={cn('truncate', reverted && 'line-through decoration-fg-ghost')}>
        {round.title ?? untitled(round)}
      </span>
      <RoundResult round={round} draft={draft} running={running} />
    </button>
  );
}

const DECISION_TONE = { kept: 'text-student', reverted: 'text-fg-muted' } as const;

function RoundResult({
  round,
  draft,
  running,
}: {
  round: Round;
  draft: boolean;
  running: boolean;
}) {
  if (round.devBefore && round.devAfter && round.decision) {
    return (
      <span className="flex items-baseline gap-3">
        <span className="font-mono text-sm tabular-nums">
          {percent(round.devBefore)}% → {percent(round.devAfter)}%
        </span>
        <span className={cn('w-[74px] text-sm', DECISION_TONE[round.decision])}>
          {draft ? 'First draft' : round.decision === 'kept' ? 'Kept' : 'Reverted'}
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
