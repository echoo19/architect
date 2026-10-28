import { GuardError } from '@architect/shared';
import { DataError } from '../data/errors';

/** A tool call the model got wrong, or a tool that failed: reported back for the model to read. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

/** Errors the model caused or can work around. Anything else is a bug and propagates. */
export function isToolFailure(error: unknown): error is Error {
  return (
    error instanceof ToolError ||
    error instanceof DataError ||
    (error instanceof GuardError && error.guard === 'permission')
  );
}
