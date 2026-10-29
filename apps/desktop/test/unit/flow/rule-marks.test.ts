import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuleDetails, TaskPlan } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { RuleReview } from '../../../src/renderer/src/flow/define/RuleReview';
import { leftOutLine } from '../../../src/renderer/src/flow/define/rule-words';
import { makeJob } from './factories';

/*
 * What the person reads when they have said that a mark such as N/A counts as zero (decision 061):
 * the answer beside the question it answered, the step that says it, the example that shows the
 * mark as their file wrote it, and the rows left out that are still left out. The words come from
 * the engine; this is how the screen sets them.
 */

const EMPTY_QUESTION = 'What parts amount should be used when a ticket lists no parts cost?';
const NA_QUESTION =
  'In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out.';

const DETAILS: RuleDetails = {
  version: 'affdb6c549fa',
  statement:
    'Start with (labor hours rounded up to a multiple of 0.5) times 65. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up. An empty parts cost or "N/A" counts as 0, as you said.',
  passages: [
    { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
    { file: 'answers', passage: 'Count it as zero', question: EMPTY_QUESTION },
    { file: 'answers', passage: 'Count it as zero', question: NA_QUESTION },
  ],
  steps: [
    { text: 'Round labor hours up to a multiple of 0.5.' },
    { text: 'Multiply by 65.' },
    {
      text: 'Add parts cost.',
      note: 'An empty parts cost or "N/A" counts as 0, as you said.',
    },
    { text: 'Round the result to the nearest cent; half a cent rounds up.' },
  ],
  conventions: [
    'Numbers are read as written: a currency sign, thousands separators and brackets or a minus sign for a negative are understood. A cell that is empty, N/A or not a number leaves its row out, except where you said below that it counts as 0.',
    'An empty parts_cost or "N/A" counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
  ],
  cases: { total: 160, eligible: 148 },
  excluded: [
    {
      reason: 'parts_cost says a dash ("-"), which is not counted as 0',
      count: 12,
      example: '- in T-2005',
    },
  ],
  branches: [],
  flags: [
    '19 rows have an empty parts cost, which counts as 0, as you said.',
    '23 rows have "N/A" in parts cost, which counts as 0, as you said.',
  ],
  examples: [
    {
      taskId: 't-1',
      request: 'What does ticket T-2148 cost the customer?',
      inputs: [
        { label: 'labor hours', value: '2.6 (read as 2.6)' },
        { label: 'parts cost', value: 'N/A (counted as 0)' },
      ],
      steps: [
        { text: 'Labor hours (2.6), rounded up to a multiple of 0.5', value: '3' },
        { text: 'Labor 195 plus parts cost (N/A, so 0)', value: '195' },
      ],
      answer: '$195.00',
      covers: ['"N/A" in parts cost counts as 0'],
    },
  ],
  uncovered: [],
};

const COUNTS = { calibration: 1, train: 2, dev: 3, test: 4 };

function review(details: RuleDetails = DETAILS): string {
  const plan: TaskPlan = {
    source: 'generated',
    counts: COUNTS,
    types: [{ id: 'cost', label: 'Ticket totals', counts: COUNTS, examples: [], details }],
    unresolved: [],
    notes: [],
    confirmation: { state: 'needed', token: 'abc' },
  };
  return renderToStaticMarkup(createElement(RuleReview, { job: makeJob(), plan }));
}

/** What a person reads: no tags, one space between words. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ');
}

describe('a mark that counts as zero, as Define puts it in front of the person', () => {
  const html = review();

  it('shows each answer beside the question it answered, under the lines from the policy', () => {
    const policy = html.slice(html.indexOf('From your policy'), html.indexOf('The rule, in words'));
    const lines = [...policy.matchAll(/<li[\s\S]*?<\/li>/g)].map((item) => text(item[0]).trim());
    expect(lines).toEqual([
      'Labor is billed at $65 an hour, in half-hour steps. policy.md',
      `${EMPTY_QUESTION} Count it as zero your answer`,
      `${NA_QUESTION} Count it as zero your answer`,
    ]);
    // The question is set in the secondary color and the answer in the text's own, as any answer is.
    const [, , mark] = [...policy.matchAll(/<li[\s\S]*?<\/li>/g)].map((item) => item[0]);
    expect(mark).toMatch(/<span class="text-fg-secondary">In tickets\.csv, parts_cost/);
  });

  it('says in the step that adds the column what counts as zero in it, quietly after the step', () => {
    const rule = html.slice(html.indexOf('The rule, in words'), html.indexOf('>Examples<'));
    const steps = [...rule.matchAll(/<li[\s\S]*?<\/li>/g)].map((item) => text(item[0]).trim());
    expect(steps).toEqual([
      '1. Round labor hours up to a multiple of 0.5.',
      '2. Multiply by 65.',
      '3. Add parts cost. An empty parts cost or "N/A" counts as 0, as you said.',
      '4. Round the result to the nearest cent; half a cent rounds up.',
    ]);
    expect(rule).toMatch(
      /<span class="text-fg-muted"> An empty parts cost or &quot;N\/A&quot; counts as 0, as you said\.<\/span>/,
    );
  });

  it('shows the mark in the example as the file wrote it, with its working and what it shows', () => {
    const example = html.slice(html.indexOf('What does ticket T-2148'), html.indexOf('<details'));
    const shown = text(example);
    expect(shown).toContain('"N/A" in parts cost counts as 0');
    expect(shown).toContain('parts cost N/A (counted as 0)');
    expect(shown).toContain('Labor 195 plus parts cost (N/A, so 0)');
    expect(shown).toContain('$195.00');
  });

  it('counts what it counted, and leaves out only what the person did not say counts', () => {
    const shown = text(html);
    expect(shown).toContain('19 rows have an empty parts cost, which counts as 0, as you said.');
    expect(shown).toContain('23 rows have "N/A" in parts cost, which counts as 0, as you said.');
    expect(leftOutLine(DETAILS)).toBe(
      '12 of 160 rows left out of the tasks: parts_cost says a dash ("-"), which is not counted as 0',
    );
    expect(shown).toContain(
      '12 of 160 rows left out of the tasks: parts_cost says a dash ("-"), which is not counted as 0',
    );
    // It does not promise that the rows that were left out come back: it says which stay out.
    expect(shown).not.toMatch(/(?:rows?|them) (?:come|came|are|will be) back|all of the rows/i);
  });

  it('says nothing of rows left out when none is, and still says what counts as zero', () => {
    const none = { ...DETAILS, cases: { total: 160, eligible: 160 }, excluded: [] };
    expect(leftOutLine(none)).toBeNull();
    expect(text(review(none))).not.toContain('rows left out');
    expect(text(review(none))).toContain('An empty parts cost or "N/A" counts as 0, as you said.');
  });
});
