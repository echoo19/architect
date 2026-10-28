import { useState } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import { Button, SettingsRow, SettingsSection, Skeleton, VersionTag } from '@architect/ui';
import { ArrowUpRight, Undo2 } from 'lucide-react';
import { useVersions } from '../../api/graduates';
import { ProblemState } from '../../components/ProblemState';
import { formatPercent } from '../../lib/format';
import { LessonsSection } from '../teach/LessonsSection';
import { MoveDialog } from './MoveDialog';
import {
  evaluationNote,
  MOVE_WORDS,
  moveFor,
  standing,
  versionDate,
  versionOrigin,
  versionScore,
  type VersionMove,
} from './versions';

/**
 * Teaching: what the agent is being taught (flagged answers, teaching it something new, and
 * Improve), then its versions, newest first. Each version says whether it is the one in use, how
 * its own final test came out, what it was made from and when, and can be used, or gone back to,
 * after a confirmation that says what changes.
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
          scored && <span className="mr-[184px] text-sm text-fg-muted">Final test</span>
        }
      >
        {list ? (
          <ul aria-label="Versions" className="m-0 flex list-none flex-col p-0">
            {[...list].reverse().map((version) => (
              <VersionRow
                key={version.version}
                version={version}
                active={active?.version ?? null}
                move={moveFor(version, active?.version ?? null)}
                onMove={(kind) => setMove({ version, kind })}
              />
            ))}
          </ul>
        ) : versions.status === 'error' ? (
          <ProblemState
            layout="inline"
            error={versions.error}
            title="Couldn't load the versions"
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

function VersionRow({
  version,
  active,
  move,
  onMove,
}: {
  version: GraduateVersion;
  /** The version in use, for what the others are to it. */
  active: number | null;
  move: VersionMove | null;
  onMove: (kind: VersionMove) => void;
}) {
  const score = versionScore(version);
  // The label says what the version is to the agent. A score that fell short, or is missing,
  // says so under it; one that passed has nothing to add to the score beside it.
  const meta = [
    version.evaluation === 'ready' ? null : evaluationNote(version),
    versionOrigin(version),
    versionDate(version.createdAt),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <li aria-label={`Version ${version.version}`}>
      <SettingsRow
        icon={<VersionTag version={version.version} active={version.active} />}
        label={standing(version, active)}
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
          <div className="flex w-[168px] justify-end">
            {move !== null && (
              <Button size="xs" onClick={() => onMove(move)}>
                {move === 'promote' ? (
                  <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
                ) : (
                  <Undo2 size={14} strokeWidth={1.8} aria-hidden />
                )}
                {MOVE_WORDS[move].action}
              </Button>
            )}
          </div>
        </div>
      </SettingsRow>
    </li>
  );
}
