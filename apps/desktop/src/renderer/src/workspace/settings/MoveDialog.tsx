import { useState, type ReactNode } from 'react';
import type { GraduateSummary, GraduateVersion } from '@architect/shared';
import { Button, cn, Dialog, DialogClose, DialogContent, DialogFooter, toast } from '@architect/ui';
import { ArrowRightLeft, CircleAlert, Layers, LockKeyhole, RotateCcw } from 'lucide-react';
import { graduatesApi, refreshAgent } from '../../api/graduates';
import { useQuery } from '../../api/query';
import { attempt } from '../../lib/notify';
import { GROUP_LABELS } from '../../models/registry';
import {
  changeFigures,
  changesModel,
  changeWords,
  orgChanges,
  versionModel,
} from '../../models/model-change';
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
 * What a version on another model gains and loses against the one in use, at each organization
 * both took the same final test at (decision 095). Nothing while the cards load, and a plain
 * line when no organization compares.
 */
function Gains({
  agentId,
  version,
  active,
}: {
  agentId: string;
  version: GraduateVersion;
  active: GraduateVersion;
}) {
  const cards = useQuery(`model-change:${agentId}:${active.version}:${version.version}`, () =>
    Promise.all([
      graduatesApi.report(agentId, active.version),
      graduatesApi.report(agentId, version.version),
    ]),
  );
  if (cards.status !== 'success') return null;
  const [before, after] = cards.data;
  const changes = orgChanges(before, after);
  if (changes.length === 0) {
    return (
      <p className="m-0 px-7 pt-4 text-ui text-pretty">
        Their final tests don&rsquo;t compare, so nothing shows what it gains or loses.
      </p>
    );
  }
  return (
    <table
      aria-label="What it gains and loses"
      className="mx-7 mt-5 w-[calc(100%-3.5rem)] border-collapse text-ui"
    >
      <tbody>
        {changes.map((change) => {
          const figures = changeFigures(change);
          return (
            <tr key={change.org} className="border-t border-line first:border-t-0">
              <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                <span className="block truncate">{change.name}</span>
                <span className="block text-small">{GROUP_LABELS[change.group]}</span>
              </th>
              <td className="py-2.5 pr-3 text-right tabular-nums">{figures.scores}</td>
              <td
                className={cn(
                  'w-28 py-2.5 text-right tabular-nums',
                  change.points > 0 && 'text-student',
                )}
              >
                <span aria-hidden>{figures.points}</span>
                <span className="sr-only">{changeWords(change.points)}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/**
 * Asks before the version chats run on changes, and says what changes: which version answers
 * from the next reply, what moves with it, and that the one it replaces stays. A version on
 * another model is a switch of models (decision 095): the dialog names both and shows what the
 * new one gains and loses at each organization, and the switch can be undone from its toast.
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
  const switching = changesModel(version, active);
  const [to, from] = [versionModel(version), versionModel(active)];
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
    if (!done) return;
    onClose();
    if (switching) {
      toast({
        key: 'model-switch',
        title: `${agent.name} answers on ${to}`,
        action: {
          label: 'Undo',
          onClick: () =>
            void attempt(`Couldn't go back to ${from}`, async () => {
              await (promote
                ? graduatesApi.rollback(agent.id, active.version)
                : graduatesApi.promote(agent.id, active.version));
              await refreshAgent(agent.id);
            }),
        },
      });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={switching ? `Switch to ${to}?` : MOVE_WORDS[kind].title(number)}>
        <ul className="m-0 flex list-none flex-col gap-3 px-7 pt-4">
          {switching && (
            <Change icon={<ArrowRightLeft size={15} strokeWidth={1.8} aria-hidden />}>
              {agent.name} answers on {to} instead of {from}.
            </Change>
          )}
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
        {switching && <Gains agentId={agent.id} version={version} active={active} />}
        <DialogFooter>
          <DialogClose asChild>
            <Button size="md">Cancel</Button>
          </DialogClose>
          <Button variant="primary" size="md" loading={moving} onClick={() => void confirm()}>
            {switching ? `Switch to ${to}` : MOVE_WORDS[kind].confirm(number)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
