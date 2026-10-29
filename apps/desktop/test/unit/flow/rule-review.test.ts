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
  steps: [
    { text: 'Round labor hours up to a multiple of 0.5.' },
    { text: 'Multiply by 65.' },
    { text: 'When member (customers.csv) is yes, take 10% off.', files: ['customers.csv'] },
    { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
    { text: 'Round the result to the nearest cent; half a cent rounds up.' },
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

const COUNTS = { calibration: 1, train: 2, dev: 3, test: 4 };

function plan(
  confirmation: NonNullable<TaskPlan['confirmation']>,
  details: RuleDetails = DETAILS,
): TaskPlan {
  return {
    source: 'generated',
    counts: COUNTS,
    types: [{ id: 'cost', label: 'Ticket totals', counts: COUNTS, examples: [], details }],
    unresolved: [],
    notes: [],
    confirmation,
  };
}

function review(
  confirmation: NonNullable<TaskPlan['confirmation']>,
  details: RuleDetails = DETAILS,
): string {
  return renderToStaticMarkup(
    createElement(RuleReview, { job: makeJob(), plan: plan(confirmation, details) }),
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

  it('puts the tag of an example that is not a record first and set apart, and on no other', () => {
    // "Like T-2144, but with parts cost 0.005" was taken for T-2144 with a new price, so the tag
    // is the first thing under the request, set apart from the quiet tags beside it.
    const [real, made] = html
      .split('<li class="flex flex-col gap-3.5 rounded-2xl border border-line-card bg-panel')
      .slice(1);
    if (real === undefined || made === undefined) throw new Error('There are two examples.');
    expect(real).toContain('What does ticket T-2148 cost the customer?');
    expect(real).not.toContain('Not from your records');
    expect(made).toContain('Like T-2144, but with parts cost 0.005');
    expect(made.indexOf('Not from your records')).toBeGreaterThan(-1);
    expect(made.indexOf('Not from your records')).toBeLessThan(
      made.indexOf('Shows how the rule rounds the total'),
    );
    // Set apart in the body's own ink with its mark, and not in the red the changed rule wears:
    // a made-up example is not bad news.
    expect(made).toMatch(
      /<span class="[^"]*border-line-strong[^"]*text-fg[" ][^>]*><svg[^>]*lucide-info[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/svg>Not from your records<\/span>/,
    );
    expect(made).not.toMatch(/text-danger[^"]*"[^>]*><svg[^>]*>[\s\S]*?<\/svg>Not from/);
    expect(made).not.toMatch(/border-line-control text-fg-secondary[^"]*"[^>]*>Not from/);
    // What the example shows stays the quiet tag it was.
    expect(made).toMatch(/bg-card text-fg-soft[^"]*"[^>]*>Shows how the rule rounds the total</);
  });

  it('says what an example shows, not what it is called, and without brackets', () => {
    expect(text(html)).toContain('Shows how the rule rounds labor hours');
    expect(text(html)).toContain('Shows how the rule rounds the total');
    expect(text(html)).not.toContain('A rounding edge');
    expect(text(html)).not.toContain('Shows the rounding (');
  });

  it('says a tie in plain words, in the rule and in each step', () => {
    expect(text(html)).toContain('Round the result to the nearest cent; half a cent rounds up.');
    expect(text(html)).toContain('195.005, rounded to the nearest cent, half a cent rounds up');
    expect(text(html)).not.toContain('halves going up');
  });

  it('tells the rule as numbered steps in plain words, not as one sentence that reads like a formula', () => {
    const rule = html.slice(html.indexOf('The rule, in words'), html.indexOf('>Examples<'));
    expect(rule).toContain('<ol');
    const steps = [...rule.matchAll(/<li[\s\S]*?<\/li>/g)].map((item) => text(item[0]).trim());
    expect(steps).toEqual([
      '1. Round labor hours up to a multiple of 0.5.',
      '2. Multiply by 65.',
      '3. When member (customers.csv) is yes, take 10% off.',
      '4. Add parts cost. An empty parts cost counts as 0, as you said.',
      '5. Round the result to the nearest cent; half a cent rounds up.',
    ]);
    expect(text(rule)).not.toContain('Start with (labor hours rounded up');
  });

  it('sets a file named in a step quietly, apart from the weight of the sentence', () => {
    const rule = html.slice(html.indexOf('The rule, in words'), html.indexOf('>Examples<'));
    expect(rule).toContain('<span class="text-fg-muted">(customers.csv)</span>');
    // Only the file is quiet: the words around it are not.
    expect(rule).toMatch(
      /When member <span class="text-fg-muted">\(customers\.csv\)<\/span> is yes/,
    );
    // What the person said a step rests on follows it, quietly too.
    expect(rule).toContain(
      '<span class="text-fg-muted"> An empty parts cost counts as 0, as you said.</span>',
    );
  });

  it('says the rule as its one sentence when there are no steps to tell', () => {
    const sentence = review({ state: 'needed', token: 'abc' }, { ...DETAILS, steps: undefined });
    const rule = sentence.slice(
      sentence.indexOf('The rule, in words'),
      sentence.indexOf('>Examples<'),
    );
    expect(rule).not.toContain('<ol');
    expect(text(rule)).toContain('Start with (labor hours rounded up to a multiple of 0.5)');
  });

  it('gives the rows left out their reason in the line that says how many, when it is one', () => {
    expect(text(html)).toContain(
      '26 of 160 rows left out of the tasks: parts_cost says N/A or a dash, which is not the same as empty',
    );
  });

  it('says what the rule is for in the names the screen uses, and checks the lines it quotes', () => {
    // The agent is Glimmer here as everywhere on the screen, and "passages" is nowhere: the section
    // is called "From your policy".
    expect(text(html)).toContain(
      'Spark turned your policy into this rule. Architect works out the right answer to every task from this rule and grades Glimmer against those answers, so if the rule is wrong, the grades are wrong too.',
    );
    expect(text(html)).toContain('Check that the lines from your policy are the right ones');
    expect(text(html)).toContain('From your policy');
    expect(text(html)).not.toMatch(/passage|the agent is tested on/i);
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
