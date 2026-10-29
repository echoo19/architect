import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuleSteps, stepPieces } from '../../../src/renderer/src/flow/RuleSteps';

describe('the files a step names', () => {
  it('are cut out of the words, so each can be set quietly', () => {
    expect(
      stepPieces('When member (customers.csv) is yes, take 10% off.', ['customers.csv']),
    ).toEqual([
      { text: 'When member ', file: false },
      { text: '(customers.csv)', file: true },
      { text: ' is yes, take 10% off.', file: false },
    ]);
  });

  it('are found each time they are named, and every file the step lists', () => {
    expect(
      stepPieces('Add rate (rates.csv) and fee (fees.csv), then rate (rates.csv).', [
        'rates.csv',
        'fees.csv',
      ]).filter((piece) => piece.file),
    ).toHaveLength(3);
  });

  it('are found whatever their name holds, brackets and dots included', () => {
    const pieces = stepPieces('Add rate (rates (2).csv) and fee.', ['rates (2).csv']);
    expect(pieces.map((piece) => piece.text)).toEqual([
      'Add rate ',
      '(rates (2).csv)',
      ' and fee.',
    ]);
    expect(pieces[1]?.file).toBe(true);
    // A dot in a name is a dot, not any character.
    expect(stepPieces('Add rate (ratesXcsv).', ['rates.csv'])).toEqual([
      { text: 'Add rate (ratesXcsv).', file: false },
    ]);
  });

  it('leave a step that names none as it is', () => {
    expect(stepPieces('Multiply by 65.')).toEqual([{ text: 'Multiply by 65.', file: false }]);
    expect(stepPieces('Multiply by 65.', [])).toEqual([{ text: 'Multiply by 65.', file: false }]);
    // The words are never changed or lost, whatever is cut out of them.
    const text = 'a (x.csv) b (x.csv) c';
    expect(
      stepPieces(text, ['x.csv'])
        .map((piece) => piece.text)
        .join(''),
    ).toBe(text);
  });
});

describe('the rule as numbered steps', () => {
  const steps = [
    { text: 'Round labor hours up to a multiple of 0.5.' },
    { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
  ];

  it('numbers each step, and hides the numbers from a screen reader that counts the list itself', () => {
    const html = renderToStaticMarkup(
      createElement(RuleSteps, { steps, statement: 'Start with labor.' }),
    );
    expect(html.match(/<li/g)).toHaveLength(2);
    expect(html).toContain('<ol');
    expect(html).toMatch(/aria-hidden="true"[^>]*>1\.<\/span>/);
    expect(html).toMatch(/aria-hidden="true"[^>]*>2\.<\/span>/);
    expect(html).not.toContain('Start with labor.');
  });

  it('says the sentence for a rule with no steps to tell, in the size it was asked in', () => {
    for (const size of ['md', 'sm'] as const) {
      const html = renderToStaticMarkup(
        createElement(RuleSteps, { steps: undefined, statement: 'Start with labor.', size }),
      );
      expect(html).toContain('Start with labor.');
      expect(html).not.toContain('<ol');
    }
    const empty = renderToStaticMarkup(
      createElement(RuleSteps, { steps: [], statement: 'Start with labor.' }),
    );
    expect(empty).toContain('Start with labor.');
    expect(
      renderToStaticMarkup(
        createElement(RuleSteps, { steps, statement: 'Start with labor.', size: 'sm' }),
      ),
    ).toContain('text-sm');
  });
});
