/**
 * A harness, graduate or lineage file failed a check. `errors` holds one sentence per problem,
 * each starting with the file it is about, so they can be shown to a person as they are.
 */
export class HarnessValidationError extends Error {
  readonly errors: readonly string[];

  constructor(errors: readonly string[]) {
    super(errors.join('\n'));
    this.name = 'HarnessValidationError';
    this.errors = errors;
  }
}
