import type { ClarificationAnswer } from '@architect/shared';
import { must } from './errors';
import { interventionOfRound } from './intervene';
import type { RunState } from './run-state';

/**
 * Ends a clarification round once the person answered. The answer is recorded on the round's
 * intervention before any label is made, and later rounds show it to the mentor as a confirmed
 * interpretation. An answer that changes what counts as success stops the run: its locked test
 * belongs to the job as it was, and a changed job is a new contract version and a new run.
 */
export function clarify(state: RunState, index: number): void {
  const asked = interventionOfRound(state, index);
  const answer: ClarificationAnswer = must(asked.answer, "The person's answer");
  const stored = state.round(index);
  const now = state.now();
  const reason = answer.changesCriteria
    ? 'The answer changes what counts as success, so the run stopped for a new job contract.'
    : `Answered: ${answer.text}`;
  const round = {
    ...stored.round,
    status: 'decided' as const,
    decisionReason: reason,
    endedAt: now,
  };
  const run = state.ctx.store.transaction(() => {
    state.ctx.store.rounds.update({ ...stored, round });
    return answer.changesCriteria
      ? state.writeRun({ status: 'stopped', phase: 'done', stopReason: 'contract', endedAt: now })
      : null;
  });
  state.emit({ type: 'round.updated', round });
  // The answer was recorded when it was given; whoever shows it is told it has been taken up.
  state.announce('intervention', asked.id, index);
  if (run) {
    state.emit({ type: 'run.updated', run });
    state.log('info', reason);
  }
}
