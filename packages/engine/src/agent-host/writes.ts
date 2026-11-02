import {
  ApprovalRequiredError,
  GuardError,
  newId,
  type ApprovalRequest,
  type PermissionMode,
} from '@architect/shared';
import type { ApproveWrite, PendingWrite, WriteDecision } from '../tools/builtins';
import type { LiveReply } from './reply';

export type ApprovalDecision = 'approve' | 'deny' | 'always';

/** Writes waiting for the user, by change id. Each resolves once, with the user's decision. */
export class PendingWrites {
  private readonly waiting = new Map<string, (decision: ApprovalDecision) => void>();

  /** Waits for `decide(changeId, …)`. Stopping the reply rejects with the abort reason. */
  wait(changeId: string, signal: AbortSignal | undefined): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const abort = () => {
        this.waiting.delete(changeId);
        reject(signal?.reason);
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.set(changeId, (decision) => {
        signal?.removeEventListener('abort', abort);
        this.waiting.delete(changeId);
        resolve(decision);
      });
    });
  }

  decide(changeId: string, decision: ApprovalDecision): void {
    const resolve = this.waiting.get(changeId);
    if (!resolve) throw new Error('That change is no longer waiting for a decision.');
    resolve(decision);
  }
}

export interface WritePolicy {
  /** The graduate's name, as the agent may repeat it to the user. */
  agentName: string;
  /** The write mode right now: the user can change it while a reply runs. */
  mode(): PermissionMode;
  /** Switches the graduate to allow writes from now on, and saves that. */
  allowFromNowOn(): void;
  reply: LiveReply;
  pending: PendingWrites;
  /** Marks the chat as waiting for the user, or not. */
  setWaiting(waiting: boolean): void;
  /**
   * Whether someone can answer an approval. When no one can (a run from a script), a write that
   * would ask fails at once with the change it wanted, through `approvalRequired`.
   */
  interactive: boolean;
  approvalRequired(approval: ApprovalRequest): void;
}

/**
 * Write tools call this before a change touches the file. `ask` shows the change as an approval
 * block and waits for the user, or, when nobody can answer, fails with an
 * `ApprovalRequiredError` that carries the change; `allow` shows it as approved and goes ahead;
 * `never` fails the call with a reason the agent can pass on. Nothing is written unless approved.
 * A change to a table shows its rows; a change to any other file shows its diff.
 *
 * An approved change that then can't be saved goes back to waiting, with the reason, so the user
 * can try again or give up; given up, or with nobody to ask, it shows as failed. It never shows
 * as approved while nothing was written.
 */
export function approveWrites(policy: WritePolicy): ApproveWrite {
  /** Each change's approval block, by the change the tool asked about. */
  const blocks = new WeakMap<PendingWrite, string>();

  const saveFailed = async (
    change: PendingWrite,
    reason: string,
    signal?: AbortSignal,
  ): Promise<boolean> => {
    const changeId = blocks.get(change);
    if (changeId === undefined) return false;
    if (!policy.interactive) {
      policy.reply.updateApproval(changeId, 'failed', reason);
      return false;
    }
    policy.reply.updateApproval(changeId, 'pending', reason);
    policy.setWaiting(true);
    try {
      const decision = await policy.pending.wait(changeId, signal);
      if (decision === 'deny') {
        policy.reply.updateApproval(changeId, 'failed', reason);
        return false;
      }
      policy.reply.updateApproval(changeId, 'approved');
      return true;
    } finally {
      policy.setWaiting(false);
    }
  };

  const approve = async (change: PendingWrite, signal?: AbortSignal): Promise<WriteDecision> => {
    const mode = policy.mode();
    if (mode === 'never') {
      throw new GuardError(
        'permission',
        `Writing is turned off for ${policy.agentName}, so nothing was written (${change.summary}). The user can turn it on in ${policy.agentName}'s settings.`,
      );
    }
    const changeId = newId('chg');
    blocks.set(change, changeId);
    const block = {
      kind: 'approval' as const,
      changeId,
      op: change.tool,
      file: change.path,
      summary: change.summary,
      ...(change.rows === undefined ? { patch: change.patch } : { diff: change.rows }),
    };
    if (mode === 'allow') {
      policy.reply.addBlock({ ...block, status: 'approved' });
      return 'approve';
    }
    if (!policy.interactive) {
      policy.reply.addBlock({ ...block, status: 'denied' });
      const approval: ApprovalRequest = {
        changeId,
        tool: change.tool,
        file: change.path,
        summary: change.summary,
        ...(change.rows === undefined ? { patch: change.patch } : { diff: change.rows }),
      };
      policy.approvalRequired(approval);
      throw new ApprovalRequiredError(
        approval,
        `${change.summary} needs the user's approval, and no one can give it here, so nothing was written.`,
      );
    }
    policy.reply.addBlock({ ...block, status: 'pending' });
    policy.setWaiting(true);
    try {
      const decision = await policy.pending.wait(changeId, signal);
      if (decision === 'always') policy.allowFromNowOn();
      policy.reply.updateApproval(changeId, decision === 'deny' ? 'denied' : 'approved');
      return decision === 'deny' ? 'deny' : 'approve';
    } finally {
      policy.setWaiting(false);
    }
  };

  return Object.assign(approve, { saveFailed });
}
