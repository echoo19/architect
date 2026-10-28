import { CodedError, ERROR_CODES } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { isFinal, problemOf } from '../../../src/renderer/src/lib/problems';

/** The words that lead a screen must never carry what only the precise message may. */
const INTERNAL = /\b(engine|utility|process|sha256|ipc)\b|["'][a-z]+_[a-z0-9_]+["']|\\|\/data\//i;

describe('a failure in plain words', () => {
  it('has a plain cause for every code, with no inner part of Architect named', () => {
    for (const code of ERROR_CODES) {
      const problem = problemOf(new CodedError(code, 'The precise message.'));
      expect(problem, code).not.toBeNull();
      expect(problem?.cause, code).toMatch(/^[A-Z].*[.]$/);
      expect(problem?.cause, code).not.toMatch(INTERNAL);
      expect(problem?.next ?? '', code).not.toMatch(INTERNAL);
    }
  });

  it('says what is gone and offers no second try, since asking again cannot bring it back', () => {
    for (const code of [
      'run_not_found',
      'job_not_found',
      'agent_not_found',
      'chat_not_found',
      'record_not_found',
      'version_modified',
      'process_closing',
    ] as const) {
      const problem = problemOf(new CodedError(code, 'The precise message.'));
      expect(problem && isFinal(problem), code).toBe(true);
    }
    expect(problemOf(new CodedError('run_not_found', 'x'))?.cause).toBe('This run is gone.');
    expect(problemOf(new CodedError('job_not_found', 'x'))?.cause).toBe('This job is gone.');
  });

  it('offers another try only for what may pass', () => {
    for (const code of ['process_starting', 'process_restarting', 'process_failed'] as const) {
      const problem = problemOf(new CodedError(code, 'The precise message.'));
      expect(problem && isFinal(problem), code).toBe(false);
      expect(problem?.next, code).toMatch(/Try again|restart Architect/);
    }
  });

  it('leaves every failure without a code to say its own message', () => {
    expect(problemOf(new Error('Spark refused the key.'))).toBeNull();
  });
});
