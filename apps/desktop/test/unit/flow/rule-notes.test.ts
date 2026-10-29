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
      covers: ['Shows how the rule rounds labor hours'],
    },
    {
      request: 'Like T-2144, but with parts cost 0.005',
      inputs: [],
      steps: [
        { text: '195.005, rounded to the nearest cent, half a cent rounds up', value: '195.01' },
      ],
      answer: '$195.01',
      covers: ['Shows how the rule rounds the total'],
      madeUp: true,
    },
  ],
  uncovered: [],
};

const STEPS = [
  { text: 'Round labor hours up to a multiple of 0.5.' },
  { text: 'Multiply by 65.' },
  { text: 'When member (customers.csv) is yes, take 10% off.', files: ['customers.csv'] },
  { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
  { text: 'Round the result to the nearest cent; half a cent rounds up.' },
];

function reportOf(rule: Partial<RuleReport> = {}): RuleReport {
  return {
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
    ...rule,
  };
}

const notesOf = (rule: RuleReport): string =>
  renderToStaticMarkup(createElement(RuleNotes, { rules: [rule], rounds: 3 }));

/** What a person reads: no tags, one space between words. */
const words = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

describe('the rule in the results', () => {
  it('is told as numbered steps, the files named in a step set quietly', () => {
    const html = notesOf(reportOf({ steps: STEPS }));
    const steps = [...html.matchAll(/<li[^>]*class="grid[\s\S]*?<\/li>/g)].map((item) =>
      words(item[0]).trim(),
    );
    expect(steps).toEqual([
      '1. Round labor hours up to a multiple of 0.5.',
      '2. Multiply by 65.',
      '3. When member (customers.csv) is yes, take 10% off.',
      '4. Add parts cost. An empty parts cost counts as 0, as you said.',
      '5. Round the result to the nearest cent; half a cent rounds up.',
    ]);
    expect(html).toContain('<span class="text-fg-muted">(customers.csv)</span>');
    expect(words(html)).not.toContain('Start with (labor hours rounded up');
  });

  it('keeps the sentence for a report made before the steps existed', () => {
    const html = notesOf(reportOf());
    expect(words(html)).toContain('Start with (labor hours rounded up to a multiple of 0.5)');
    expect(html).not.toContain('<ol');
  });

  it('says when the person confirmed it the way Define does: "Oct 29", not 2026-10-29', () => {
    const html = notesOf(reportOf());
    expect(words(html)).toContain('Confirmed Oct 29');
    expect(words(html)).not.toContain('2026-10-29');
  });
});

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
