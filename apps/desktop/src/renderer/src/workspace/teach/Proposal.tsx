import { useState, type ReactNode } from 'react';
import type { Correction } from '@architect/shared';
import { Button, Tooltip } from '@architect/ui';
import { ListPlus, PencilLine, Trash2 } from 'lucide-react';
import { refreshTeaching, teachApi } from '../../api/teaching';
import { formatUsd } from '../../lib/format';
import { attempt } from '../../lib/notify';
import { KindLabel } from './kinds';
import { canQueue, lessonChange, TRAINING_NEED } from './lessons';

/** What reading a correction cost, the way the cap beside the consent reads. */
function costLabel(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? 'under $0.01' : formatUsd(Math.round(usd * 100) / 100);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-4 border-t border-line py-3.5">
      <dt className="text-fg">{label}</dt>
      <dd className="m-0 flex flex-col gap-2 text-fg text-pretty">{children}</dd>
    </div>
  );
}

/**
 * A lesson the mentor proposed from a flagged answer: its kind and the lesson, what the person
 * said, the change it would make, whether it needs practice, the mentor's reason, and what
 * reading it cost. With `onEdit`, the person can say more and send it again.
 */
export function ProposalView({
  correction,
  onEdit,
}: {
  correction: Correction;
  /** Goes back to the form, with what was written kept, to say more and send it again. */
  onEdit?: () => void;
}) {
  const { proposal } = correction;
  const change = lessonChange(proposal);
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <KindLabel kind={proposal.kind} />
        <p className="m-0 text-h2 text-fg text-pretty">{proposal.lesson}</p>
      </div>
      <dl aria-label="Proposed lesson" className="m-0 flex flex-col">
        <Fact label="You said">{correction.wrong}</Fact>
        <Fact label="Change">
          <span className="text-fg">{change.title}</span>
          {change.detail && (
            <span className="border-l-2 border-line-strong pl-3 text-fg">{change.detail}</span>
          )}
        </Fact>
        <Fact label="Practice needed">{TRAINING_NEED[proposal.kind]}</Fact>
        {correction.note !== undefined && <Fact label="Last try">{correction.note}</Fact>}
        <Fact label="Why">{proposal.reason}</Fact>
        <Fact label="Cost">
          <span className="font-mono tabular-nums">{costLabel(correction.costUsd)}</span>
        </Fact>
      </dl>
      {onEdit && (
        <Button size="sm" variant="ghost" className="-ml-3 self-start" onClick={onEdit}>
          <PencilLine size={14} strokeWidth={1.7} aria-hidden />
          Say more and send again
        </Button>
      )}
    </div>
  );
}

type Action = 'queue' | 'discard';

const FAILED: Record<Action, string> = {
  queue: "Couldn't save it for Improve",
  discard: "Couldn't discard it",
};

/**
 * The choices for a lesson that waits for the person: discard it, or save it for Improve, which
 * makes a new version only once the agent shows it learned it (decision 066). The version chats
 * run on never changes here: only using a version does that.
 */
export function ProposalActions({
  graduateId,
  correction,
  onSettled,
  onEdit,
}: {
  graduateId: string;
  correction: Correction;
  /** The lesson after the choice: queued or discarded. */
  onSettled: (correction: Correction) => void;
  /** Goes back to the form to say more and send it again, for a lesson that can't be taught. */
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const { kind } = correction.proposal;
  const queueable = correction.status === 'proposed' && canQueue(kind);

  const act = async (action: Action) => {
    setBusy(action);
    const settled = await attempt(FAILED[action], async () => {
      const next =
        action === 'queue'
          ? await teachApi.queue(correction.id)
          : await teachApi.discard(correction.id);
      await refreshTeaching(graduateId);
      return next;
    });
    setBusy(null);
    if (settled) onSettled(settled);
  };

  // A lesson that can't be taught is said again, or discarded.
  const sayMore = onEdit !== undefined && !queueable && correction.status === 'proposed';
  return (
    <>
      <Button
        size="md"
        variant={queueable || sayMore ? 'ghost' : 'primary'}
        loading={busy === 'discard'}
        disabled={busy !== null}
        onClick={() => void act('discard')}
      >
        {busy !== 'discard' && <Trash2 size={14} strokeWidth={1.7} aria-hidden />}
        Discard
      </Button>
      {sayMore && (
        <Button size="md" variant="primary" disabled={busy !== null} onClick={onEdit}>
          <PencilLine size={14} strokeWidth={1.7} aria-hidden />
          Say more and send again
        </Button>
      )}
      {queueable && (
        <Tooltip
          content="Keeps it with your other flagged answers. Improve teaches them together, and makes a new version only if the agent learns it and keeps getting its other tasks right."
          side="top"
        >
          <Button
            size="md"
            variant="primary"
            loading={busy === 'queue'}
            disabled={busy !== null}
            onClick={() => void act('queue')}
          >
            {busy !== 'queue' && <ListPlus size={15} strokeWidth={1.7} aria-hidden />}
            Save for Improve
          </Button>
        </Tooltip>
      )}
    </>
  );
}
