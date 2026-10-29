import { describe, expect, it } from 'vitest';
import { CodedError, ERROR_CODES, ErrorCodeSchema, failureFrom, messageWithCode } from '../src';

describe('a failure with a code', () => {
  it('keeps its message and carries its code', () => {
    const error = new CodedError('run_not_found', 'There is no run "run_1".');
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'CodedError',
      code: 'run_not_found',
      message: 'There is no run "run_1".',
    });
  });

  it('names every code the screens word, and nothing else', () => {
    for (const code of ERROR_CODES) expect(ErrorCodeSchema.safeParse(code).success).toBe(true);
    expect(ErrorCodeSchema.safeParse('engine_exploded').success).toBe(false);
  });
});

describe('a code across the context bridge', () => {
  it('rides on the end of the message, and is read back into the error it was', () => {
    const sent = new Error(messageWithCode('There is no job "job_1".', 'job_not_found'));
    const received = failureFrom(sent);
    expect(received).toBeInstanceOf(CodedError);
    expect(received).toMatchObject({ code: 'job_not_found', message: 'There is no job "job_1".' });
  });

  it('leaves a message without a code exactly as it was', () => {
    expect(messageWithCode('Plain.', undefined)).toBe('Plain.');
    const plain = new Error('Plain.');
    expect(failureFrom(plain)).toBe(plain);
  });

  it('keeps the message and drops a code it does not know, so a newer build never confuses it', () => {
    const received = failureFrom(new Error(messageWithCode('Newer.', 'from_the_future')));
    expect(received).not.toBeInstanceOf(CodedError);
    expect(received.message).toBe('Newer.');
  });

  it('never mistakes a message that merely ends in a separator for a coded one', () => {
    const odd = new Error('Ends oddly.⁣');
    expect(failureFrom(odd).message).toBe('Ends oddly.⁣');
  });
});
