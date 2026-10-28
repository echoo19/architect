import type { RowDiff } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  addsToFile,
  changeCounts,
  changeVerb,
  previewSize,
  rowCounts,
} from '../../../src/renderer/src/workspace/changes';

const rows: RowDiff = {
  columns: ['invoice', 'total'],
  added: [['INV-4471', '$524.03']],
  removed: [],
  changed: [{ before: ['INV-4410', '$480.00'], after: ['INV-4410', '$486.20'] }],
};

const created = [
  '--- /dev/null',
  '+++ b/output/visit-notes/B-3051.md',
  '@@ -0,0 +1,3 @@',
  '+# B-3051: panel repair',
  '+',
  '+Call ahead: the side gate is locked.',
  '',
].join('\n');

const edited = [
  '--- a/output/summary.md',
  '+++ b/output/summary.md',
  '@@ -1,2 +1,2 @@',
  '-Two invoices are open.',
  '+Three invoices are open.',
  ' Both are due Friday.',
  '',
].join('\n');

describe('a change the agent asks to make', () => {
  it('leads with what it does to the file', () => {
    expect(changeVerb({ op: 'write', patch: created })).toBe('Create');
    expect(changeVerb({ op: 'write', patch: edited })).toBe('Write');
    expect(changeVerb({ op: 'write', diff: rows })).toBe('Write');
    expect(changeVerb({ op: 'edit', patch: edited })).toBe('Edit');
    expect(changeVerb({ op: 'append', diff: rows })).toBe('Add to');
    expect(changeVerb({ op: 'update', diff: rows })).toBe('Update');
    expect(addsToFile({ op: 'write', patch: created })).toBe(true);
    expect(addsToFile({ op: 'append', diff: rows })).toBe(true);
    expect(addsToFile({ op: 'edit', patch: edited })).toBe(false);
  });

  it('counts the rows of a table and the lines of any other file', () => {
    expect(rowCounts(rows)).toBe('1 new row · 1 row changed');
    expect(changeCounts({ op: 'append', diff: rows })).toBe('1 new row · 1 row changed');
    expect(changeCounts({ op: 'write', patch: created })).toBe('3 lines');
    expect(changeCounts({ op: 'edit', patch: edited })).toBe('1 new line · 1 line removed');
    expect(changeCounts({ op: 'edit' })).toBe('');
  });

  it('sizes the preview in what it shows: rows, or lines', () => {
    expect(previewSize({ op: 'append', diff: rows })).toEqual({ count: 3, unit: 'rows' });
    expect(previewSize({ op: 'write', patch: created })).toEqual({ count: 3, unit: 'lines' });
    expect(previewSize({ op: 'edit', patch: edited })).toEqual({ count: 3, unit: 'lines' });
  });
});
