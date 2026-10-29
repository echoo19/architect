import type { Intervention, Round } from '@architect/shared';
import type { QueryState } from '../../api/query';
import type { MentoringRecords } from '../../api/mentoring';
import type { ModelNames } from './phase';

/**
 * A question the mentor put to the person in a round, as the screen needs it: the question the
 * round's intervention recorded, or what is known of it while the records are read.
 */
export type QuestionView =
  | { state: 'loading' }
  | { state: 'error'; error: Error; reload: () => void }
  | { state: 'ready'; intervention: Intervention };

/** The round's question, from its intervention, when the intervention is one the runner took. */
export function questionOfRound(
  round: Round,
  interventions: readonly Intervention[],
): Intervention | undefined {
  return interventions.find(
    (item) =>
      item.round === round.index && item.type === 'clarification' && item.status === 'accepted',
  );
}

/**
 * The question of the round on screen, or null for a round that asked none. A round waiting for
 * its answer is a question before its records are read, so the screen can say so at once.
 */
export function questionView(
  round: Round | null,
  records: QueryState<MentoringRecords>,
): QuestionView | null {
  if (round === null) return null;
  const waiting = round.status === 'clarifying';
  const found =
    records.data === undefined ? undefined : questionOfRound(round, records.data.interventions);
  if (found !== undefined) return { state: 'ready', intervention: found };
  if (!waiting) return null;
  return records.status === 'error'
    ? { state: 'error', error: records.error, reload: records.reload }
    : { state: 'loading' };
}

/** Whether a question still waits for its answer. */
export function isOpen(round: Round, intervention: Intervention): boolean {
  return round.status === 'clarifying' && intervention.answer === undefined;
}

/**
 * What the mentor did with the answer, in a sentence: an answer that changes what counts as
 * success ends the run, since its final test belongs to the job as it was; any other is kept as
 * what the person meant, and the mentor is shown it with every round that follows.
 */
export function answerEffect(intervention: Intervention, names: ModelNames): string | null {
  const { answer } = intervention;
  if (answer === undefined) return null;
  return answer.changesCriteria
    ? 'It changes what counts as success, so this run stopped. Its final test belongs to the job as it was. Train again on the changed job.'
    : `${names.mentor} kept it as what you meant, and sees it with every round from here on.`;
}
