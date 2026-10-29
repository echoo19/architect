import { z } from 'zod';
import type { PackageProblemCode } from './versions';
import type { ApprovalRequest } from './workspace';

/**
 * Failures a screen can answer in a plain sentence with the next step that helps, which the
 * message alone can't say: the thing asked for is gone, a version's files changed after it was
 * made, a package isn't one or was edited after it was made, a file chosen as a job isn't one,
 * the disk is full, or a part of Architect isn't answering. Every other failure reaches a screen as its message. A guard that
 * refused a request is one of them, since what it refused says what to do: a text that matches
 * the final test, or a request that would cost more than its cap.
 */
export const ERROR_CODES = [
  'run_not_found',
  'job_not_found',
  'agent_not_found',
  'chat_not_found',
  'draft_not_found',
  'record_not_found',
  'version_modified',
  'not_a_package',
  'not_a_job',
  'package_changed',
  'disk_full',
  'guard_split',
  'guard_budget',
  'process_starting',
  'process_restarting',
  'process_failed',
  'process_closing',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** A failure with a code, whose `message` is still the precise sentence for whoever asks. */
export class CodedError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CodedError';
    this.code = code;
  }
}

/**
 * Electron copies an error across the context bridge with its message alone, so a code travels
 * as a mark on the end of the message: the code between two invisible separators. `failureFrom`
 * reads it back into a `CodedError` on the other side.
 */
const CODE_MARK = '⁣';

export function messageWithCode(message: string, code: string | undefined): string {
  return code === undefined ? message : `${message}${CODE_MARK}${code}${CODE_MARK}`;
}

/** The error behind a message that crossed the bridge: coded when it carries a known code. */
export function failureFrom(error: Error): Error {
  const { message } = error;
  if (!message.endsWith(CODE_MARK)) return error;
  const start = message.lastIndexOf(CODE_MARK, message.length - 2);
  if (start < 0) return error;
  const plain = message.slice(0, start);
  const code = ErrorCodeSchema.safeParse(message.slice(start + 1, -1));
  if (!code.success) return new Error(plain, { cause: error });
  return new CodedError(code.data, plain, { cause: error });
}

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
