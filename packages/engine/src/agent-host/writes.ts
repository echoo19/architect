import { GuardError, newId, type PermissionMode } from '@architect/shared';
import type { ApproveWrite } from '../tools/builtins';
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
}

/**
 * Write tools call this before a change touches the file. `ask` shows the change as an approval
 * block and waits for the user; `allow` shows it as approved and goes ahead; `never` fails the
 * call with a reason the agent can pass on, so nothing is written. A change to a table shows
 * its rows; a change to any other file shows its diff.
 */
export function approveWrites(policy: WritePolicy): ApproveWrite {
  return async (change, signal) => {
    const mode = policy.mode();
    if (mode === 'never') {
      throw new GuardError(
        'permission',
        `Writing is turned off for ${policy.agentName}, so nothing was written (${change.summary}). The user can turn it on in ${policy.agentName}'s settings.`,
      );
    }
    const changeId = newId('chg');
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
    policy.reply.addBlock({ ...block, status: 'pending' });
    policy.setWaiting(true);
    try {
      const decision = await policy.pending.wait(changeId, signal);
      if (decision === 'always') policy.allowFromNowOn();
      policy.reply.decideApproval(changeId, decision === 'deny' ? 'denied' : 'approved');
      return decision === 'deny' ? 'deny' : 'approve';
    } finally {
      policy.setWaiting(false);
    }
  };
}
