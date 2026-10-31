import type { ArmReport, ComparisonReport, Projection } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/comparisons';
import {
  arm,
  BLANK,
  comparisonOne,
  DRAFTED,
  identity,
  LOCAL_MODEL,
  pair,
  row,
} from './support/report-fixture';

/** One section of the Markdown, from its heading to the next. */
function section(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  if (start < 0) throw new Error(`There is no section "${heading}".`);
  const next = markdown.indexOf('\n## ', start + 1);
  return markdown.slice(start, next < 0 ? undefined : next);
}

/** The arm of the fixture, changed. */
function withArm(report: ComparisonReport, id: string, changes: Partial<ArmReport>): void {
  const index = report.arms.findIndex((item) => item.arm === id);
  const found = report.arms[index];
  if (found === undefined) throw new Error(`There is no arm ${id}.`);
  report.arms[index] = { ...found, ...changes };
}

describe('the seeds the report says ran', () => {
  it('says which seeds ran, and that a declared seed that did not run was not run', () => {
    const text = renderMarkdown(comparisonOne());
    expect(text).toContain(
      'Final-test seeds declared in the plan before any arm ran: 101 and 102.',
    );
    expect(text).toContain(
      'Seed 101 ran for Glimmer alone; One-shot draft; Targeted mentoring; and Spark reference, blank harness.',
    );
    expect(text).toContain(
      'Seed 102 was declared for the decoding repeat and was not run, so no result in this report is under it.',
    );
    expect(text).not.toContain('Seed 102 ran');
    // The disclosures say the same, and no arm claims a seed it did not run.
    expect(text).not.toMatch(/final-test seeds 101(,| and) 102/);
  });

  it('says so when the repeat ran, and when nothing has yet', () => {
    const repeated = comparisonOne();
    repeated.plan.seedResults = [
      { seed: 101, arms: ['bare', 'draft', 'targeted', 'reference'] },
      { seed: 102, arms: ['bare', 'draft', 'targeted'] },
    ];
    expect(renderMarkdown(repeated)).toContain(
      'Seed 102 ran for Glimmer alone, One-shot draft and Targeted mentoring.',
    );
    const nothing = comparisonOne();
    nothing.plan.seedResults = [
      { seed: 101, arms: [] },
      { seed: 102, arms: [] },
    ];
    expect(renderMarkdown(nothing)).toContain(
      'No final test has run, so no seed has a result yet.',
    );
  });
});

describe('what the plan never asked for', () => {
  it('is said to be not run', () => {
    const text = renderMarkdown(comparisonOne());
    expect(text).toContain(
      'Not in this comparison, so not run: Spark reference, targeted harness; Decoding repeat; Fixed intervention; One-shot adapter; and Failure-specific adapter.',
    );
    // A plan with no second job to check the runtime on says so too.
    const report = comparisonOne();
    report.regression = null;
    if (report.inputs !== null) report.inputs.regression = null;
    expect(renderMarkdown(report)).toContain(
      'Failure-specific adapter; and the runtime regression check.',
    );
  });

  it('is not said when the plan asked for every arm', () => {
    const report = comparisonOne();
    report.plan.order = ['bare', 'draft', 'targeted', 'reference'];
    expect(renderMarkdown(report)).not.toContain('Not in this comparison');
  });
});

