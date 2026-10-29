import { RULE_LIMITS } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import {
  columnWords,
  markName,
  markQuestion,
  markWords,
  placeholdersIn,
  sameMark,
} from '../src/drafting/rule/placeholders';
import { markOf } from '../src/drafting/values';

/*
 * The marks a column holds where a number should be, and the words that name them to a person:
 * how they are found, counted and told apart, and the question asked of each.
 */

const EM = '\u{2014}';
const EN = '\u{2013}';

describe('the marks a column holds', () => {
  it('are the forms an export writes for nothing, and never an empty cell, a number or a word', () => {
    for (const cell of [
      'N/A',
      'n/a',
      ' N/A ',
      '"N/A"',
      'n.a.',
      'NA',
      'nan',
      'NULL',
      'nil',
      'None',
    ]) {
      expect(markOf(cell), cell).not.toBeNull();
    }
    for (const cell of ['-', '--', '?', '??', EM, EN]) expect(markOf(cell), cell).not.toBeNull();
    for (const cell of ['', '  ', null, undefined, '0', '12.50', 'maybe', 'N/A?', '-1', '$-']) {
      expect(markOf(cell), String(cell)).toBeNull();
    }
    // The cell is cleaned: the quotes and the spaces round it are not part of the mark.
    expect(markOf(' "N/A" ')).toBe('N/A');
  });

  it('are counted by the mark, the most common first, a tie in the order they first appear', () => {
    const marks = placeholdersIn([
      '-',
      'N/A',
      'n/a',
      '12',
      '',
      null,
      'N/A',
      EM,
      '-',
      'none',
      EM,
      EM,
    ]);
    expect(marks.map((mark) => [mark.key, mark.rows])).toEqual([
      ['n/a', 3],
      [EM, 3],
      ['-', 2],
      ['none', 1],
    ]);
    // Of the two that tie at three, the one that came first goes first.
    expect(marks[0]?.key).toBe('n/a');
  });

  it('are spelled as the column writes them most often, the first spelling when two tie', () => {
    expect(placeholdersIn(['n/a', 'N/A', 'N/A', 'n/a', 'N/A'])[0]?.spelling).toBe('N/A');
    expect(placeholdersIn(['n/a', 'N/A'])[0]?.spelling).toBe('n/a');
    expect(placeholdersIn([' N/A ', '"N/A"', 'N/A'])[0]).toMatchObject({
      spelling: 'N/A',
      rows: 3,
    });
  });

  it('are one mark however they are cased or spaced, and two marks when their characters differ', () => {
    expect(placeholdersIn(['N/A', 'n/a', 'N/a', ' n/A '])).toHaveLength(1);
    expect(placeholdersIn(['NA', 'N/A', 'n.a.'])).toHaveLength(3);
    expect(placeholdersIn(['-', '--', '---', EN, EM])).toHaveLength(5);
    expect(sameMark('N/A', ' n/a ')).toBe(true);
    expect(sameMark('-', '--')).toBe(false);
    expect(sameMark(EN, EM)).toBe(false);
  });

  it('leave out a run too long to be one, which is not asked about and whose rows stay out', () => {
    const long = '-'.repeat(RULE_LIMITS.maxMarkChars + 1);
    const fits = '-'.repeat(RULE_LIMITS.maxMarkChars);
    expect(placeholdersIn([long, long])).toEqual([]);
    expect(placeholdersIn([fits, long]).map((mark) => mark.spelling)).toEqual([fits]);
  });

  it('are none in a column that holds only numbers, words and empty cells', () => {
    expect(placeholdersIn(['1', '2.5', '', null, '$3.00', 'later'])).toEqual([]);
    expect(placeholdersIn([])).toEqual([]);
  });
});

describe('the words that name a mark', () => {
  it('call a word by the word in quotes, and a dash or a question mark by what it is and its character', () => {
    expect(markName('N/A')).toBe('"N/A"');
    expect(markName('none')).toBe('"none"');
    expect(markName('-')).toBe('a dash');
    expect(markName('--')).toBe('a dash');
    expect(markName(EM)).toBe('a dash');
    expect(markName(EN)).toBe('a dash');
    expect(markName('??')).toBe('a question mark');
    expect(markWords('N/A')).toBe('"N/A"');
    expect(markWords('-')).toBe('a dash ("-")');
    expect(markWords(EM)).toBe(`a dash ("${EM}")`);
    expect(markWords('?')).toBe('a question mark ("?")');
  });

  it('say a column as words', () => {
    expect(columnWords('parts_cost')).toBe('parts cost');
    expect(columnWords('labor-hours')).toBe('labor hours');
    expect(columnWords(' fee ')).toBe('fee');
  });
});

describe('the question asked about a mark', () => {
  it('names the file, the column and the mark, says what each answer does, and when to leave it out', () => {
    expect(markQuestion('tickets.csv', 'parts_cost', 'N/A')).toBe(
      'In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out.',
    );
    expect(markQuestion('tickets.csv', 'parts_cost', '-')).toBe(
      'In tickets.csv, parts_cost sometimes has a dash ("-") where a number should be. Does a dash mean no parts cost? If it can also mean "not known yet", leave those rows out.',
    );
    expect(markQuestion('orders.csv', 'labor_hours', '?')).toBe(
      'In orders.csv, labor_hours sometimes has a question mark ("?") where a number should be. Does a question mark mean no labor hours? If it can also mean "not known yet", leave those rows out.',
    );
  });

  it('holds a choice and nothing of the records, so it can be told to anyone', () => {
    const question = markQuestion('tickets.csv', 'parts_cost', 'N/A');
    expect(question.replace('tickets.csv', '')).not.toMatch(/\d/);
    expect(question).not.toMatch(/\brows? of\b|\bT-\d|test|split|score/i);
  });

  it('is plain: no dash, no curly quote, no jargon', () => {
    for (const mark of ['N/A', '-', '?', 'none']) {
      const question = markQuestion('tickets.csv', 'parts_cost', mark);
      expect(question).not.toMatch(/[\u{2013}\u{2014}\u{2018}\u{2019}\u{201c}\u{201d}]/u);
      expect(question).not.toMatch(/placeholder|token|null|schema/i);
    }
  });
});
