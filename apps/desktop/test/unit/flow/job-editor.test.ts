import { describe, expect, it } from 'vitest';
import { sameChecker } from '../../../src/renderer/src/flow/define/use-job-editor';

describe('whether a saved job grades the way the edited one did', () => {
  it('is the same for the same built-in checker, and the same file', () => {
    expect(sameChecker({ kind: 'builtin' }, { kind: 'builtin' })).toBe(true);
    expect(
      sameChecker({ kind: 'module', path: 'checker.js' }, { kind: 'module', path: 'checker.js' }),
    ).toBe(true);
  });

  it('differs when one is a file and the other is not, or the files differ', () => {
    expect(sameChecker({ kind: 'builtin' }, { kind: 'module', path: 'checker.js' })).toBe(false);
    expect(sameChecker({ kind: 'module', path: 'checker.js' }, { kind: 'builtin' })).toBe(false);
    expect(sameChecker({ kind: 'module', path: 'a.js' }, { kind: 'module', path: 'b.js' })).toBe(
      false,
    );
  });

  it('differs for a file chosen by its full path and the copy the engine kept inside the job', () => {
    expect(
      sameChecker(
        { kind: 'module', path: 'checks-3f9a2c1b4d5e.js' },
        { kind: 'module', path: 'C:\\Users\\dana\\Downloads\\checks.js' },
      ),
    ).toBe(false);
  });
});