describe('the settings each arm ran with', () => {
  it('names the settings of each arm, not two configurations joined by "or"', () => {
    const text = renderMarkdown(comparisonOne());
    const hosted = text.slice(
      text.indexOf('### Hosted Glimmer'),
      text.indexOf('### Spark as a reference'),
    );
    expect(hosted).toContain(
      '| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |',
    );
    expect(hosted).toContain('| Glimmer alone | 1 | 0.95 | 64 | low | 16 | 4,096 |');
    expect(hosted).toContain('| One-shot draft | 0 | 1 | 64 | high | 30 | 8,192 |');
    expect(hosted).toContain('| Targeted mentoring | 0 | 1 | 64 | high | 30 | 8,192 |');
    expect(text).toContain(
      'The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.',
    );
    expect(text).not.toContain('Sampling and limits');
    expect(text).not.toContain('; or ');
    // Spark's table says what Spark was given: the blank harness's settings.
    expect(text).toContain('| Spark reference, blank harness | 1 | 0.95 | 64 | low | 16 | 4,096 |');
  });

  it('says so when a row has no settings on record', () => {
    const report = comparisonOne();
    const hosted = report.backends[0];
    if (hosted === undefined) throw new Error('The fixture has a hosted table.');
    hosted.rows = [{ ...row('bare', 'Glimmer alone', 43, BLANK), sampling: null }];
    expect(renderMarkdown(report)).toContain(
      '| Glimmer alone | not recorded | - | - | - | - | - |',
    );
  });
});

describe('where each frozen agent was measured', () => {
  it('names the local build it is set to run on and says every measurement is hosted', () => {
    const text = renderMarkdown(comparisonOne());
    expect(text).toContain(
      `Once installed, it is set to run on \`${LOCAL_MODEL}\` on Ollama. All of its measurements here are from hosted Glimmer; that local build was not measured.`,
    );
    // The old phrasing read as where it was measured.
    expect(text).not.toMatch(/Frozen: harness version \d+ \(`[0-9a-f]+`\) on ollama/);
    expect(text).not.toMatch(/\bon ollama\b/);
    // It is said for each frozen agent.
    expect(text.match(/that local build was not measured/g)).toHaveLength(3);
  });

  it('reports a local re-test when its records exist', () => {
    const report = comparisonOne();
    report.backends.push({
      backend: 'local-ollama',
      label: "This computer's Glimmer on Ollama",
      identity: identity({ model: LOCAL_MODEL, provider: 'Ollama', runtime: 'ollama' }),
      rows: [row('targeted', 'Targeted mentoring', 41, DRAFTED)],
      paired: [],
      repeats: [],
    });
    withArm(report, 'targeted', { measuredOn: ['hosted', 'local-ollama'] });
    const text = renderMarkdown(report);
    expect(text).toContain(
      'Its final test also ran on this computer; see the table "This computer\'s Glimmer on Ollama".',
    );
    expect(text.match(/that local build was not measured/g)).toHaveLength(2);
  });
});

