import { CodedError } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { asDiskFull } from '../src/graduates/disk';

describe('a full disk during an import', () => {
  it('becomes a coded failure a screen can word, with the system error as its cause', () => {
    const system = Object.assign(new Error('ENOSPC: no space left on device, write'), {
      code: 'ENOSPC',
    });
    const failure = asDiskFull(system);
    expect(failure).toBeInstanceOf(CodedError);
    expect((failure as CodedError).code).toBe('disk_full');
    expect((failure as CodedError).message).toBe(
      'There is not enough free disk space to install it.',
    );
    expect((failure as CodedError).cause).toBe(system);
  });

  it('leaves every other failure as it came', () => {
    const other = Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
    expect(asDiskFull(other)).toBe(other);
    expect(asDiskFull('text')).toBe('text');
  });
});
