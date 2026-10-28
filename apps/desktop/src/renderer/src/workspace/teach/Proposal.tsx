import { useState, type ReactNode } from 'react';
import type { Correction } from '@architect/shared';
import { Button, cn } from '@architect/ui';
import { ArrowUpRight, ListPlus, PencilLine, Trash2 } from 'lucide-react';
import { refreshAgent } from '../../api/graduates';
import { refreshTeaching, teachApi } from '../../api/teaching';
import { formatUsd } from '../../lib/format';
import { attempt } from '../../lib/notify';
import { KindLabel } from './kinds';
import { canApply, canQueue, lessonChange, TRAINING_NEED } from './lessons';

/** What reading a correction cost, the way the cap beside the consent reads. */
function costLabel(usd: number): string {
  if (usd === 0) return '$0';
  return usd < 0.01 ? 'under $0.01' : formatUsd(Math.round(usd * 100) / 100);
}

function Fact({
  label,
  tone = 'default',
  children,
}: {
  label: string;
  tone?: 'default' | 'mentor';
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 border-t border-line py-3.5">
      <dt className={cn('text-fg-muted', tone === 'mentor' && 'text-mentor')}>{label}</dt>
      <dd className="m-0 flex flex-col gap-2 text-fg-soft text-pretty">{children}</dd>
    </div>
  );
}

/**
 * A lesson the mentor proposed from a flagged answer: its kind, the lesson, the change it would
 * make, whether it needs training, the mentor's reason, and what reading it cost.
 */
export function ProposalView({
  correction,
  mentor,
  capUsd,
}: {
  correction: Correction;
  /** The mentor's short name, as the rest of the app calls it. */
  mentor: string;
  capUsd: number;
}) {
  const { proposal } = correction;
  const change = lessonChange(proposal);
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-3">
        <KindLabel kind={proposal.kind} />
        <p className="m-0 text-2xl text-fg text-pretty">{proposal.lesson}</p>
      </div>
      <dl aria-label="Proposed lesson" className="m-0 flex flex-col">
        <Fact label="Change">
          <span className="text-fg">{change.title}</span>
          {change.detail && (
            <span className="border-l-2 border-line-control pl-3 text-fg-secondary">
              {change.detail}
            </span>
          )}
        </Fact>
        <Fact label="Training">{TRAINING_NEED[proposal.kind]}</Fact>
        <Fact label={mentor} tone="mentor">
          {proposal.reason}
        </Fact>
        <Fact label="Cost">
          <span className="font-mono tabular-nums">
            {costLabel(correction.costUsd)}
            <span className="text-fg-muted"> / {formatUsd(capUsd)}</span>
          </span>
        </Fact>
      </dl>
    </div>
  );
}

type Action = 'queue' | 'apply' | 'discard';

const FAILED: Record<Action, string> = {
  queue: "Couldn't add it to the queue",
  apply: "Couldn't make the new version",
  discard: "Couldn't discard it",
};

/**
 * The choices for a lesson that waits for the person: discard it, add it to the teaching queue,
 * or, for an instruction, apply it at once as a new version that isn't evaluated yet. The
 * version chats run on never changes here.
 */
export function ProposalActions({
  graduateId,
  correction,
  nextVersion,
  onSettled,
  onEdit,
}: {
  graduateId: string;
  correction: Correction;
  /** The number a version applied now would get, once the versions are known. */
  nextVersion: number | null;
  /** The lesson after the choice: queued, applied or discarded. */
  onSettled: (correction: Correction) => void;
  /** Goes back to the form to say more and send it again. */
  onEdit?: () => void;
}) {
  const [busy, setBusy] = useState<Action | null>(null);
  const { kind } = correction.proposal;
  const queueable = correction.status === 'proposed' && canQueue(kind);
  const applicable = canApply(correction.proposal);

  const act = async (action: Action) => {
    setBusy(action);
    const settled = await attempt(FAILED[action], async () => {
      const next =
        action === 'queue'
          ? await teachApi.queue(correction.id)
          : action === 'apply'
            ? await teachApi.apply(correction.id)
            : await teachApi.discard(correction.id);
      await Promise.all([
        refreshTeaching(graduateId),
        action === 'apply' ? refreshAgent(graduateId) : undefined,
      ]);
      return next;
    });
    setBusy(null);
    if (settled) onSettled(settled);
  };

  const primary = applicable ? 'apply' : queueable ? 'queue' : null;
  // A lesson that can't be taught is only discarded, unless the person can say more.
  const discardFirst = correction.status === 'proposed' && primary === null && !onEdit;
  return (
    <>
      <Button
        size="md"
        variant={discardFirst ? 'primary' : 'ghost'}
        loading={busy === 'discard'}
        disabled={busy !== null}
        onClick={() => void act('discard')}
      >
        {busy !== 'discard' && <Trash2 size={14} strokeWidth={1.7} aria-hidden />}
        Discard
      </Button>
      {onEdit && !queueable && (
        <Button size="md" variant="primary" disabled={busy !== null} onClick={onEdit}>
          <PencilLine size={14} strokeWidth={1.7} aria-hidden />
          Say more and send again
        </Button>
      )}
      {queueable && (
        <Button
          size="md"
          variant={primary === 'queue' ? 'primary' : 'secondary'}
          loading={busy === 'queue'}
          disabled={busy !== null}
          onClick={() => void act('queue')}
        >
          {busy !== 'queue' && <ListPlus size={15} strokeWidth={1.7} aria-hidden />}
          Add to the queue
        </Button>
      )}
      {applicable && (
        <Button
          size="md"
          variant="primary"
          loading={busy === 'apply'}
          disabled={busy !== null}
          onClick={() => void act('apply')}
        >
          {busy !== 'apply' && <ArrowUpRight size={15} strokeWidth={1.8} aria-hidden />}
          {nextVersion === null ? 'Apply as a new version' : `Apply as version ${nextVersion}`}
        </Button>
      )}
    </>
  );
}
