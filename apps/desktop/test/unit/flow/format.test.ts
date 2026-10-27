import { describe, expect, it } from 'vitest';
import {
  clip,
  fileName,
  formatAnswerTime,
  formatRange,
  formatRate,
  formatTimeLimit,
  percent,
  signed,
} from '../../../src/renderer/src/flow/format';

describe('flow formats', () => {
  it('rounds pass rates the way people do', () => {
    expect(percent({ pass: 23, total: 40 })).toBe(58);
    expect(formatRate({ pass: 31, total: 40 })).toBe('78%');
    expect(formatRate({ pass: 0, total: 0 })).toBe('0%');
  });

  it('signs changes with a true minus', () => {
    expect(signed(3)).toBe('+3');
    expect(signed(-2)).toBe('\u22122');
    expect(signed(0)).toBe('0');
    expect(formatRange(6, 9)).toBe('+6 to +9');
    expect(formatRange(-1, 2)).toBe('\u22121 to +2');
    expect(formatRange(4, 4)).toBe('+4');
  });

  it('writes answer times exactly when short and readably when long', () => {
    expect(formatAnswerTime(850)).toBe('850 ms');
    expect(formatAnswerTime(4240)).toBe('4.2 s');
    expect(formatAnswerTime(24_400)).toBe('24 s');
    expect(formatAnswerTime(131_000)).toBe('2 min 11 s');
    expect(formatAnswerTime(119_600)).toBe('2 min');
    expect(formatTimeLimit(8000)).toBe('<8s');
    expect(formatTimeLimit(45_000)).toBe('<45s');
    expect(formatTimeLimit(240_000)).toBe('<4 min');
  });

  it('names files from Windows and POSIX paths', () => {
    expect(fileName('C:\\office\\invoices.csv')).toBe('invoices.csv');
    expect(fileName('/Users/dana/office/policy.md')).toBe('policy.md');
    expect(fileName('tasks.jsonl')).toBe('tasks.jsonl');
  });

  it('clips long requests to a whole word', () => {
    expect(clip('Price job 4412', 40)).toBe('Price job 4412');
    expect(clip('Price the two jobs Dana finished today and tell me the totals', 30)).toBe(
      'Price the two jobs Dana\u2026',
    );
    expect(clip('Line one\n  line two', 40)).toBe('Line one line two');
  });
});
