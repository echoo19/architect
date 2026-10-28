import { useState } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import {
  Button,
  ErrorState,
  SettingsRow,
  SettingsSection,
  Skeleton,
  VersionTag,
} from '@architect/ui';
import { ArrowUpRight, Undo2 } from 'lucide-react';
import { useVersions } from '../../api/graduates';
import { formatPercent } from '../../lib/format';
import { LessonsSection } from '../teach/LessonsSection';
import { MoveDialog } from './MoveDialog';
import {
  EVALUATION_LABELS,
  evaluationNote,
  moveFor,
  versionDate,
  versionOrigin,
  versionScore,
  type VersionMove,
} from './versions';

/**
 * Teaching: what the agent is being taught (flagged answers, teaching it something new, and
 * Improve agent), then its versions, newest first. Each version says whether it is the one
 * chats run on, how its own final test came out, what it was made from and when, and can be
 * promoted or rolled back to after a confirmation that says what changes.
 */
export function TeachingTab({ agent }: { agent: GraduateSummary }) {
  const versions = useVersions(agent.id);
  const [move, setMove] = useState<{ version: GraduateVersion; kind: VersionMove } | null>(null);
  const list = versions.data;
  const active = list?.find((version) => version.active) ?? null;
  const scored = list?.some((version) => versionScore(version) !== null) ?? false;

  return (
    <>
      <LessonsSection agent={agent} />
      <SettingsSection
        title="Versions"
        actions={
          // Names the score column: it ends where the scores do, left of the buttons' slot.
          scored && <span className="mr-[124px] text-sm text-fg-muted">Final test</span>
        }
      >
        {list ? (
          <ul aria-label="Versions" className="m-0 flex list-none flex-col p-0">
            {[...list].reverse().map((version) => (
              <VersionRow
                key={version.version}
                version={version}
                move={moveFor(version, active?.version ?? null)}
                onMove={(kind) => setMove({ version, kind })}
              />
            ))}
          </ul>
        ) : versions.status === 'error' ? (
          <ErrorState
            layout="inline"
            title="Couldn't load the versions"
            message={versions.error.message}
            onRetry={versions.reload}
            className="border-t border-line py-4"
          />
        ) : (
          <VersionSkeleton />
        )}
        {move && active && (
          <MoveDialog
            agent={agent}
            version={move.version}
            kind={move.kind}
            active={active}
            onClose={() => setMove(null)}
          />
        )}
      </SettingsSection>
    </>
  );
}

function VersionSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the versions" className="flex flex-col">
      {[0, 1].map((row) => (
        <div key={row} className="flex min-h-[60px] items-center gap-3 border-t border-line py-2.5">
          <Skeleton className="h-7 w-9 rounded-md" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

function statusOf(version: GraduateVersion): string {
  if (version.active) return 'Active';
  if (version.state === 'candidate') return 'Candidate';
  if (version.state === 'rejected') return 'Rejected';
  return EVALUATION_LABELS[version.evaluation];
}

function VersionRow({
  version,
  move,
  onMove,
}: {
  version: GraduateVersion;
  move: VersionMove | null;
  onMove: (kind: VersionMove) => void;
}) {
  const score = versionScore(version);
  const status = statusOf(version);
  // The label says the version's standing; its own test result leads the line under it unless
  // the label already is that result, and an experimental one says why it is.
  const note = evaluationNote(version);
  const meta = [
    status === note ? null : note,
    versionOrigin(version),
    versionDate(version.createdAt),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li aria-label={`Version ${version.version}`}>
      <SettingsRow
        icon={<VersionTag version={version.version} active={version.active} />}
        label={status}
        meta={meta}
      >
        <div className="flex items-center gap-4">
          {score && (
            <span className="flex items-baseline gap-2 tabular-nums">
              <span className="font-mono">{formatPercent(score)}</span>
              <span className="text-sm text-fg-muted">
                {score.pass} of {score.total} passed
              </span>
            </span>
          )}
          {/* The same width on every row, so the scores line up whether or not a row has one. */}
          <div className="flex w-[108px] justify-end">
            {move === 'promote' && (
              <Button size="xs" onClick={() => onMove('promote')}>
                <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
                Promote
              </Button>
            )}
            {move === 'rollback' && (
              <Button size="xs" onClick={() => onMove('rollback')}>
                <Undo2 size={14} strokeWidth={1.8} aria-hidden />
                Roll back
              </Button>
            )}
          </div>
        </div>
      </SettingsRow>
    </li>
  );
}
