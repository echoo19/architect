import { clip } from '../format';
import type { RecentAttempt } from './run-state';

/** Ends a sentence once, whether or not the quoted text already ended it. */
function endSentence(text: string): string {
  return /[.!?]["”]?$/.test(text) ? text : `${text}.`;
}

/** What the student got wrong on a task, in one or two sentences. */
export function failureLine(failure: RecentAttempt): string {
  const request = failure.prompt ? `"${clip(failure.prompt, 90)}"` : `task ${failure.taskId}`;
  if (failure.answerSummary && failure.expectedSummary) {
    const asked = endSentence(`Answered ${failure.answerSummary} to ${request}`);
    return `${asked} ${endSentence(`Expected ${failure.expectedSummary}`)}`;
  }
  return endSentence(`Missed ${request}: ${failure.check.reason}`);
}
