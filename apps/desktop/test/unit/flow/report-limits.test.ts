import { describe, expect, it } from 'vitest';
import { limits } from '../../../src/renderer/src/flow/report/ReportView';

describe("what it won't do", () => {
  const reason = "Its job says it won't issue refunds or credits, so it leaves them to you.";

  it('folds a refused type into the limit that names it, so it is said once', () => {
    expect(
      limits(
        ['Issues refunds or credits', 'Changes prices or the rate card'],
        [{ type: 'refunds', label: 'Refunds', reason }],
      ),
    ).toEqual([
      { text: 'Issues refunds or credits', reason },
      { text: 'Changes prices or the rate card' },
    ]);
  });

  it('lists a refused type no limit names as a row of its own, first', () => {
    expect(
      limits(['Changes prices'], [{ type: 'warranty', label: 'Warranty claims', reason }]),
    ).toEqual([{ text: 'Warranty claims', reason }, { text: 'Changes prices' }]);
  });
});
