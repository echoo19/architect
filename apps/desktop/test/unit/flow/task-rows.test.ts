import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TaskPlan } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { TaskRows } from '../../../src/renderer/src/flow/define/TaskRows';

const counts = { calibration: 4, train: 18, dev: 13, test: 17 };

const plan: TaskPlan = {
  source: 'generated',
  counts,
  types: [
    {
      id: 'pending',
      label: 'Pending orders',
      rule: 'List the order_id in orders.csv where status is Pending, for each customer_id',
      counts,
      examples: [
        { request: 'Which orders of customer C-1076 are still pending?', answer: 'ORD-10381' },
      ],
    },
  ],
  unresolved: [],
  notes: [],
  answers: [{ question: 'Should cancelled orders count?', answer: '  No, leave them out ' }],
};

const render = (value: TaskPlan) =>
  renderToStaticMarkup(createElement(TaskRows, { plan: value, onMore: () => undefined }));

describe('the tasks on Define', () => {
  it('shows each kind by its name and a request, not the rule in column names', () => {
    const html = render(plan);
    expect(html).toContain('Pending orders');
    expect(html).toContain('Which orders of customer C-1076 are still pending?');
    expect(html).toContain('52 tasks');
    expect(html).not.toContain('customer_id');
  });

  it("shows the person's answers beside their questions, and nothing when there were none", () => {
    expect(render(plan)).toContain('Should cancelled orders count?');
    expect(render(plan)).toContain('No, leave them out<');
    const { answers: _answers, ...unasked } = plan;
    expect(render(unasked)).not.toContain('Your answers');
  });
});
