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

/**
 * A change that was allowed but couldn't be written to its file, such as one another program
 * holds open. Nothing changed, so the same change can be tried again.
 */
export class SaveError extends DataError {
  constructor(message: string) {
    super(message);
    this.name = 'SaveError';
  }
}
