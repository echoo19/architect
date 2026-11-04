import { describe, expect, it } from 'vitest';
import type { WspBrief, WspIteration, WspMeasurement } from '@architect/shared';
import {
  devChange,
  examplesOf,
  inBrief,
  parseExamplesJsonl,
  pointsText,
  splitCounts,
  stageStates,
  VERDICT_WORDS,
} from '../../../src/renderer/src/wsp/model';
import { pointsDomain } from '../../../src/renderer/src/wsp/Results';
import { briefHeld } from '../../../src/renderer/src/wsp/BriefStep';
import { goalHeld } from '../../../src/renderer/src/wsp/NewExperiment';

function measured(patch: Partial<WspMeasurement>): WspMeasurement {
  return {
    arm: 'base',
    split: 'dev',
    n: 10,
    passed: 5,
    checked: 10,
    looped: 4,
    cutOff: 0,
    meanTokens: 120,
    seconds: 3,
    outcomes: [],
    ...patch,
  };
}

const iteration = (dev?: WspMeasurement): WspIteration => ({
  n: 1,
  hypothesis: 'h',
  expected: 'e',
  programSha256: 'a'.repeat(64),
  outcome: 'edit',
  output: '',
  mentorUsd: 0,
  startedAt: '2026-11-03T10:00:00.000Z',
  ...(dev ? { dev } : {}),
});

describe('WSP examples', () => {
  it('reads a JSONL file line by line, naming each line it leaves out', () => {
    const parsed = parseExamplesJsonl(
      [
        '{"prompt": "2+2?", "check": {"kind": "number", "value": "4"}}',
        '',
        '{"prompt": "Tell a story"}',
        'not json',
        '{"prompt": "x", "check": {"kind": "fuzzy", "value": "y"}}',
        '{"text": "no prompt"}',
      ].join('\r\n'),
    );
    expect(parsed.examples).toEqual([
      { prompt: '2+2?', check: { kind: 'number', value: '4' } },
      { prompt: 'Tell a story' },
    ]);
    expect(parsed.problems.map((problem) => problem.line)).toEqual([4, 5, 6]);
    expect(parsed.problems[0]?.reason).toBe('Not JSON');
    expect(parsed.problems[1]?.reason).toMatch(/^check\.kind/);
  });

  it('makes examples from the form, skipping empty rows and counting unfinished ones', () => {
    const { examples, incomplete } = examplesOf([
      { id: 1, prompt: ' Count to three ', kind: 'contains', value: '3' },
      { id: 2, prompt: '', kind: 'none', value: '' },
      { id: 3, prompt: 'Behavior only', kind: 'none', value: '' },
      { id: 4, prompt: 'No value', kind: 'exact', value: ' ' },
      { id: 5, prompt: '', kind: 'exact', value: 'orphan' },
    ]);
    expect(examples).toEqual([
      { prompt: 'Count to three', check: { kind: 'contains', value: '3' } },
      { prompt: 'Behavior only' },
    ]);
    expect(incomplete).toBe(2);
  });

  it('splits a quarter sealed, a quarter dev and the rest practice, from the minimum up', () => {
    expect(splitCounts(11)).toBeNull();
    expect(splitCounts(12)).toEqual({ practice: 6, dev: 3, qualification: 3 });
    expect(splitCounts(30)).toEqual({ practice: 16, dev: 7, qualification: 7 });
  });

  it('holds the goal until it is described and has enough finished examples', () => {
    const rows = Array.from({ length: 12 }, (_, id) => ({
      id,
      prompt: `p${id}`,
      kind: 'none' as const,
      value: '',
    }));
    expect(goalHeld({ task: ' ', constraints: '', rows })).toBe('Describe the goal');
    expect(goalHeld({ task: 'Stop looping', constraints: '', rows: rows.slice(1) })).toBe(
      'Add 1 more example',
    );
    expect(goalHeld({ task: 'Stop looping', constraints: '', rows })).toBeNull();
  });
});

describe('a WSP run', () => {
  it('marks the stages before the current one done, and all of them once qualified', () => {
    expect(stageStates('edit', 'running')).toEqual(['done', 'done', 'current', 'next', 'next']);
    expect(stageStates('results', 'evaluated')).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
    ]);
    expect(stageStates('results', 'qualified')).toEqual(['done', 'done', 'done', 'done', 'done']);
  });

  it('keeps a brief in the flow until it starts, and a failed draft with it', () => {
    expect(inBrief({ status: 'briefing', approval: null })).toBe(true);
    expect(inBrief({ status: 'brief', approval: null })).toBe(true);
    expect(inBrief({ status: 'failed', approval: null })).toBe(true);
    const approval = { briefSha256: 'b'.repeat(64), at: '2026-11-03T10:00:00.000Z' };
    expect(inBrief({ status: 'failed', approval })).toBe(false);
    expect(inBrief({ status: 'running', approval })).toBe(false);
  });

  it("measures a candidate's change on dev against the base, never from what wasn't measured", () => {
    const base = measured({});
    const candidate = measured({ arm: 'candidate', passed: 7, looped: 1 });
    expect(devChange(iteration(candidate), base, 'pass_rate')).toBeCloseTo(20);
    expect(devChange(iteration(candidate), base, 'loop_rate')).toBeCloseTo(-30);
    expect(devChange(iteration(), base, 'pass_rate')).toBeNull();
    expect(devChange(iteration(candidate), null, 'pass_rate')).toBeNull();
    expect(
      devChange(iteration(measured({ passed: null, checked: 0 })), base, 'pass_rate'),
    ).toBeNull();
  });

  it('says a change with its unit and its sign', () => {
    expect(pointsText(8)).toBe('+8 points');
    expect(pointsText(-4.26)).toBe('−4.3 points');
    expect(pointsText(1)).toBe('+1 point');
    expect(pointsText(0)).toBe('0 points');
  });

  it('names every verdict in a word or two', () => {
    expect(VERDICT_WORDS).toEqual({
      improved: 'Improved',
      'not-established': 'Not established',
      regressed: 'Regressed',
      'no-candidate': 'No candidate',
    });
  });

  it('draws comparisons on a scale even about zero, at a round ten past the widest', () => {
    const comparison = { against: 'base', metric: 'pass_rate', split: 'dev', n: 20 } as const;
    expect(pointsDomain([{ ...comparison, points: 3, low: -2, high: 8 }])).toEqual([-10, 10]);
    expect(pointsDomain([{ ...comparison, points: 12, low: -14, high: 31 }])).toEqual([-40, 40]);
  });

  it('holds a brief with a part left empty, naming the part', () => {
    const brief: WspBrief = {
      objective: 'Stop loops',
      baseline: 'Base loops on 4 of 10',
      investigation: 'Read the last layers',
      successCriteria: ['Loop rate falls'],
      regressionChecks: [],
      expectedOutput: 'A candidate',
      target: { metric: 'loop_rate', minPoints: 10 },
      controls: {
        decoding: { temperature: 0, topP: 1, repetitionPenalty: 1.1, maxNewTokens: 192 },
        instructions: null,
      },
    };
    expect(briefHeld({ ...brief }, 'Loops')).toBeNull();
    expect(briefHeld({ ...brief }, ' ')).toBe('Give it a title');
    expect(briefHeld({ ...brief, objective: '' }, 'Loops')).toBe('Fill in the objective');
    expect(briefHeld({ ...brief, successCriteria: ['ok', ' '] }, 'Loops')).toBe(
      'Fill in every success criterion',
    );
  });
});
