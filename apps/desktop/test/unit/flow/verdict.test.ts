import type { Installation, ReportCard } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { reportVerdict } from '../../../src/renderer/src/flow/report/verdict';

const CONTEXT = { model: 'Glimmer', baseBytes: 18 * 1024 ** 3 };

function card(overrides: Partial<ReportCard['requirements']> = {}): ReportCard {
  return {
    name: 'Returns desk',
    test: { score: { pass: 58, total: 60 } },
    requirements: {
      passRate: { target: 0.9, actual: 58 / 60, met: true },
      ...overrides,
    },
  } as ReportCard;
}

function checked(
  status: Installation['status'],
  checks: Installation['checks'] = [],
): Pick<Installation, 'status' | 'checks'> {
  return { status, checks };
}

const SETUP_FAILED: Installation['checks'] = [
  {
    id: 'harness-valid',
    kind: 'harness_valid',
    status: 'failed',
    detail: 'harness/AGENTS.md is missing.',
  },
];

describe('the one verdict of a report', () => {
  it('graduates an agent that met its targets and runs here, or whose checks are not known yet', () => {
    for (const installation of [null, checked('ready'), checked('unchecked')]) {
      expect(reportVerdict(card(), installation, CONTEXT)).toMatchObject({
        state: 'ready',
        pill: 'Ready',
        title: 'Returns desk graduated',
        usable: true,
      });
    }
  });

  it('never says graduated or ready beside a check that says it cannot run', () => {
    const verdict = reportVerdict(card(), checked('blocked', SETUP_FAILED), CONTEXT);
    expect(verdict).toMatchObject({
      state: 'blocked',
      pill: "Can't run",
      title: "Returns desk can't run on this computer",
      usable: false,
    });
    expect(verdict.because).toEqual([
      "Its setup doesn't load.",
      'It scored 58 of 60 on its final test.',
    ]);
    expect(`${verdict.title} ${verdict.pill}`).not.toMatch(/graduated|Ready/);
  });

  it('puts a blocked agent first even when its test fell short, and says both', () => {
    const verdict = reportVerdict(
      card({ passRate: { target: 0.95, actual: 58 / 60, met: false } }),
      checked('blocked', SETUP_FAILED),
      CONTEXT,
    );
    expect(verdict.state).toBe('blocked');
    expect(verdict.because[1]).toMatch(
      /^It also fell short: 58 of 60 right, and the job needs 95%, which is 57 of 60/,
    );
  });

  it('says not ready, and what the job needs, when the targets were missed', () => {
    const verdict = reportVerdict(
      card({ passRate: { target: 0.95, actual: 5 / 6, met: false } }),
      checked('ready'),
      CONTEXT,
    );
    expect(verdict).toMatchObject({
      state: 'below_target',
      pill: 'Not ready',
      title: 'Returns desk finished training',
      usable: true,
    });
    expect(verdict.because[0]).toMatch(/^It missed the job's target: /);
    expect(verdict.because.at(-1)).toBe('You can still use it.');
  });

  it('asks for the one step that is missing when an agent that met its targets needs attention', () => {
    const verdict = reportVerdict(
      card(),
      checked('needs_attention', [
        {
          id: 'model-available',
          kind: 'model_available',
          status: 'failed',
          detail: 'muse-glimmer:30b is another build (weights sha256:5c0e17ab92d4).',
          modelProblem: 'other_build',
        },
      ]),
      CONTEXT,
    );
    expect(verdict).toMatchObject({
      state: 'needs_attention',
      pill: 'Needs attention',
      title: 'Returns desk needs one more step',
      usable: false,
    });
    expect(verdict.because).toEqual(['Needs a different copy of Glimmer (18 GB).']);
    expect(verdict.because.join(' ')).not.toMatch(/sha256/);
  });
});

/** A final test taken on the online copy, and one taken on this computer since. */
function online(pass = 58, met = true): ReportCard {
  return {
    ...card({ passRate: { target: 0.9, actual: pass / 60, met } }),
    testedOn: 'hosted',
    test: { score: { pass, total: 60 } },
  } as ReportCard;
}

function here(pass: number, met: boolean): ReportCard {
  return {
    ...card({ passRate: { target: 0.9, actual: pass / 60, met } }),
    testedOn: 'local',
    test: { score: { pass, total: 60 } },
  } as ReportCard;
}

describe('an agent whose final test ran on the online copy', () => {
  it('is tested online, not ready, however well it scored', () => {
    const verdict = reportVerdict(online(), checked('ready'), CONTEXT);
    expect(verdict).toEqual({
      state: 'tested_online',
      pill: 'Tested online',
      title: 'Returns desk passed its final test online',
      because: [
        'Its final test ran on an online copy of Glimmer, not on this computer. It got 58 of 60.',
        'Test it on this computer to see how it does on its own.',
      ],
      usable: true,
    });
    expect(`${verdict.title} ${verdict.pill}`).not.toMatch(/graduated|Ready/);
  });

  it('is ready once a test on this computer met the targets, and says both results', () => {
    const verdict = reportVerdict(online(), checked('ready'), CONTEXT, here(52, true));
    expect(verdict).toEqual({
      state: 'ready',
      pill: 'Ready',
      title: 'Returns desk graduated',
      because: ['It passed on this computer too: 52 of 60 on its final test.'],
      usable: true,
    });
  });

  it('is not ready when it passed online but fell short on this computer', () => {
    const verdict = reportVerdict(online(), checked('ready'), CONTEXT, here(40, false));
    expect(verdict.state).toBe('below_target');
    expect(verdict.because[0]).toBe(
      "It missed the job's target on this computer: 40 of 60 right, and the job needs 90%, which is 54 of 60.",
    );
    expect(verdict.because[1]).toBe('It scored 58 of 60 on its final test, run online.');
    expect(verdict.because.at(-1)).toBe('You can still use it.');
  });

  it('says it fell short online when that is the only test there is', () => {
    const verdict = reportVerdict(online(40, false), checked('ready'), CONTEXT);
    expect(verdict.state).toBe('below_target');
    expect(verdict.because[0]).toMatch(/^It missed the job's target on its online final test: /);
    expect(verdict.because).toHaveLength(2);
  });

  it('puts a check that says it cannot run first, and names where it was tested', () => {
    const verdict = reportVerdict(online(), checked('blocked', SETUP_FAILED), CONTEXT);
    expect(verdict.state).toBe('blocked');
    expect(verdict.because[1]).toBe('It scored 58 of 60 on its final test, run online.');
  });

  it('asks for the missing step before it asks for a test on this computer', () => {
    const verdict = reportVerdict(online(), checked('needs_attention'), CONTEXT);
    expect(verdict.state).toBe('needs_attention');
  });

  it('leaves a test that ran here as it is, whatever else is passed', () => {
    const verdict = reportVerdict(card(), checked('ready'), CONTEXT, here(10, false));
    expect(verdict).toMatchObject({ state: 'ready', because: [] });
  });
});
