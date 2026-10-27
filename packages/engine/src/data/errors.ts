/**
 * A problem with the job's data or with a request for it: a malformed file, an unknown column,
 * a value that can't be stored. Messages are written so the agent can correct its next call.
 */
export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataError';
  }
}
