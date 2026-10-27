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
    const text = renderReportMarkdown(report);
    expect(text).toContain('- Student: Glimmer (meta/muse-glimmer-30b, a hosted copy)');
    expect(text).toContain(
      '- Dev tasks passed: 30% at the start (12 of 40), 87.5% at the end (70 of 80)',
    );
    expect(text).toContain('1. Round 3, "Add a pricing skill": +9 dev passes over 2 runs');
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
    expect(text).not.toMatch(/—|–/);
  });
});
