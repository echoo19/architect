import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ruleScoreNote, type RuleReport } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { ScoreNotes } from '../../../src/renderer/src/flow/report/ScoreNotes';

function rule(overrides: Partial<RuleReport> = {}): RuleReport {
  return {
    typeId: 'cost',
    label: 'Ticket totals',
    version: 'affdb6c549fa',
    statement: 'Add parts cost.',
    passages: [{ file: 'policy.md', passage: 'Labor is billed at $65 an hour.' }],
    conventions: [],
    cases: { total: 160, eligible: 108 },
    excluded: [{ reason: 'parts_cost is empty or N/A', count: 52 }],
    branches: [],
    flags: [],
    confirmedAt: '2026-10-29T12:00:00.000Z',
    expression: { op: 'col', column: 'parts_cost', from: 'row' },
    ...overrides,
  };
}

const LEFT_OUT =
  'The tests could use 108 of the 160 rows. The other 52 were left out because parts_cost is empty or N/A.';

function notes(rules: readonly RuleReport[] | undefined): string {
  return renderToStaticMarkup(createElement(ScoreNotes, { rules, teacher: 'Spark' }));
}

/** The paragraphs of the block, each as its text and the classes that set how it is read. */
function lines(html: string): { text: string; classes: string }[] {
  return [...html.matchAll(/<p class="([^"]*)">([\s\S]*?)<\/p>/g)].map((found) => ({
    classes: found[1] ?? '',
    text: (found[2] ?? '').replace(/&#x27;/g, "'"),
  }));
}

/** The size classes of Tailwind's type scale, from the smallest. */
const SMALL = /(^|\s)text-(2xs|xs|sm)(\s|$)/;

describe('what is said under the score of a job with a rule', () => {
  const html = notes([rule()]);

  it('says the caveat first and what the rule left out after it, in one block', () => {
    expect(lines(html).map((line) => line.text)).toEqual([ruleScoreNote('Spark'), LEFT_OUT]);
    // One block holds both, so they sit together under the tiles and apart from what follows.
    expect(html.match(/<div/g)).toHaveLength(1);
    expect(html.startsWith('<div')).toBe(true);
    expect(html.endsWith('</div>')).toBe(true);
  });

  it('sets both at the size of the page, never in the small print of a tile note', () => {
    // The size and the color belong to the block, so the two lines cannot differ in either.
    const block = /^<div class="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(block).toMatch(/(^|\s)text-md(\s|$)/);
    expect(block).not.toMatch(SMALL);
    expect(block).toContain('text-fg-secondary');
    for (const line of lines(html)) {
      expect(line.classes).not.toMatch(SMALL);
      expect(line.classes).not.toMatch(/(^|\s)text-(base|md|lg|xl)(\s|$)/);
      expect(line.classes).not.toMatch(/text-fg(-\w+)?(\s|$)/);
    }
  });

  it('keeps to a line length that reads, as the sentence above the tiles does', () => {
    expect(html).toMatch(/^<div class="[^"]*max-w-\[660px\]/);
  });

  it('names the teacher the rule was read by', () => {
    const other = renderToStaticMarkup(
      createElement(ScoreNotes, { rules: [rule()], teacher: 'Spark Open' }),
    );
    expect(other).toContain('which is Spark Open&#x27;s reading of your policy');
  });
});

describe('what is said when the rule left nothing out, or there is more than one', () => {
  it('says only the caveat when no row was left out', () => {
    const whole = notes([rule({ cases: { total: 160, eligible: 160 }, excluded: [] })]);
    expect(lines(whole).map((line) => line.text)).toEqual([ruleScoreNote('Spark')]);
  });

  it('says what each rule left out, under the one caveat', () => {
    const second = rule({
      label: 'Refund amounts',
      cases: { total: 40, eligible: 38 },
      excluded: [{ reason: 'amount is empty', count: 2 }],
    });
    const found = lines(notes([rule(), second])).map((line) => line.text);
    expect(found).toHaveLength(3);
    expect(found[0]).toBe(ruleScoreNote('Spark'));
    expect(found[1]).toContain('For Ticket totals, the tests could use 108 of the 160 rows.');
    expect(found[2]).toContain('For Refund amounts, the tests could use 38 of the 40 rows.');
  });

  it('says nothing for a job that has no rule', () => {
    expect(notes(undefined)).toBe('');
  });
});