describe('the money the report says was spent', () => {
  it('names the attempts, the provider and the uncertain requests for what they are', () => {
    const money = section(renderMarkdown(comparisonOne()), 'Money');
    expect(money).toContain('**Spark: $2.5797.**');
    expect(money).toContain('**Compute: $0.0000.**');
    expect(money).toContain(
      '**Hosted Glimmer, recorded by its attempts: $3.7630.** The cost written down with each attempt, every dollar once: the arms $3.3438, the calibration $0.0935 and the regression check $0.3257.',
    );
    expect(money).toContain(
      "**Hosted Glimmer, settled by the provider: $3.8075.** The request journal's 5,077 requests with a known charge, all of them billed by the provider. That is $0.0445 more than the attempts record",
    );
    expect(money).toContain(
      "**Hosted Glimmer, uncertain: $0.1359.** The journal's 10 requests that a crash or a failure cut off, whose charge is not known, each counted at the most it could have cost.",
    );
    expect(money).toContain(
      'The journal counts $3.9434 in all, settled plus uncertain, of the $15.00 set aside for hosted Glimmer: $0.1804 more than the attempts record.',
    );
    expect(money).toContain('not added together');
  });

  it('shows figures that add up, worked out from the unrounded values', () => {
    // In cents these read $3.76, $3.81 and $0.14, which do not add up to $3.94 (the unrounded
    // $3.94342634 less $3.76297788 is $0.18); shown to a tenth of a cent, they do.
    const money = section(renderMarkdown(comparisonOne()), 'Money');
    const amount = (pattern: RegExp) => {
      const found = pattern.exec(money)?.[1];
      if (found === undefined) throw new Error(`The money section has no ${pattern}.`);
      return Math.round(Number(found) * 1e4);
    };
    const recorded = amount(/recorded by its attempts: \$(\d+\.\d{4})/);
    const settled = amount(/settled by the provider: \$(\d+\.\d{4})/);
    const settledMore = amount(/That is \$(\d+\.\d{4}) more than the attempts record/);
    const uncertain = amount(/uncertain: \$(\d+\.\d{4})/);
    const total = amount(/The journal counts \$(\d+\.\d{4})/);
    const totalMore = amount(/: \$(\d+\.\d{4}) more than the attempts record\.$/m);
    expect(recorded + settledMore).toBe(settled);
    expect(settled + uncertain).toBe(total);
    expect(recorded + totalMore).toBe(total);
  });

  it('keeps the figures it shows adding up when rounding would not', () => {
    const report = comparisonOne();
    // Recorded 1.00004, settled 1.00006 and 0.00008 uncertain: 1.00014 in all. Rounded one by one
    // they read 1.0000, 1.0001, 0.0001 and 1.0001, which do not add up.
    report.totals.studentUsd = 1.00004;
    report.credit = {
      capUsd: 15,
      requests: 10,
      settledUsd: 1.00006,
      billedRequests: 7,
      uncertainUsd: 0.00008,
      uncertainRequests: 1,
      inFlightRequests: 0,
      totalUsd: 1.00014,
    };
    const money = section(renderMarkdown(report), 'Money');
    expect(money).toContain('recorded by its attempts: $1.0000.');
    expect(money).toContain('settled by the provider: $1.0001.');
    expect(money).toContain('That is $0.0001 more than the attempts record');
    expect(money).toContain('uncertain: $0.0000.');
    expect(money).toContain('The journal counts $1.0001 in all');
    expect(money).toContain('7 of them billed by the provider and the rest at the listed price');
  });

  it('says less than, or the same, when the journal does not hold more', () => {
    const report = comparisonOne();
    report.totals.studentUsd = 4;
    expect(section(renderMarkdown(report), 'Money')).toContain(
      '$0.1925 less than the attempts record',
    );
    report.totals.studentUsd = 3.80752514;
    expect(section(renderMarkdown(report), 'Money')).toContain(
      'That is the same as the attempts record.',
    );
  });

  it('says what it does not know instead of a figure', () => {
    const report = comparisonOne();
    report.totals.studentUsd = null;
    expect(section(renderMarkdown(report), 'Money')).toContain(
      '**Hosted Glimmer, recorded by its attempts: unknown.**',
    );
    report.credit = null;
    expect(section(renderMarkdown(report), 'Money')).toContain(
      'The request journal holds no hosted request.',
    );
  });

  it('keeps the projection apart from what was spent', () => {
    const report = comparisonOne();
    const projection: Projection = {
      inputs: [],
      arms: [
        {
          arm: 'bare',
          hostedAttempts: 105,
          localAttempts: 0,
          sparkAttempts: 0,
          sparkCalls: 0,
          studentUsd: 0.65,
          sparkUsd: 0,
          computeUsd: 0,
          localMinutes: 0,
          wallMinutes: 36,
          funded: true,
          blockedBy: null,
          reason: null,
        },
      ],
      caps: { studentUsd: 15, sparkUsd: 10, computeUsd: 0, localMinutes: 0 },
      committedUsd: 0.29,
      funded: {
        studentUsd: 4.64,
        sparkUsd: 5.46,
        computeUsd: 0,
        localMinutes: 0,
        wallMinutes: 183,
      },
      requested: { studentUsd: 4.64, sparkUsd: 5.46, computeUsd: 0, localMinutes: 0 },
    };
    report.projection = projection;
    const text = renderMarkdown(report);
    expect(section(text, 'Money')).not.toMatch(/4\.64|5\.46|[Pp]rojected/);
    const projected = section(text, 'Projection made before the run, not what was spent');
    expect(projected).toContain('Nothing here was spent; what was spent is under Money and Arms.');
    expect(projected).toContain('| Projected Glimmer | Projected Spark | Projected compute |');
    expect(projected).toContain('Projected for the funded arms: Glimmer $4.64 of $15.00');
    expect(text).not.toContain('Measurement model and projection');
  });
});

