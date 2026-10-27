import { toast } from '@architect/ui';
import { toError } from '../api/query';

/** Runs a user action and reports a failure as a toast, so no error passes silently. */
export async function attempt<T>(title: string, action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (error) {
    toast({ tone: 'danger', title, description: toError(error).message });
    return undefined;
  }
}
