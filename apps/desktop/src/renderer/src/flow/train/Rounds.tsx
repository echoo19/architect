import type { Round } from '@architect/shared';
import { cn, Panel, PanelHeader, PanelRow, Spinner } from '@architect/ui';
import { ArrowRight } from 'lucide-react';
import { percent } from '../format';
import type { ModelNames } from './phase';

/** What a round is doing before the mentor has named its change. */
function untitled(round: Round): string {
  switch (round.status) {
    case 'attempting':
      return 'Practice tasks';
    case 'diagnosing':
      return 'Reading the failures';
    case 'evaluating':
      return 'Checking the change';
    case 'decided':
    case 'failed':
      return 'Untitled change';
  }
}

export interface RoundsFooter {
  label: string;
  onClick: () => void;
}

/** Every round, newest first, with what its change did to the check score. */
export function Rounds({
  rounds,
  running,
  names,
  onOpen,
  footer,
}: {
  rounds: readonly Round[];
  /** The newest unfinished round shows a spinner while the run is going. */
  running: boolean;
  names: ModelNames;
  onOpen: (round: Round) => void;
  footer: RoundsFooter | null;
}) {
  return (
    <Panel aria-label="Rounds" className="min-w-0 flex-[5_1_360px]">
      <PanelHeader title="Rounds" />
      {rounds.length === 0 ? (
        <PanelRow className="text-fg-secondary">
          The first round starts once {names.mentor} has seen how {names.student} does.
        </PanelRow>
      ) : (
        <ol className="m-0 max-h-[324px] list-none overflow-y-auto p-0">
          {[...rounds].reverse().map((round) => (
            <li key={round.index}>
              <RoundRow round={round} running={running} onOpen={() => onOpen(round)} />
            </li>
          ))}
        </ol>
      )}
      {footer && (
        <button
          type="button"
          onClick={footer.onClick}
          className="mt-auto flex min-h-[54px] items-center justify-end gap-2 border-t border-line-row px-7 text-fg-secondary transition-colors duration-150 hover:text-fg"
        >
          {footer.label}
          <ArrowRight size={14} strokeWidth={2} aria-hidden />
        </button>
      )}
    </Panel>
  );
}

function RoundRow({
  round,
  running,
  onOpen,
}: {
  round: Round;
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
        {reverted && <span className="sr-only">, reverted</span>}
      </span>
      <RoundResult round={round} running={running} />
    </button>
  );
}

function RoundResult({ round, running }: { round: Round; running: boolean }) {
  if (round.devBefore && round.devAfter) {
    return (
      <span className="font-mono text-sm tabular-nums">
        {percent(round.devBefore)} → {percent(round.devAfter)}
      </span>
    );
  }
  if (round.status === 'failed') return <span className="text-sm text-danger">Failed</span>;
  if (running) return <Spinner tone="mentor" label="In progress" />;
  return <span className="text-sm text-fg-muted">Not finished</span>;
}
