import { describe, expect, it } from 'vitest';
import { renderReportMarkdown } from '../src';
import { sampleReport } from './fixtures';

describe('renderReportMarkdown', () => {
  it('writes the report card', () => {
    expect(renderReportMarkdown(sampleReport())).toMatchInlineSnapshot(`
      "# Service desk: report card

      **38 of 50 locked test tasks passed (76%).** The target was 70%, so the pass rate requirement was met.

      - Student: Glimmer (muse-glimmer:30b, local through Ollama)
      - Mentor: Spark (muse-spark-1.3)
      - Method: Architect
      - Created: 2026-10-27

      ## Results by task type

      | Task type | Passed | Total | Pass rate |
      | --- | ---: | ---: | ---: |
      | Invoices | 20 | 24 | 83.3% |
      | Overdue balances | 18 | 26 | 69.2% |
      | Scheduling \\| urgent (refused) | 0 | 0 | n/a |
      | All tasks | 38 | 50 | 76% |

      ## Speed

      The median answer took 8.2 s. The slowest 5% took 21.4 s or longer.

      ## Training

      - Rounds: 7
      - Mentor cost: $0.84 (123,456 input tokens, 32,100 output tokens)
      - Training time: 1 h 12 min
      - Dev tasks passed: 30% at the start (12 of 40), 77.5% at the end (31 of 40)
      - Dev pass rate 77.5%, locked test pass rate 76%: a gap of 1.5 points

      ## Refused task types

      - Scheduling: Scheduled jobs in testing chose a valid slot only 60% of the time.

      ## What helped most

      1. Round 3, "Add a pricing skill": +5 dev passes
      2. Round 5, "Add an invoice total tool": +3 dev passes

      ## Requirements

      - Pass rate: target 70%, result 76%. Met.
      - 95th percentile answer time: target 25 s, result 21.4 s. Met.

      ## The mentor's readiness claim

      During training the mentor said the student was ready, and the locked test agreed.

      ## How the test was run

      The locked test was run once, on the student model's own runtime, with no network access and the mentor disconnected. The mentor never saw these tasks.
      "
    `);
  });

  it('says plainly when a requirement was missed, the mentor overclaimed and a task type was refused', () => {
    const report = sampleReport();
    report.test.score = { pass: 20, total: 50 };
    report.test.refusals = 1;
    report.requirements.passRate = { target: 0.7, actual: 0.4, met: false };
    report.requirements.p95LatencyMs = { target: 10_000, actual: 21_400, met: false };
    report.overclaim = true;
    const text = renderReportMarkdown(report);
    expect(text).toContain('so the pass rate requirement was not met.');
    expect(text).toContain(
      'The graduate refused 1 supported task during the test. Refusals count as failures.',
    );
    expect(text).toContain('- Pass rate: target 70%, result 40%. Not met.');
    expect(text).toContain('- 95th percentile answer time: target 10 s, result 21.4 s. Not met.');
    expect(text).toContain('The locked test disagreed.');
  });

  it('names a hosted copy and a change measured over more than one run', () => {
    const report = sampleReport();
    report.testedOn = 'hosted';
    report.student = {
      label: 'Glimmer',
      model: 'meta/muse-glimmer-30b',
      runtime: 'openai_compatible',
    };
    report.test = { ...report.test, ranOffline: false };
    report.dev = { ...report.dev, final: { pass: 70, total: 80 } };
    report.topInterventions = [{ round: 3, title: 'Add a pricing skill', delta: 9, runs: 2 }];
    report.cost = { ...report.cost, studentUsd: 0.81 };
    const text = renderReportMarkdown(report);
    expect(text).toContain('- Student: Glimmer (meta/muse-glimmer-30b, a hosted copy)');
    expect(text).toContain(
      '- Dev tasks passed: 30% at the start (12 of 40), 87.5% at the end (70 of 80)',
    );
    expect(text).toContain('1. Round 3, "Add a pricing skill": +9 dev passes over 2 runs');
    expect(text).toContain("- Hosted student cost: $0.81, billed by the student's host");
    expect(text).toContain(
      'The locked test was run once on a hosted copy of the student with the mentor disconnected, so it was not run offline.',
    );
  });

  it('handles a run with nothing to compare', () => {
    const report = sampleReport();
    report.test = { ...report.test, score: { pass: 0, total: 0 }, perType: [], ranOffline: false };
    report.dev = { baseline: null, final: null, curve: [] };
    report.refusedTypes = [];
    report.topInterventions = [];
    report.overclaim = null;
    delete report.requirements.p95LatencyMs;
    const text = renderReportMarkdown(report);
    expect(text).toContain('No locked test tasks were run.');
    expect(text).toContain('| All tasks | 0 | 0 | n/a |');
    expect(text).toContain('None. The graduate attempts every task type.');
    expect(text).toContain('No single change is credited with a gain.');
    expect(text).toContain('It was not run offline.');
    expect(text).not.toContain('Dev tasks passed');
    expect(text).not.toContain('readiness claim');
    expect(text).not.toContain('95th percentile');
  });

  it('says where the final test came from when Architect made its tasks from the files', () => {
    const report = sampleReport();
    expect(renderReportMarkdown(report)).not.toContain('Where the test tasks came from');

    report.tasks = { source: 'generated', draftingUsd: 0.0312 };
    const text = renderReportMarkdown(report);
    expect(text).toContain('## Where the test tasks came from');
    expect(text).toContain(
      "The final test's requests were generated by Architect from the files that were attached, following a job description that the mentor (Spark) drafted.",
    );
    expect(text).toContain(
      'Architect worked out every expected answer from those files with its own code',
    );
    expect(text).toContain(
      'Answers are checked against that job description. They have not been independently certified as correct for the business. Drafting the job cost the mentor $0.03, before training.',
    );
    expect(text.endsWith('before training.\n')).toBe(true);

    report.tasks = { source: 'generated', draftingUsd: 0 };
    expect(renderReportMarkdown(report)).not.toContain('Drafting the job cost');

    report.tasks = { source: 'attached' };
    const attached = renderReportMarkdown(report);
    expect(attached).toContain('The final test is part of the example tasks that were attached');
    expect(attached).not.toContain('independently certified');
  });

  it('says beside the score that the expected answers follow a rule the person confirmed, and shows the rule', () => {
    const report = sampleReport();
    report.tasks = {
      source: 'generated',
      draftingUsd: 0.02,
      rules: [
        {
          typeId: 'cost',
          label: 'Ticket totals',
          version: 'db5fc3156380',
          statement:
            'Start with (labor hours rounded up to a multiple of 0.5) times 65 times 0.9 when member (customers.csv) is yes. Add parts cost. The result is rounded to the nearest cent, half a cent rounds up.',
          passages: [
            { file: 'policy.md', passage: 'Labor is billed at $65 an hour, in half-hour steps.' },
            {
              file: 'answers',
              passage: 'No, labor only',
              question: 'Does the 10% off for members also apply to the parts?',
            },
            { file: 'description', passage: 'A repair desk for our bike shop' },
          ],
          conventions: ['A cell that is empty, N/A or not a number leaves its row out.'],
          cases: { total: 180, eligible: 118 },
          excluded: [{ reason: 'parts_cost is empty or N/A', count: 62, example: 'T-2002' }],
          branches: [
            { label: 'member (customers.csv) is yes', cases: 44, changes: 44 },
            { label: 'member (customers.csv) is no', cases: 74, changes: 74 },
          ],
          flags: [
            'None of your records needed rounding up to a multiple of 0.5, so no task tests it.',
          ],
          confirmedAt: '2026-10-29T10:00:00.000Z',
          expression: {
            op: 'round',
            arg: { op: 'col', column: 'parts_cost', from: 'row' },
            increment: '0.01',
            mode: 'half_up',
          },
        },
      ],
    };
    report.cost = { ...report.cost, rounds: 0 };
    const text = renderReportMarkdown(report);
    const note =
      "Architect worked out every expected answer from the rule you confirmed, which is Spark's reading of your policy. So this score shows how often the agent agreed with that rule on tasks it had never seen. It can't show whether the rule itself is right for your business.";
    expect(text).toContain(note);
    // Beside the score: right after the line that says it, before anything else.
    expect(text.indexOf(note)).toBeGreaterThan(text.indexOf('locked test tasks passed'));
    expect(text.indexOf(note)).toBeLessThan(text.indexOf('- Student:'));
    expect(text).toContain('## The rule behind the expected answers');
    expect(text).toContain('### Ticket totals (version db5fc3156380)');
    expect(text).toContain('The rule in words: Start with (labor hours rounded up');
    expect(text).toContain('The rule exactly as Architect evaluates it:');
    expect(text).toContain('```json\n{\n  "op": "round",\n  "arg": {\n    "op": "col",');
    expect(text).toContain('The person confirmed this rule on 2026-10-29');
    expect(text).toContain('- policy.md: "Labor is billed at $65 an hour, in half-hour steps."');
    // An answer is read with the question it answered, in the report as on the screen.
    expect(text).toContain(
      '- your answer to "Does the 10% off for members also apply to the parts?": "No, labor only"',
    );
    expect(text).toContain('- your description: "A repair desk for our bike shop"');
    expect(text).toContain('Rows of the table that could be worked out: 118 of 180.');
    expect(text).toContain('- 62 rows left out because parts_cost is empty or N/A, such as T-2002');
    expect(text).toContain(
      '- member (customers.csv) is yes: 44 rows, and the other side would give a different answer for all 44',
    );
    expect(text).toContain('Worth knowing:');
    expect(
      text
        .trimEnd()
        .endsWith(
          'Teaching did not run: the agent met the target on the check tasks before any round.',
        ),
    ).toBe(true);
    expect(text).not.toMatch(/[\u{2013}\u{2014}\u{2018}\u{2019}\u{201c}\u{201d}]/u);

    report.cost = { ...report.cost, rounds: 3 };
    expect(renderReportMarkdown(report)).toContain('Teaching ran for 3 rounds.');
    delete report.tasks.rules;
    expect(renderReportMarkdown(report)).not.toContain(note);
  });

  it('tells the rule as numbered steps, each with what the person said it rests on', () => {
    const report = sampleReport();
    report.tasks = {
      source: 'generated',
      rules: [
        {
          typeId: 'cost',
          label: 'Ticket totals',
          version: 'db5fc3156380',
          statement: 'Start with labor. Add parts cost.',
          steps: [
            { text: 'Round labor hours up to a multiple of 0.5.' },
            {
              text: 'When member (customers.csv) is yes, take 10% off.',
              files: ['customers.csv'],
            },
            { text: 'Add parts cost.', note: 'An empty parts cost counts as 0, as you said.' },
          ],
          passages: [{ file: 'policy.md', passage: 'Labor is billed at $65 an hour.' }],
          conventions: [],
          cases: { total: 10, eligible: 10 },
          excluded: [],
          branches: [],
          flags: [],
          confirmedAt: '2026-10-29T10:00:00.000Z',
          expression: { op: 'col', column: 'parts_cost', from: 'row' },
        },
      ],
    };
    const text = renderReportMarkdown(report);
    expect(text).toContain(
      'The rule in words:\n1. Round labor hours up to a multiple of 0.5.\n2. When member (customers.csv) is yes, take 10% off.\n3. Add parts cost. An empty parts cost counts as 0, as you said.\n',
    );
    // The sentence is for a report made before the steps existed.
    expect(text).not.toContain('Start with labor.');
    const rule = report.tasks.rules?.[0];
    if (rule === undefined) throw new Error('The report has a rule.');
    delete rule.steps;
    expect(renderReportMarkdown(report)).toContain(
      'The rule in words: Start with labor. Add parts cost.',
    );
    rule.steps = [];
    expect(renderReportMarkdown(report)).toContain(
      'The rule in words: Start with labor. Add parts cost.',
    );
  });

  it('says an answer about a mark beside its question, the quotes of the two never nested', () => {
    const question =
      'In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out.';
    const report = sampleReport();
    report.tasks = {
      source: 'generated',
      rules: [
        {
          typeId: 'cost',
          label: 'Ticket totals',
          version: 'db5fc3156380',
          statement: 'Add parts cost. "N/A" in parts cost counts as 0, as you said.',
          steps: [
            {
              text: 'Add parts cost.',
              note: '"N/A" in parts cost counts as 0, as you said.',
            },
          ],
          passages: [
            { file: 'policy.md', passage: 'Labor is billed at $65 an hour.' },
            { file: 'answers', passage: 'Count it as zero', question },
          ],
          conventions: [
            '"N/A" in parts_cost counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
          ],
          cases: { total: 160, eligible: 140 },
          excluded: [
            {
              reason: 'parts_cost says a dash ("-"), which is not counted as 0',
              count: 20,
              example: '- in T-2005',
            },
          ],
          branches: [],
          flags: ['23 rows have "N/A" in parts cost, which counts as 0, as you said.'],
          confirmedAt: '2026-10-29T10:00:00.000Z',
          expression: { op: 'col', column: 'parts_cost', from: 'row' },
        },
      ],
    };
    const text = renderReportMarkdown(report);
    expect(text).toContain(`- your answer to '${question}': "Count it as zero"`);
    expect(text).toContain(
      'The rule in words:\n1. Add parts cost. "N/A" in parts cost counts as 0, as you said.\n',
    );
    expect(text).toContain(
      '- 20 rows left out because parts_cost says a dash ("-"), which is not counted as 0, such as - in T-2005',
    );
    expect(text).toContain(
      '- "N/A" in parts_cost counts as 0, as you said. Anything else in it that is not a number still leaves the row out.',
    );
  });

  it('formats small amounts and durations', () => {
    const report = sampleReport();
    report.cost = { ...report.cost, mentorUsd: 0.0043, wallMs: 45_000 };
    report.test.latencyMs = { p50: 640, p95: 90_000 };
    const text = renderReportMarkdown(report);
    expect(text).toContain('Mentor cost: $0.0043');
    expect(text).toContain('Training time: 45 s');
    expect(text).toContain('The median answer took 640 ms. The slowest 5% took 2 min or longer.');
  });

  it('is plain Markdown: LF endings, one trailing newline, no dashes used as punctuation', () => {
    const text = renderReportMarkdown(sampleReport());
    expect(text).not.toContain('\r');
    expect(text.endsWith('.\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
    expect(text).not.toMatch(/[\u{2013}\u{2014}]/u);
  });
});
