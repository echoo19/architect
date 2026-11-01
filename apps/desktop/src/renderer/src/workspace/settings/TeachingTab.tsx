import { useState } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import {
  Button,
  SettingsRow,
  SettingsSection,
  SettingsValue,
  Skeleton,
  Tooltip,
} from '@architect/ui';
import { ArrowUpRight, Undo2 } from 'lucide-react';
import { useVersions } from '../../api/graduates';
import { ProblemState } from '../../components/ProblemState';
import { shortDate } from '../../flow/format';
import { formatPercent } from '../../lib/format';
import { navigate, paths } from '../../lib/router';
import { LessonsSection } from '../teach/LessonsSection';
import { useAgentSettingsUi } from './agentSettingsUi';
import { MoveDialog } from './MoveDialog';
import {
  evaluationNote,
  MOVE_WORDS,
  moveFor,
  standing,
  versionOrigin,
  versionScore,
  type VersionMove,
} from './versions';

/**
 * Teaching: what the agent is being taught (flagged answers, teaching it something new, and
 * Improve), then its versions, newest first. Each version says how its own final test came out,
 * what it was made from and when, and either that it is the one in use or set aside, or a button
 * to use it, or go back to it, after a confirmation that says what changes.
 */
export function TeachingTab({ agent }: { agent: GraduateSummary }) {
  const versions = useVersions(agent.id);
  const [move, setMove] = useState<{ version: GraduateVersion; kind: VersionMove } | null>(null);
  const list = versions.data;
  const active = list?.find((version) => version.active) ?? null;

  return (
    <>
      <LessonsSection agent={agent} />
      <SettingsSection
        title="Versions"
        actions={
          // Names the score column: it ends where the scores do, left of the buttons' slot.
          list &&
          list.length > 0 && <span className="mr-[216px] text-small text-fg">Final test</span>
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
          <Skeleton className="h-7 w-9 rounded-control" />
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
  move,
  onMove,
}: {
  version: GraduateVersion;
  move: VersionMove | null;
  onMove: (kind: VersionMove) => void;
}) {
  const score = versionScore(version);
  const { runId } = version;
  // Two facts under the title, so the line fits: why its final test fell short, or else what it
  // was made from; then when.
  const meta = capitalized(
    [
      version.evaluation === 'experimental' ? evaluationNote(version) : versionOrigin(version),
      shortDate(version.createdAt),
    ]
      .filter(Boolean)
      .join(', '),
  );
  const word = standing(version);

  return (
    <li aria-label={`Version ${version.version}`}>
      <SettingsRow label={`Version ${version.version}`} meta={meta}>
        <div className="flex items-center gap-4">
          {score && runId !== undefined ? (
            // Made by a run on this computer: its score opens that run's whole report.
            <Tooltip content="Open its report">
              <Button
                size="xs"
                variant="ghost"
                aria-label={`Report of version ${version.version}`}
                onClick={() => openReport(runId)}
                className="-mr-3 text-ui tabular-nums"
              >
                <Score score={score} />
              </Button>
            </Tooltip>
          ) : (
            <span className="whitespace-nowrap tabular-nums">
              {score ? <Score score={score} /> : 'No test'}
            </span>
          )}
          {/* The same width on every row, so the scores line up whether or not a row has one. */}
          <div className="flex w-[200px] shrink-0 justify-end">
            {move !== null ? (
              <Button size="xs" onClick={() => onMove(move)}>
                {move === 'promote' ? (
                  <ArrowUpRight size={14} strokeWidth={1.8} aria-hidden />
                ) : (
                  <Undo2 size={14} strokeWidth={1.8} aria-hidden />
                )}
                {MOVE_WORDS[move].action}
              </Button>
            ) : (
              word !== null && <SettingsValue>{word}</SettingsValue>
            )}
          </div>
        </div>
      </SettingsRow>
    </li>
  );
}

function Score({ score }: { score: { pass: number; total: number } }) {
  return (
    <>
      <span className="font-mono">{formatPercent(score)}</span>
      <span className="text-small">
        {' '}
        ({score.pass} of {score.total})
      </span>
    </>
  );
}

/** Closes the settings on the report of the run that made a version. */
function openReport(runId: string): void {
  useAgentSettingsUi.getState().close();
  navigate(paths.report(runId));
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
