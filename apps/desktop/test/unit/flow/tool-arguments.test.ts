import { describe, expect, it } from 'vitest';
import { describeArguments } from '../../../src/renderer/src/flow/train/tool-arguments';

describe('describeArguments', () => {
  it('reads a tool call the way a person would say it', () => {
    expect(
      describeArguments({
        file: 'technicians.csv',
        where: [{ column: 'license', op: '=', value: 'electrical' }],
      }),
    ).toBe('file technicians.csv · where license = electrical');
    expect(describeArguments({ job: 4410, rush: true, note: null })).toBe(
      'job 4410 · rush true · note none',
    );
    expect(describeArguments({ lines: [{ part: 'P-12', qty: 2 }] })).toBe(
      'lines {"part":"P-12","qty":2}',
    );
  });
});
