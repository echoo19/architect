import type { PackageProblemCode } from './versions';
import type { ApprovalRequest } from './workspace';

export type AdapterErrorCode =
  | 'auth'
  | 'not_found'
  | 'rate_limit'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'server'
  | 'bad_request'
  | 'bad_response'
  | 'aborted'
  | 'blocked';

const RETRYABLE: ReadonlySet<AdapterErrorCode> = new Set([
  'rate_limit',
  'network',
  'timeout',
  'server',
]);

/** A failure talking to a model. `message` is written for the person using the app. */
export class AdapterError extends Error {
  readonly code: AdapterErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: AdapterErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AdapterError';
    this.code = code;
    this.retryable = RETRYABLE.has(code);
    if (options?.status !== undefined) this.status = options.status;
  }
}

/** A guard stopped an action that would break an invariant (budget cap, split isolation, network). */
export class GuardError extends Error {
  readonly guard: 'budget' | 'split' | 'network' | 'harness_surface' | 'permission';

  constructor(guard: GuardError['guard'], message: string) {
    super(message);
    this.name = 'GuardError';
    this.guard = guard;
  }
}

/**
 * A write needed the user's approval and nobody could give it: a non-interactive run fails here
 * with what it wanted to do, instead of waiting or writing.
 */
export class ApprovalRequiredError extends GuardError {
  readonly approval: ApprovalRequest;

  constructor(approval: ApprovalRequest, message: string) {
    super('permission', message);
    this.approval = approval;
  }
}

/**
 * A graduate package was refused. `problems` holds one sentence per problem; nothing from the
 * package was installed and none of its code was loaded.
 */
export class PackageError extends Error {
  readonly code: PackageProblemCode;
  readonly problems: readonly string[];

  constructor(code: PackageProblemCode, problems: readonly string[]) {
    super(problems.join('\n'));
    this.name = 'PackageError';
    this.code = code;
    this.problems = problems;
  }
}
