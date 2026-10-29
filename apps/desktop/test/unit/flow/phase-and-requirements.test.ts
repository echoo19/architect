import { describe, expect, it } from 'vitest';
import type { ReportCard } from '@architect/shared';
import { missedRequirements } from '../../../src/renderer/src/flow/report/requirements';
import { phaseView } from '../../../src/renderer/src/flow/train/phase';
import { makeRun } from './factories';

const NAMES = { mentor: 'Spark', student: 'Glimmer' };

describe('phaseView', () => {
  it('says what each step of a round is doing, with the job’s model names', () => {
    const view = (phase: Parameters<typeof makeRun>[0]) => phaseView(makeRun(phase), NAMES);
    expect(view({ phase: 'attempting' })).toEqual({
      stage: 'attempting',
      motion: 'practising',
      frozen: false,
      text: 'Glimmer is working through practice tasks',
    });
    expect(view({ phase: 'diagnosing' })).toMatchObject({
      stage: 'diagnosing',
      motion: 'returning',
      text: 'Spark is reading the failures',
    });
    expect(view({ phase: 'evaluating' })).toMatchObject({
      stage: 'evaluating',
      motion: 'checking',
      text: 'Scoring the change on the check tasks',
    });
    expect(view({ status: 'testing', phase: 'testing' })).toMatchObject({
      stage: 'testing',
      motion: 'testing',
      text: 'Final test, Spark disconnected',
    });
    expect(view({ phase: 'baseline' }).text).toBe(
      'Scoring Glimmer on the check tasks before any teaching',
    );
  });

  it('holds the motion while paused and stills it once the run ends', () => {
    expect(phaseView(makeRun({ status: 'paused', phase: 'diagnosing' }), NAMES)).toEqual({
      stage: 'diagnosing',
      motion: 'returning',
      frozen: true,
      text: 'Paused',
    });
    for (const status of ['finished', 'stopped', 'failed'] as const) {
      expect(phaseView(makeRun({ status, phase: 'done' }), NAMES)).toMatchObject({
        motion: 'still',
        frozen: true,
        stage: null,
      });
    }
  });

  it('says a run that asked a question waits for the person, rather than that it is paused', () => {
    const asking = makeRun({ status: 'paused', phase: 'clarifying' });
    expect(phaseView(asking, NAMES)).toMatchObject({
      frozen: true,
      text: 'Spark has a question for you',
    });
    // The moment after the answer, before the round moves on, it still reads as asking.
    expect(phaseView(makeRun({ status: 'running', phase: 'clarifying' }), NAMES).text).toBe(
      'Spark has a question for you',
    );
  });
});

function requirements(overrides: Partial<ReportCard['requirements']>): ReportCard {
  return {
    requirements: {
      passRate: { target: 0.9, actual: 0.92, met: true },
      ...overrides,
    },
  } as ReportCard;
}

describe('missedRequirements', () => {
  it('is empty only when every requirement is met', () => {
    expect(missedRequirements(requirements({}))).toEqual([]);
    expect(
      missedRequirements(requirements({ p95LatencyMs: { target: 8000, actual: 6100, met: true } })),
    ).toEqual([]);
  });

  it('names each missed requirement with the number it reached', () => {
    expect(
      missedRequirements(
        requirements({
          passRate: { target: 0.9, actual: 0.84, met: false },
          p95LatencyMs: { target: 8000, actual: 9100, met: false },
        }),
      ),
    ).toEqual([
      '84% right, and the job needs 90%',
      'its slowest answers took 9.1 s, and the job wants them under 8.0 s',
    ]);
  });

  it('says how many tasks a target needs on the test it reports', () => {
    const short = {
      ...requirements({ passRate: { target: 0.95, actual: 5 / 6, met: false } }),
      test: { score: { pass: 5, total: 6 } },
    } as ReportCard;
    expect(missedRequirements(short)).toEqual([
      '5 of 6 right, and the job needs 95%, which is all 6',
    ]);
    const long = {
      ...requirements({ passRate: { target: 0.95, actual: 55 / 60, met: false } }),
      test: { score: { pass: 55, total: 60 } },
    } as ReportCard;
    expect(missedRequirements(long)).toEqual([
      '55 of 60 right, and the job needs 95%, which is 57 of 60',
    ]);
  });
});
