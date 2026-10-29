import type { SplitCounts } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  checkedAgainst,
  sourceText,
  splitsText,
  tasksText,
  totalOf,
} from '../../../src/renderer/src/flow/define/task-plan';

const COUNTS: SplitCounts = { calibration: 10, train: 40, dev: 30, test: 40 };

describe('the words about the tasks of a job', () => {
  it('counts tasks', () => {
    expect(tasksText(1)).toBe('1 task');
    expect(tasksText(0)).toBe('0 tasks');
    expect(tasksText(120)).toBe('120 tasks');
    expect(totalOf(COUNTS)).toBe(120);
  });

  it('names each set the way the other screens do, and the starting ones last', () => {
    expect(splitsText(COUNTS)).toBe('40 practice, 30 check, 40 final test, 10 set aside');
    expect(splitsText({ ...COUNTS, calibration: 0 })).toBe('40 practice, 30 check, 40 final test');
  });

  it('says where the tasks came from, by the short name of the teacher', () => {
    expect(sourceText('generated', 'Spark')).toBe(
      'Made by Architect from your files, following the job Spark drafted.',
    );
    expect(sourceText('attached', 'Spark')).toBe('From the tasks you attached.');
    expect(sourceText('included', 'Spark')).toBe('These came with the job.');
  });

  it('says what answers are checked against, without calling them certified', () => {
    expect(checkedAgainst('Spark')).toBe(
      'Answers are checked against what Spark drafted from your files, not independently certified as right for your business.',
    );
  });

  it('uses plain words, with no dashes or curly quotes', () => {
    const text = [
      sourceText('generated', 'Spark'),
      sourceText('attached', 'Spark'),
      sourceText('included', 'Spark'),
      checkedAgainst('Spark'),
      splitsText(COUNTS),
    ].join(' ');
    expect(text).not.toMatch(/[\u2013\u2014\u2018\u2019\u201c\u201d]/);
  });
});
