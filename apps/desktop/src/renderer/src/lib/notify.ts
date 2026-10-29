import { toast } from '@architect/ui';
import { toError } from '../api/query';
import { problemOf } from './problems';

/**
 * Runs a user action and reports a failure as a toast, so no error passes silently. A failure
 * with a code says its plain cause and what helps; any other says its own message.
 */
export async function attempt<T>(title: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    const failure = toError(error);
    const problem = problemOf(failure);
    const description = problem
      ? [problem.cause, problem.next].filter(Boolean).join(' ')
      : failure.message;
    toast({ tone: 'danger', title, description });
    return undefined;
  }
}
