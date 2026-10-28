import { HubError } from '@architect/engine/hub';
import {
  AdapterError,
  ApprovalRequiredError,
  CLI_EXIT_CODES,
  GuardError,
  PackageError,
  type CliOutcome,
} from '@architect/shared';
import { z } from 'zod';

/** A failure the command describes itself, with the outcome its exit code reports. */
export class CliError extends Error {
  constructor(
    readonly outcome: Exclude<CliOutcome, 'succeeded'>,
    readonly code: string,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/**
 * What the engine refuses about a request itself (a version or an item that isn't there, a
 * repository name it can't use) comes as a plain Error with no system code: that is invalid
 * input. Anything else stays as it is.
 */
export function asRefusal(error: unknown, code: string): unknown {
  const plain = error instanceof Error && error.constructor === Error && !('code' in error);
  return plain ? new CliError('invalid_input', code, error.message) : error;
}

export interface Failure {
  outcome: Exclude<CliOutcome, 'succeeded'>;
  /** A short, stable word for scripts: `approval_required`, `hub_auth`, `model_network`. */
  code: string;
  message: string;
  hint?: string;
}

export function exitCodeOf(outcome: CliOutcome): number {
  return CLI_EXIT_CODES[outcome];
}

/** How the command names the token's sources in its hints; the value never appears. */
export const TOKEN_HINT =
  'Set HF_TOKEN, or sign in with `hf auth login`, which saves the token file Architect reads.';

function hubFailure(error: HubError): Failure {
  const base = { code: `hub_${error.code}`, message: error.message };
  switch (error.code) {
    case 'auth':
      return { ...base, outcome: 'not_permitted', hint: TOKEN_HINT };
    case 'forbidden':
    case 'billing':
      return { ...base, outcome: 'not_permitted', hint: error.hint };
    case 'not_found':
      return {
        ...base,
        outcome: 'invalid_input',
        hint: 'Check the repository and revision, and that the token can see them.',
      };
    case 'too_large':
    case 'mismatch':
      return { ...base, outcome: 'invalid_input', hint: error.hint };
    default:
      return { ...base, outcome: 'runtime_error', hint: error.hint };
  }
}

/** What went wrong, sorted into the outcome its exit code reports. */
export function failureOf(error: unknown): Failure {
  if (error instanceof CliError) {
    return {
      outcome: error.outcome,
      code: error.code,
      message: error.message,
      ...(error.hint === undefined ? {} : { hint: error.hint }),
    };
  }
  if (error instanceof z.ZodError) {
    return { outcome: 'invalid_input', code: 'invalid_request', message: z.prettifyError(error) };
  }
  if (error instanceof PackageError) {
    return {
      outcome: error.code === 'incompatible' ? 'not_permitted' : 'invalid_input',
      code: `package_${error.code}`,
      message: error.problems.join(' '),
    };
  }
  if (error instanceof ApprovalRequiredError) {
    return { outcome: 'not_permitted', code: 'approval_required', message: error.message };
  }
  if (error instanceof GuardError) {
    return { outcome: 'not_permitted', code: `guard_${error.guard}`, message: error.message };
  }
  if (error instanceof HubError) return hubFailure(error);
  if (error instanceof AdapterError) {
    return { outcome: 'runtime_error', code: `model_${error.code}`, message: error.message };
  }
  return {
    outcome: 'runtime_error',
    code: 'internal',
    message: error instanceof Error ? error.message : String(error),
  };
}
