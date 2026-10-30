import { useState, type ReactNode } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from '@architect/ui';
import { CircleAlert, Layers, LockKeyhole, RotateCcw } from 'lucide-react';
import { graduatesApi, refreshAgent } from '../../api/graduates';
import { attempt } from '../../lib/notify';
import { useGraduateSettings } from '../graduateSettings';
import { WRITE_MODE_LABELS, WRITE_SETTING } from '../labels';
import { MOVE_WORDS, promoteCaution, type VersionMove } from './versions';

/** One consequence in a confirmation, after an icon that says what kind it is. */
export function Change({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-fg [&_svg]:mt-[3px] [&_svg]:shrink-0">
      {icon}
      <span className="text-pretty">{children}</span>
    </li>
  );
}

/**
 * Asks before the version chats run on changes, and says what changes: which version answers
 * from the next reply, what moves with it, and that the one it replaces stays.
 */
export function MoveDialog({
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
      promote ? `Couldn't use version ${number}` : `Couldn't go back to version ${number}`,
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
      <DialogContent title={MOVE_WORDS[kind].title(number)}>
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
            {active.version < number ? 'go back to it' : 'use it again'}.
          </Change>
          {backToAsk && (
            <Change icon={<LockKeyhole size={15} strokeWidth={1.8} aria-hidden />}>
              {WRITE_SETTING} goes back to {WRITE_MODE_LABELS.ask}, since version {number} came from
              another computer.
            </Change>
          )}
        </ul>
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant="primary" size="md" loading={moving} onClick={() => void confirm()}>
            {MOVE_WORDS[kind].confirm(number)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
