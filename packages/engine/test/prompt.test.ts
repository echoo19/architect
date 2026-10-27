import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../src/agent/prompt';
import { containsPhrase, matchGuardrail, selectRetrieval } from '../src/agent/retrieval';
import { todayFor } from '../src/agent/today';
import { makeHarness, makeJob } from './support/fixtures';

const skills = [
  {
    slug: 'price-a-job',
    name: 'Price a completed job',
    summary: 'Turn a job into invoice lines.',
    body: '1. Read the job.\n2. Price it.\n',
  },
  {
    slug: 'find-overdue',
    name: 'Find overdue balances',
    summary: 'Subtract payments, then compare due dates.',
    body: 'Use the business date.',
  },
  {
    slug: 'book-a-slot',
    name: 'Book a slot',
    summary: 'Find the earliest feasible start.',
    body: 'Check travel.',
  },
];
const example = {
  slug: 'after-hours',
  title: 'After-hours job',
  messages: [
    { role: 'user' as const, content: 'Invoice job W-1.' },
    {
      role: 'assistant' as const,
      content: '',
      toolCalls: [{ id: 'c1', name: 'read_table', arguments: { file: 'jobs.csv' } }],
    },
    { role: 'tool' as const, toolCallId: 'c1', name: 'read_table', content: 'x'.repeat(500) },
    { role: 'assistant' as const, content: 'ANSWER: {"total_cents": 100}' },
  ],
};

describe('todayFor', () => {
  it("uses the job's business date, or the local calendar date when there is none", () => {
    const evening = new Date(2026, 0, 5, 23, 30);
    expect(todayFor({ businessDate: '2026-11-03' }, evening)).toBe('2026-11-03');
    expect(todayFor({}, evening)).toBe('2026-01-05');
    expect(todayFor({ businessDate: undefined }, new Date(2027, 11, 31, 0, 5))).toBe('2027-12-31');
  });
});

describe('containsPhrase', () => {
  it('matches at word starts, ignoring case and extra spaces', () => {
    expect(containsPhrase('Please create the Invoices for today', 'invoice')).toBe(true);
    expect(containsPhrase('Price  the\njob for W-2', 'price the job')).toBe(true);
    expect(containsPhrase('We need to reinvoice this', 'invoice')).toBe(false);
    expect(containsPhrase('anything', '   ')).toBe(false);
    expect(containsPhrase('Total (net)', '(net')).toBe(true);
  });
});

describe('selectRetrieval', () => {
  it('applies rules in order up to the caps', () => {
    const harness = makeHarness({
      skills,
      examples: [example],
      retrieval: {
        maxLoadedSkills: 2,
        maxExamples: 1,
        rules: [
          { whenAny: ['overdue'], loadSkills: ['find-overdue'] },
          {
            whenAny: ['invoice', 'bill'],
            loadSkills: ['price-a-job', 'find-overdue', 'book-a-slot'],
            loadExamples: ['after-hours'],
          },
          { whenAny: ['book'], loadSkills: ['book-a-slot'] },
        ],
      },
    });
    const retrieved = selectRetrieval(harness, 'Bill the overdue customer, then book a visit');
    expect(retrieved.skills.map((skill) => skill.slug)).toEqual(['find-overdue', 'price-a-job']);
    expect(retrieved.examples.map((item) => item.slug)).toEqual(['after-hours']);
    expect(selectRetrieval(harness, 'What is the weather?')).toEqual({ skills: [], examples: [] });
  });
});

describe('matchGuardrail', () => {
  it('returns the first rule that matches', () => {
    const harness = makeHarness({
      guardrails: {
        refuse: [
          {
            taskType: 'schedule',
            whenAny: ['book', 'appointment'],
            reason: 'Bookings were right 60% of the time.',
          },
          { taskType: 'refund', whenAny: ['refund', 'book'], reason: 'Not trained.' },
        ],
      },
    });
    expect(matchGuardrail(harness, 'Book the earliest appointment')).toEqual({
      taskType: 'schedule',
      reason: 'Bookings were right 60% of the time.',
    });
    expect(matchGuardrail(harness, 'Issue a refund')?.taskType).toBe('refund');
    expect(matchGuardrail(harness, 'Find overdue invoices')).toBeNull();
  });
});

describe('buildSystemPrompt', () => {
  const harness = makeHarness({
    skills,
    examples: [example],
    guardrails: {
      refuse: [
        { taskType: 'schedule', whenAny: ['book'], reason: 'Bookings were right 60% of the time.' },
      ],
    },
  });
  const job = makeJob();

  it('assembles the harness, date, data, skills, examples and refusals', () => {
    const prompt = buildSystemPrompt({
      harness,
      job,
      mode: 'task',
      today: '2026-11-03',
      loadedSkills: harness.skills.slice(0, 1),
      examples: harness.examples,
    });
    expect(prompt).toBe(
      [
        'You are the service desk of Ferncliff Home Services.',
        'Today is Tuesday, 2026-11-03.',
        [
          'Data files:',
          '- customers.csv (table, read only): Customers and their payment terms.',
          '- invoices.csv (table, writable): Issued invoices, one row each.',
          '- policy.md (text, read only): Pricing and payment rules.',
        ].join('\n'),
        [
          'Skills (load the full steps with load_skill):',
          '- price-a-job (Price a completed job): Turn a job into invoice lines.',
          '- find-overdue (Find overdue balances): Subtract payments, then compare due dates.',
          '- book-a-slot (Book a slot): Find the earliest feasible start.',
        ].join('\n'),
        'Skill price-a-job (Price a completed job), loaded for this request:\n1. Read the job.\n2. Price it.',
        [
          'Example: After-hours job',
          'User: Invoice job W-1.',
          'Assistant calls read_table {"file":"jobs.csv"}',
          `read_table returned: ${'x'.repeat(400)}…`,
          'Assistant: ANSWER: {"total_cents": 100}',
        ].join('\n'),
        [
          'Refuse these kinds of requests, giving the reason instead of attempting them:',
          '- schedule: Bookings were right 60% of the time.',
        ].join('\n'),
      ].join('\n\n'),
    );
  });

  it('adds one line in chat mode, leaves the skill index out when asked, and is deterministic', () => {
    const quiet = makeHarness({ skills, retrieval: { listSkills: false } });
    const input = {
      harness: quiet,
      job,
      mode: 'chat' as const,
      today: '2026-11-03',
      loadedSkills: [],
      examples: [],
    };
    const prompt = buildSystemPrompt(input);
    expect(prompt).not.toContain('Skills (load');
    expect(
      prompt.endsWith(
        'You are talking with the user directly. Reply in plain language; no ANSWER line is needed.',
      ),
    ).toBe(true);
    expect(buildSystemPrompt(input)).toBe(prompt);
  });

  it('rejects a date that is not a real YYYY-MM-DD day', () => {
    for (const today of ['2026-02-30', '11/03/2026', '']) {
      expect(() =>
        buildSystemPrompt({ harness, job, mode: 'task', today, loadedSkills: [], examples: [] }),
      ).toThrow(/today must be a date like 2026-11-03/);
    }
  });
});
