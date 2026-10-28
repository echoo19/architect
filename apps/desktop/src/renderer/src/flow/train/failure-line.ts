import { clip } from '../format';
import type { RecentAttempt } from './run-state';

/** Ends a sentence once, whether or not the quoted text already ended it. */
function endSentence(text: string): string {
  return /[.!?]["”]?$/.test(text) ? text : `${text}.`;
}

/**
 * What the student got wrong on a task, in the checker's own words. The checker says what was
 * wrong whatever the task asks for, where an expected value can be a whole record to check.
 */
export function failureLine(failure: RecentAttempt): string {
  const request = failure.prompt ? `"${clip(failure.prompt, 90)}"` : `task ${failure.taskId}`;
  return endSentence(`Missed ${request}: ${failure.check.reason}`);
}
