import { useEffect, useState } from 'react';
import type { Round } from '@architect/shared';
import type { MentoringRecords } from '../../api/mentoring';
import type { QueryState } from '../../api/query';
import { questionMissing, questionView, type QuestionView } from './questions';

/**
 * The question of the round on screen. A round that waits for its answer whose question isn't in
 * the records is not loading: the records were read before it was asked. They are read again, once
 * for each round, and the screen waits for that read; if the question is still not there it says
 * so and offers to try again.
 */
export function useQuestion(
  runId: string,
  round: Round | null,
  records: QueryState<MentoringRecords>,
): QuestionView | null {
  const [readFor, setReadFor] = useState<string | null>(null);
  const asked = round === null ? null : `${runId}:${round.index}`;
  const missing = questionMissing(round, records);
  const { reload } = records;

  useEffect(() => {
    if (!missing || asked === null || readFor === asked) return;
    // The records go back to loading before this is remembered, so no render sees them as read.
    reload();
    setReadFor(asked);
  }, [missing, asked, readFor, reload]);

  return questionView(round, records, asked !== null && readFor === asked);
}
