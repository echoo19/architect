import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuleDetails, RuleReport } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { PassageList } from '../../../src/renderer/src/flow/PassageList';
import { RuleNotes } from '../../../src/renderer/src/flow/report/RuleNotes';

const QUESTION = 'Does the 10% off for members also apply to the parts?';

const DETAILS: RuleDetails = {
  version: 'affdb6c549fa',
  statement:
    'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
  passages: [
    { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
    { file: 'answers', passage: 'No, labor only', question: QUESTION },
  ],
  conventions: ['All arithmetic is exact until a rounding step.'],
  cases: { total: 160, eligible: 134 },
  excluded: [
    { reason: 'parts_cost says N/A or a dash, which is not the same as empty', count: 26 },
  ],
  branches: [],
  flags: [],
  examples: [
    {
      taskId: 't-1',
      request: 'What does ticket T-2148 cost the customer?',
      inputs: [{ label: 'labor hours', value: '2.6' }],
      steps: [
        { text: '416.58, rounded to the nearest cent, half a cent rounds up', value: '416.58' },
      ],
      answer: '$416.58',
      covers: ['Shows the rounding (labor hours)'],
    },
    {
      request: 'Like T-2144, but with parts cost 0.005',
      inputs: [],
      steps: [
        { text: '195.005, rounded to the nearest cent, half a cent rounds up', value: '195.01' },
      ],
      answer: '$195.01',
      covers: ['Shows the rounding (the result)'],
      madeUp: true,
    },
  ],
  uncovered: [],
};

describe('the passages a rule rests on, wherever they are shown', () => {
  it('sets the source apart from the words, at the right, with room between them', () => {
    const html = renderToStaticMarkup(createElement(PassageList, { passages: DETAILS.passages }));
    expect(html).toContain('justify-between');
    expect(html).toContain('gap-x-4');
    expect(html).toContain('>your answer</span>');
    expect(html).toContain('>policy.md</span>');
    // The source is its own element, never text run on from the words.
    expect(html).not.toMatch(/No, labor only<\/span>\s*your answer/);
    expect(html).toContain('border-l-2');
  });

  it('is what the results show, the same markup as Define', () => {
    const report: RuleReport = {
      typeId: 'cost',
      label: 'Ticket totals',
      version: 'affdb6c549fa',
      statement: DETAILS.statement,
      passages: DETAILS.passages,
      conventions: DETAILS.conventions,
      cases: DETAILS.cases,
      excluded: DETAILS.excluded,
      branches: [],
      flags: [],
      confirmedAt: '2026-10-29T12:00:00.000Z',
      expression: { op: 'col', column: 'parts_cost', from: 'row' },
    };
    const notes = renderToStaticMarkup(createElement(RuleNotes, { rules: [report], rounds: 3 }));
    const list = renderToStaticMarkup(createElement(PassageList, { passages: DETAILS.passages }));
    // Each passage is the same markup as on Define, so the tag has the same room and place.
    const items = list.match(/<li[\s\S]*?<\/li>/g) ?? [];
    expect(items).toHaveLength(2);
    for (const item of items) expect(notes).toContain(item);
    expect(notes).not.toMatch(/No, labor only<\/span>\s*<span[^>]*>your answer/);
  });
});
