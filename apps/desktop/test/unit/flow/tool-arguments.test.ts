import { describe, expect, it } from 'vitest';
import {
  describeArguments,
  lineArguments,
} from '../../../src/renderer/src/flow/train/tool-arguments';

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
    expect(describeArguments({ path: 'data/jobs.csv', offset: 1501 })).toBe(
      'path data/jobs.csv · offset 1501',
    );
  });

  it('leaves out what a step shows in full under its line', () => {
    expect(lineArguments('run', { code: 'csv.parse(files.read("data/jobs.csv"))' }, false)).toEqual(
      {},
    );
    const edit = { path: 'data/invoices.csv', old_string: 'a', new_string: 'b' };
    expect(lineArguments('edit', edit, true)).toEqual({ path: 'data/invoices.csv' });
    expect(lineArguments('edit', edit, false)).toEqual(edit);
    expect(lineArguments('append', { path: 'data/x.csv', text: 'r' }, true)).toEqual({
      path: 'data/x.csv',
    });
    expect(lineArguments('write', { path: 'output/a.md', content: '# A' }, true)).toEqual({
      path: 'output/a.md',
    });
    expect(lineArguments('read_table', { file: 'jobs.csv' }, false)).toEqual({ file: 'jobs.csv' });
  });
});
