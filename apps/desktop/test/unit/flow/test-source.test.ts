import { describe, expect, it } from 'vitest';
import { testSourceNote } from '../../../src/renderer/src/flow/report/test-source';

describe('where the final test came from', () => {
  it('says nothing for a job whose tasks came with it', () => {
    expect(testSourceNote(undefined, 'Spark')).toBeNull();
  });

  it('says the requests were generated from a job the teacher drafted, and not certified as right', () => {
    expect(testSourceNote({ source: 'generated', draftingUsd: 0.04 }, 'Spark')).toBe(
      "The final test's requests were made by Architect from your files, following a job Spark drafted. Answers are checked against that job, not independently certified as right for your business.",
    );
  });

  it('leaves the caveat to the sentence beside the score when the answers follow a rule', () => {
    const rule = {
      typeId: 'cost',
      label: 'Ticket totals',
      version: 'db5fc3156380',
      statement: 'Add parts cost.',
      passages: [],
      conventions: [],
      cases: { total: 10, eligible: 10 },
      excluded: [],
      branches: [],
      flags: [],
      confirmedAt: '2026-10-29T12:00:00.000Z',
      expression: { op: 'num' as const, value: '1' },
    };
    expect(testSourceNote({ source: 'generated', rules: [rule] }, 'Spark')).toBe(
      "The final test's requests were made by Architect from your files, following a job Spark drafted.",
    );
  });

  it('says a final test taken from attached tasks has the answers they came with, and no more', () => {
    const note = testSourceNote({ source: 'attached' }, 'Spark');
    expect(note).toBe(
      'The final test is part of the tasks you attached. Its expected answers are the ones they came with.',
    );
    expect(note).not.toContain('drafted');
  });

  it('uses plain words, with no dashes or curly quotes', () => {
    const text = [
      testSourceNote({ source: 'generated' }, 'Spark'),
      testSourceNote({ source: 'attached' }, 'Spark'),
    ].join(' ');
    expect(text).not.toMatch(/[\u{2013}\u{2014}\u{2018}\u{2019}\u{201c}\u{201d}]/u);
  });
});
