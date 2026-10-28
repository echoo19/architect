import { useState, type ReactNode } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  ErrorState,
  SettingsRow,
  SettingsSection,
  Skeleton,
  VersionTag,
} from '@architect/ui';
import { ArrowUpRight, CircleAlert, Layers, LockKeyhole, RotateCcw, Undo2 } from 'lucide-react';
import { graduatesApi, refreshAgent, useVersions } from '../../api/graduates';
import { formatPercent } from '../../lib/format';
import { attempt } from '../../lib/notify';
import { useGraduateSettings } from '../graduateSettings';
import { WRITE_MODE_LABELS } from '../labels';
import {
  EVALUATION_LABELS,
  moveFor,
  promoteCaution,
  versionDate,
  versionOrigin,
  versionScore,
  type VersionMove,
} from './versions';

/**
 * Teaching: the agent's versions, newest first. Each says whether it is the one chats run on,
 * how its own locked test came out, what it was made from and when, and can be promoted or
 * rolled back to after a confirmation that says what changes.
 */
export function TeachingTab({ agent }: { agent: GraduateSummary }) {
  const versions = useVersions(agent.id);
  const [move, setMove] = useState<{ version: GraduateVersion; kind: VersionMove } | null>(null);
  const list = versions.data;
  const active = list?.find((version) => version.active) ?? null;

  return (
    <SettingsSection title="Versions">
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
  // the label already is that result.
  const evaluation = EVALUATION_LABELS[version.evaluation];
  const meta = [
    status === evaluation ? null : evaluation,
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

function Change({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-fg-secondary [&_svg]:mt-[3px] [&_svg]:shrink-0">
      {icon}
      <span className="text-pretty">{children}</span>
    </li>
  );
}

/**
 * Asks before the version chats run on changes, and says what changes: which version answers
 * from the next reply, what moves with it, and that the one it replaces stays.
 */
function MoveDialog({
  agent,
  version,
  kind,
  active,
  onClose,
}: {
  agent: GraduateSummary;
  version: GraduateVersion;
  kind: VersionMove;
  active: GraduateVersion;
  onClose: () => void;
}) {
  const settings = useGraduateSettings(agent.id);
  const [moving, setMoving] = useState(false);
  const promote = kind === 'promote';
  const number = version.version;
  const carries =
    version.manifest.model.adapter === undefined ? 'setup' : 'setup and trained weights';
  const caution = promote ? promoteCaution(version) : null;
  // Promotion never lets a version from another computer write without asking (decision 039).
  const backToAsk = promote && version.origin !== undefined && settings.data?.writeMode === 'allow';

  const confirm = async () => {
    setMoving(true);
    const done = await attempt(
      promote ? `Couldn't promote version ${number}` : `Couldn't roll back to version ${number}`,
      async () => {
        if (promote) {
          if (version.state === 'candidate') await graduatesApi.acceptVersion(agent.id, number);
          await graduatesApi.promote(agent.id, number);
        } else {
          await graduatesApi.rollback(agent.id, number);
        }
        await refreshAgent(agent.id);
        return true;
      },
    );
    setMoving(false);
    if (done) onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        title={promote ? `Promote version ${number}?` : `Roll back to version ${number}?`}
      >
        <ul className="m-0 flex list-none flex-col gap-3 px-7 pt-4">
          {caution && (
            <Change icon={<CircleAlert size={15} strokeWidth={1.8} aria-hidden />}>
              {caution}
            </Change>
          )}
          <Change icon={<Layers size={15} strokeWidth={1.8} aria-hidden />}>
            New replies use version {number}&apos;s {carries}
            {promote ? '.' : ' again.'}
          </Change>
          <Change icon={<RotateCcw size={15} strokeWidth={1.8} aria-hidden />}>
            {/* Going back to an earlier version is a rollback; to a later one, a promotion. */}
            Version {active.version} stays, so you can{' '}
            {active.version < number ? 'roll back to it' : 'promote it again'}.
          </Change>
          {backToAsk && (
            <Change icon={<LockKeyhole size={15} strokeWidth={1.8} aria-hidden />}>
              Saving changes goes back to {WRITE_MODE_LABELS.ask}, since version {number} came from
              another computer.
            </Change>
          )}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant="primary" size="md" loading={moving} onClick={() => void confirm()}>
            {promote ? 'Promote' : 'Roll back'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
