import { toast } from '@architect/ui';
import { architect } from '../api/client';
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

/** Says a file was written, by its name, with a way to show it in its folder. */
export function toastWritten(title: string, path: string): void {
  toast({
    title,
    description: path.split(/[\\/]/).filter(Boolean).at(-1) ?? path,
    action: {
      label: 'Show in folder',
      onClick: () => void attempt("Couldn't show it", () => architect().files.show(path)),
    },
  });
}