describe('the development columns of the arms table', () => {
  it('shows the first measurement and the kept round on their own scales, and why each arm stopped', () => {
    const text = renderMarkdown(comparisonOne());
    const arms = section(text, 'Arms');
    expect(arms).toContain(
      '| # | Arm | Status | Rounds used of the most allowed, and why training ended | Check tasks, first measurement | Check tasks, last kept round: before to after |',
    );
    expect(arms).toContain('| 1 | Glimmer alone | complete | - | 24/45 | - |');
    expect(arms).toContain(
      '| 2 | One-shot draft | complete | 1 of 1, done | 30/45 | round 1: 30/45 to 35/45 (kept without a check) |',
    );
    expect(arms).toContain(
      '| 3 | Targeted mentoring | complete | 2 of 2, cap reached | 33/45 | round 2: 60/90 to 73/90 |',
    );
    expect(arms).toContain('| 4 | Spark reference, blank harness | complete | - | - | - |');
    // One run of 45 is never set beside two runs of 90.
    expect(arms).not.toContain('33/45, 73/90');
    expect(arms).not.toContain('Dev before, after');
    expect(arms).toContain('The first check-task measurement is one run over the check tasks.');
    expect(arms).toContain(
      "Compare a round's before with its after, not with the first measurement.",
    );
  });

  it('says how the training ended in other cases, and when no round was kept', () => {
    const report = comparisonOne();
    withArm(report, 'targeted', {
      caps: { sparkUsd: 5, studentUsd: 5, computeUsd: null, wallMinutes: 720, rounds: 7 },
      rounds: { used: 5, ended: 'patience ran out' },
      dev: { baseline: { pass: 33, total: 45 }, kept: null },
    });
    withArm(report, 'draft', { rounds: { used: 0, ended: null } });
    const arms = section(renderMarkdown(report), 'Arms');
    expect(arms).toContain(
      '| 3 | Targeted mentoring | complete | 5 of 7, patience ran out | 33/45 | none kept |',
    );
    expect(arms).toContain('| 2 | One-shot draft | complete | 0 of 1 | 30/45 |');
  });

  it('keeps the spending in a table of its own, spent of the cap', () => {
    const arms = section(renderMarkdown(comparisonOne()), 'Arms');
    expect(arms).toContain(
      '| # | Arm | Spark: spent of its cap, tokens | Glimmer: spent of its cap, attempts | Compute | Examples / trained tokens |',
    );
    expect(arms).toContain(
      '| 1 | Glimmer alone | $0.00 of $0.00, 0 in / 0 out | $0.85 of $1.00, 105 attempts |',
    );
  });
});

