import { describe, expect, it } from 'vitest';
import { diffLines, diffRowCount } from '../../../src/renderer/src/workspace/diff';

describe('diffLines', () => {
  it('shows a changed row as before and after, marking the cells that changed', () => {
    const lines = diffLines({
      columns: ['invoice', 'status', 'total_cents'],
      added: [['INV-1043', 'open', 48620]],
      removed: [['INV-0999', 'void', 0]],
      changed: [{ before: ['INV-1001', 'open', 1200], after: ['INV-1001', 'paid', 1200] }],
    });
    expect(lines).toEqual([
      { kind: 'before', cells: ['INV-1001', 'open', 1200], changed: [false, true, false] },
      { kind: 'after', cells: ['INV-1001', 'paid', 1200], changed: [false, true, false] },
      { kind: 'removed', cells: ['INV-0999', 'void', 0], changed: [true, true, true] },
      { kind: 'added', cells: ['INV-1043', 'open', 48620], changed: [true, true, true] },
    ]);
  });

  it('fits short rows to the columns', () => {
    const [line] = diffLines({ columns: ['a', 'b'], added: [['x']], removed: [], changed: [] });
    expect(line?.cells).toEqual(['x', null]);
  });

  it('counts the rows a write touches', () => {
    expect(
      diffRowCount({
        columns: ['a'],
        added: [['1'], ['2']],
        removed: [['3']],
        changed: [{ before: ['4'], after: ['5'] }],
      }),
    ).toBe(4);
  });
});
