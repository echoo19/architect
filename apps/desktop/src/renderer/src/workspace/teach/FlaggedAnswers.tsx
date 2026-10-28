import { useState } from 'react';
import type { Correction, GraduateSummary } from '@architect/shared';
import { Button, Drawer, DrawerContent, ErrorState, Skeleton } from '@architect/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useVersions } from '../../api/graduates';
import { useCorrections, useImprovements, useTeachingOverview } from '../../api/teaching';
import { shortModelName } from '../../lib/names';
import { versionDate } from '../settings/versions';
import { KindTile } from './kinds';
import {
  correctionStatus,
  flaggedSummary,
  KIND_SHORT,
  openCorrections,
  runningImprovement,
} from './lessons';
import { ProposalActions, ProposalView } from './Proposal';

/** Open ones first, then the ones already taught; newest first within each. */
function ordered(corrections: readonly Correction[]): Correction[] {
  const shown = corrections.filter((correction) => correction.status !== 'discarded');
  const newest = (a: Correction, b: Correction) => b.createdAt.localeCompare(a.createdAt);
  const open = openCorrections(shown).sort(newest);
  return [...open, ...shown.filter((correction) => !open.includes(correction)).sort(newest)];
}

/**
 * The agent's flagged answers: each one's lesson, kind and where it stands. Opening one shows
 * the lesson in full, and one still waiting for the person can be queued, applied or discarded
 * from there.
 */
export function FlaggedAnswers({
  agent,
  open,
  onClose,
}: {
  agent: GraduateSummary;
  open: boolean;
  onClose: () => void;
}) {
  const corrections = useCorrections(agent.id);
  const overview = useTeachingOverview(agent.id);
  const versions = useVersions(agent.id);
  const improvements = useImprovements(agent.id);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = ordered(corrections.data ?? []);
  const selected = list.find((correction) => correction.id === selectedId) ?? null;
  const improving = runningImprovement(improvements.data ?? []) !== null;
  const mentor = shortModelName(overview.data?.mentor ?? 'Spark');
  const nextVersion = versions.data
    ? Math.max(0, ...versions.data.map((version) => version.version)) + 1
    : null;
  // A lesson an improvement is teaching stays as it is until that improvement ends.
  const decidable =
    selected !== null &&
    (selected.status === 'proposed' || selected.status === 'queued') &&
    !(improving && selected.runId !== undefined);

  const close = () => {
    setSelectedId(null);
    onClose();
  };

  return (
    <Drawer open={open} onOpenChange={(next) => !next && close()}>
      <DrawerContent
        title={selected ? 'Flagged answer' : 'Flagged answers'}
        subtitle={
          selected
            ? `${correctionStatus(selected, improving)} · flagged ${versionDate(selected.createdAt)}`
            : (flaggedSummary(corrections.data ?? []) ?? undefined)
        }
        actions={
          selected && (
            <Button size="sm" variant="ghost" onClick={() => setSelectedId(null)}>
              <ChevronLeft size={15} strokeWidth={1.8} aria-hidden />
              All
            </Button>
          )
        }
        footer={
          selected &&
          decidable && (
            <ProposalActions
              graduateId={agent.id}
              correction={selected}
              nextVersion={nextVersion}
              onSettled={() => setSelectedId(null)}
            />
          )
        }
      >
        {selected ? (
          <ProposalView
            correction={selected}
            mentor={mentor}
            capUsd={overview.data?.correctionCapUsd ?? 0.25}
          />
        ) : corrections.status === 'error' && !corrections.data ? (
          <ErrorState
            layout="inline"
            title="Couldn't load the flagged answers"
            message={corrections.error.message}
            onRetry={corrections.reload}
          />
        ) : corrections.data ? (
          <ul aria-label="Flagged answers" className="m-0 flex list-none flex-col p-0">
            {list.map((correction) => (
              <li key={correction.id} className="border-t border-line first:border-t-0">
                <button
                  type="button"
                  onClick={() => setSelectedId(correction.id)}
                  className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3.5 rounded-md px-2 py-3 text-left transition-colors duration-150 hover:bg-row-hover"
                >
                  <KindTile kind={correction.proposal.kind} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="line-clamp-2 text-fg text-pretty">
                      {correction.proposal.lesson}
                    </span>
                    <span className="text-sm text-fg-muted">
                      {KIND_SHORT[correction.proposal.kind]} ·{' '}
                      {correctionStatus(correction, improving)}
                    </span>
                  </span>
                  <ChevronRight
                    size={16}
                    strokeWidth={1.8}
                    aria-hidden
                    className="shrink-0 text-fg-faint"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div
            aria-busy="true"
            aria-label="Loading the flagged answers"
            className="flex flex-col gap-4"
          >
            {[0, 1].map((row) => (
              <div key={row} className="flex items-center gap-3">
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="h-3.5 w-72" />
              </div>
            ))}
          </div>
        )}
      </DrawerContent>
    </Drawer>
  );
}