describe('the difference in pass rate of each pair', () => {
  it('adds it, with its 95% interval, to every pair', () => {
    const text = renderMarkdown(comparisonOne());
    expect(text).toContain(
      '| Paired under seed 101, scenario by scenario | Scenarios | Wins | Losses (regressions) | Both | Neither | First less second, in percentage points (95% interval) | By type (wins/losses) |',
    );
    expect(text).toContain(
      '| One-shot draft vs Glimmer alone | 60 | 13 | 9 | 34 | 4 | +6.7 (-8.8 to +21.8) |',
    );
    expect(text).toContain(
      '| Targeted mentoring vs Glimmer alone | 60 | 11 | 9 | 34 | 6 | +3.3 (-11.5 to +18.0) |',
    );
    expect(text).toContain(
      '| Targeted mentoring vs One-shot draft | 60 | 3 | 5 | 42 | 10 | -3.3 (-13.4 to +6.6) |',
    );
    expect(text).toContain(
      '| Spark reference, blank harness vs Glimmer alone | 60 | 17 | 0 | 43 | 0 | +28.3 (+16.8 to +40.8) |',
    );
  });

  it('shows a pair with no wins or losses, and one with only wins', () => {
    const report = comparisonOne();
    const hosted = report.backends[0];
    if (hosted === undefined) throw new Error('The fixture has a hosted table.');
    hosted.paired = [
      pair('targeted', 'bare', 'Targeted mentoring vs Glimmer alone', {
        wins: 0,
        losses: 0,
        both: 30,
        neither: 30,
      }),
      pair('draft', 'bare', 'One-shot draft vs Glimmer alone', {
        wins: 60,
        losses: 0,
        both: 0,
        neither: 0,
      }),
    ];
    const text = renderMarkdown(report);
    expect(text).toContain('| 60 | 0 | 0 | 30 | 30 | 0.0 (-3.2 to +3.2) |');
    expect(text).toContain('| 60 | 60 | 0 | 0 | 0 | +100.0 (+91.5 to +100.0) |');
  });

  it('says how to read it among the disclosures it is given', () => {
    const report = comparisonOne();
    report.disclosures = [
      "A pair's difference in pass rate is the first arm's less the second's, with a 95% interval.",
    ];
    expect(section(renderMarkdown(report), 'Disclosures')).toContain(
      "A pair's difference in pass rate",
    );
  });
});

describe('the adapters the report speaks of', () => {
  it('says once that every agent is harness-only, and prints no protocol, when no adapter arm ran', () => {
    const text = renderMarkdown(comparisonOne());
    expect(text.match(/harness-only/g)).toHaveLength(1);
    expect(text).toContain('Every reported agent is harness-only: none has trained weights.');
    expect(text).not.toContain('Adapter protocol');
    expect(text).not.toContain('four-cell');
    expect(text).not.toContain('| Adapter |');
    expect(text).not.toContain('no adapter');
    // An adapter arm that was asked for and never ran is not an adapter arm that ran.
    const asked = comparisonOne();
    asked.arms.push(
      arm('weights-one-shot', 'One-shot adapter', {
        priority: 7,
        status: 'not_run',
        reason: 'It needs compute.',
        runId: null,
        measuredOn: [],
        frozen: null,
      }),
    );
    const notRun = renderMarkdown(asked);
    expect(notRun).not.toContain('Adapter protocol');
    expect(notRun).toContain('Every reported agent is harness-only: none has trained weights.');
    expect(notRun).toContain('Not run: It needs compute.');
  });

  it('prints the protocol, and the adapter column, when an adapter arm ran', () => {
    const report = comparisonOne();
    report.arms.push(
      arm('weights-one-shot', 'One-shot adapter', {
        priority: 7,
        frozen: {
          harnessVersion: 3,
          harnessHash: `sha256-c0fa47e2912c${'0'.repeat(52)}`,
          localModel: LOCAL_MODEL,
          backend: 'llama.cpp',
          adapter: {
            id: 'adapter-1',
            sha256: 'ab'.repeat(32),
            scale: 1,
            baseDigest: null,
            standIn: false,
          },
          testSeeds: [101],
          decoding: DRAFTED,
        },
      }),
    );
    const text = renderMarkdown(report);
    expect(text).toContain('Adapter protocol: four-cell.');
    expect(text).not.toContain('harness-only');
    expect(text).toContain('| Harness | Adapter |');
    expect(text).toContain(', no adapter.');
    expect(text).toContain('adapter adapter-1 (`abababababab`) at scale 1');
  });
});

describe('the words of a rendered report', () => {
  it('has no arrow, dash or curly quote of its own', () => {
    expect(renderMarkdown(comparisonOne())).not.toMatch(
      /[\u{2192}\u{2013}\u{2014}\u{2018}\u{2019}\u{201C}\u{201D}\u{2026}]/u,
    );
  });
});
