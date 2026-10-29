import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuleDetails, TaskPlan } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { RuleReview } from '../../../src/renderer/src/flow/define/RuleReview';
import { makeJob } from './factories';

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

const COUNTS = { calibration: 1, train: 2, dev: 3, test: 4 };

function plan(confirmation: NonNullable<TaskPlan['confirmation']>): TaskPlan {
  return {
    source: 'generated',
    counts: COUNTS,
    types: [{ id: 'cost', label: 'Ticket totals', counts: COUNTS, examples: [], details: DETAILS }],
    unresolved: [],
    notes: [],
    confirmation,
  };
}

function review(confirmation: NonNullable<TaskPlan['confirmation']>): string {
  return renderToStaticMarkup(
    createElement(RuleReview, { job: makeJob(), plan: plan(confirmation) }),
  );
}

/** What a person reads: no tags, one space between words. */
function text(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

describe('the rule as Define puts it in front of the person', () => {
  const html = review({ state: 'needed', token: 'abc' });

  it('says what an example that is not from the records is, in plain words', () => {
    expect(text(html)).toContain('Not from your records');
    expect(text(html)).not.toContain('Made-up numbers');
  });

  it('says what an example shows, not what it is called', () => {
    expect(text(html)).toContain('Shows the rounding (labor hours)');
    expect(text(html)).toContain('Shows the rounding (the result)');
    expect(text(html)).not.toContain('A rounding edge');
  });

  it('says a tie in plain words, in the rule and in each step', () => {
    expect(text(html)).toContain('rounded to the nearest cent, half a cent rounds up.');
    expect(text(html)).toContain('195.005, rounded to the nearest cent, half a cent rounds up');
    expect(text(html)).not.toContain('halves going up');
  });

  it('gives the rows left out their reason in the line that says how many, when it is one', () => {
    expect(text(html)).toContain(
      '26 of 160 rows left out: parts_cost says N/A or a dash, which is not the same as empty',
    );
  });

  it('keeps the version out of the way of the title, in Details, and shows no code up front', () => {
    expect(html).not.toContain('affdb6c549fa');
    expect(text(html)).not.toMatch(/version/i);
    // A fold of its own, which the person opens for what is behind the rule.
    expect(html).toMatch(/aria-expanded="false"[^>]*>[\s\S]*?Details/);
    // The title stands alone in the card's header.
    expect(html).toMatch(/<header><h3[^>]*>[\s\S]*Ticket totals<\/h3><\/header>/);
  });

  it('tells the truth about the way out: change the description, and what comes back', () => {
    expect(html).toContain('>Change the description<');
    expect(html).not.toContain('Describe the job again');
    expect(text(html)).toContain(
      'Your words and files come back as you left them, and Spark may ask its questions again.',
    );
  });

  it('reads the question beside each answer in the secondary text, not the faintest', () => {
    const answer = html.slice(html.indexOf(QUESTION) - 80, html.indexOf('No, labor only') + 20);
    expect(answer).toContain('text-fg-secondary');
    expect(answer).not.toContain('text-fg-muted');
  });

  it("keeps 'Describe the job again' where the records changed under the rule", () => {
    const changed = review({
      state: 'changed',
      token: 'abc',
      problem:
        'policy.md is not the file the tasks were made from. Describe the job again, so the tasks are made from the records as they are now.',
    });
    expect(changed).toContain('>Describe the job again<');
    expect(changed).not.toContain('Change the description');
  });
});
