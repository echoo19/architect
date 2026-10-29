import { RULE_LIMITS } from '@architect/shared';
import { foldKey, markOf } from '../values';

/*
 * Marks that stand where a number should be: N/A, a dash and the other forms a messy export writes
 * for "nothing" (decision 061). A rule leaves the row of such a cell out, unless the person said
 * that the mark means none. This is how a column's marks are read and how each is told to the
 * person: the question that asks what it means, and the words for it in the rule. Nothing here
 * decides anything. Only the person's answer does.
 */

/** A mark a column holds. */
export interface Placeholder {
  /** What marks are compared by (`foldKey`), so N/A and n/a are one mark. */
  key: string;
  /** How the column writes it most often. */
  spelling: string;
  /** How many cells hold it. */
  rows: number;
}

/**
 * The marks the cells of a column hold, the most common first and, for a tie, the one that appears
 * first. A run of dashes too long to be a mark (`maxMarkChars`) is none: it is not asked about,
 * and its rows stay out.
 */
export function placeholdersIn(cells: readonly (string | null)[]): Placeholder[] {
  const found = new Map<string, { spellings: Map<string, number>; rows: number; first: number }>();
  for (const [at, cell] of cells.entries()) {
    const text = markOf(cell);
    if (text === null || text.length > RULE_LIMITS.maxMarkChars) continue;
    const key = foldKey(text);
    const mark = found.get(key) ?? { spellings: new Map<string, number>(), rows: 0, first: at };
    mark.rows += 1;
    mark.spellings.set(text, (mark.spellings.get(text) ?? 0) + 1);
    found.set(key, mark);
  }
  return [...found]
    .map(([key, mark]) => {
      let spelling = '';
      let most = 0;
      for (const [form, count] of mark.spellings) {
        if (count > most) {
          spelling = form;
          most = count;
        }
      }
      return { key, spelling, rows: mark.rows, first: mark.first };
    })
    .sort((a, b) => b.rows - a.rows || a.first - b.first)
    .map(({ key, spelling, rows }) => ({ key, spelling, rows }));
}

/** Whether two spellings are one mark. */
export function sameMark(a: string, b: string): boolean {
  return foldKey(a) === foldKey(b);
}

type MarkKind = 'dash' | 'question' | 'word';

function kindOf(spelling: string): MarkKind {
  if (/^(?:-+|\u{2013}|\u{2014})$/u.test(spelling)) return 'dash';
  if (/^\?+$/.test(spelling)) return 'question';
  return 'word';
}

/** What a mark is called in a sentence: a dash, a question mark, or the word itself in quotes. */
export function markName(spelling: string): string {
  switch (kindOf(spelling)) {
    case 'dash':
      return 'a dash';
    case 'question':
      return 'a question mark';
    case 'word':
      return `"${spelling}"`;
  }
}

/**
 * A mark as the person recognizes it in their records: the word in quotes, or a dash or a question
 * mark with the character itself beside the name, since there are three dashes and a file may use
 * two of them for two things.
 */
export function markWords(spelling: string): string {
  return kindOf(spelling) === 'word' ? markName(spelling) : `${markName(spelling)} ("${spelling}")`;
}

/** A column's name as words: `parts_cost` is `parts cost`. */
export function columnWords(column: string): string {
  return column.replace(/[_-]+/g, ' ').trim();
}

/**
 * What Architect asks the person about a mark, in plain words. It names the file, the column and
 * the mark, says what each answer does, and says when the second is the right one: a mark that
 * sometimes means "not known yet" must not be counted as none. It carries no count and nothing of
 * any row, only the choice.
 */
export function markQuestion(table: string, column: string, spelling: string): string {
  const holds =
    kindOf(spelling) === 'word'
      ? `says ${markWords(spelling)}`
      : `has ${markWords(spelling)} where a number should be`;
  return `In ${table}, ${column} sometimes ${holds}. Does ${markName(spelling)} mean no ${columnWords(column)}? If it can also mean "not known yet", leave those rows out.`;
}
