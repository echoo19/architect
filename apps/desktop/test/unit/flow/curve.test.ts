import { describe, expect, it } from 'vitest';
import {
  curveData,
  describeCurve,
  type CurveInput,
} from '../../../src/renderer/src/flow/train/curve';
import { decided, makeRound } from './factories';

/** The design's run: 40% at the start, round 2 reverted, round 4 still running. */
const RUN: CurveInput = {
  baseline: { pass: 16, total: 40 },
  rounds: [
    decided(1, 16, 23),
    decided(2, 23, 22),
    decided(3, 23, 31),
    makeRound(4, { status: 'evaluating', train: { pass: 9, total: 12 } }),
  ],
  target: 0.9,
  maxRounds: 12,
};

describe('curveData', () => {
  it('runs the axis to the round budget, marking the rounds reached', () => {
    const { span, ticks } = curveData(RUN);
    expect(span).toBe(12);
    expect(ticks.map((tick) => tick.round)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(ticks.filter((tick) => tick.reached).map((tick) => tick.round)).toEqual([0, 1, 2, 3, 4]);
  });

  it('never spans more rounds than the budget allows, nor fewer than the run took', () => {
    expect(curveData({ ...RUN, rounds: [], maxRounds: 2 }).span).toBe(2);
    expect(curveData({ ...RUN, maxRounds: 2 }).span).toBe(4);
  });

  it('draws a long budget only as far as twenty rounds, or as the run has gone past them', () => {
    expect(curveData({ ...RUN, maxRounds: 60 }).span).toBe(20);
    const rounds = Array.from({ length: 25 }, (_, index) => decided(index + 1, 20, 20));
    expect(curveData({ ...RUN, rounds, maxRounds: 60 }).span).toBe(25);
  });

  it('draws kept rounds on the line and holds it flat through a reverted one', () => {
    const { line, kept, head } = curveData(RUN);
    expect(line.map((point) => point.value)).toEqual([40, 57.5, 57.5, 77.5]);
    expect(kept.map((point) => point.round)).toEqual([0, 1, 3]);
    expect(head).toEqual({ round: 3, value: 77.5 });
  });

  it('branches a reverted round from the kept score to what it measured', () => {
    expect(curveData(RUN).branches).toEqual([{ round: 2, from: 57.5, to: 55 }]);
  });

  it("puts each round's practice score at the round it ran in, skipping a draft's", () => {
    const { practice } = curveData({
      ...RUN,
      rounds: [makeRound(1, { train: { pass: 0, total: 0 } }), ...RUN.rounds.slice(1)],
    });
    expect(practice).toEqual([
      { round: 2, value: 58.333333333333336 },
      { round: 3, value: 58.333333333333336 },
      { round: 4, value: 75 },
    ]);
  });

  it('fits the scores, practice and target in the range, labelled at round values', () => {
    const { range, valueTicks, target } = curveData(RUN);
    expect(target).toBe(90);
    expect(range).toEqual([30, 100]);
    expect(valueTicks).toEqual([40, 60, 80, 100]);
  });

  it('keeps small changes small by never zooming in past 40 points', () => {
    const { range, valueTicks } = curveData({
      ...RUN,
      baseline: { pass: 36, total: 40 },
      rounds: [{ ...decided(1, 36, 38), train: { pass: 11, total: 12 } }],
      target: 0.92,
    });
    expect(range).toEqual([60, 100]);
    expect(valueTicks).toEqual([60, 70, 80, 90, 100]);
  });

  it('draws only the axis and target before the baseline is measured', () => {
    const data = curveData({ ...RUN, baseline: null, rounds: [] });
    expect(data.line).toEqual([]);
    expect(data.head).toBeNull();
    expect(data.pending).toBeNull();
    expect(data.ticks.filter((tick) => tick.reached).map((tick) => tick.round)).toEqual([0]);
  });

  it('marks the round in progress until it is measured', () => {
    expect(curveData(RUN).pending).toBe(4);
    expect(curveData({ ...RUN, rounds: RUN.rounds.slice(0, 3) }).pending).toBeNull();
  });

  it('holds the line flat through a failed round', () => {
    const { line } = curveData({
      ...RUN,
      rounds: [decided(1, 16, 23), makeRound(2, { status: 'failed', error: 'Mentor timed out' })],
    });
    expect(line.map((point) => point.value)).toEqual([40, 57.5, 57.5]);
  });

  it('marks the score where it was last measured, not where the flat line ends', () => {
    const { line, head } = curveData({
      ...RUN,
      rounds: [
        decided(1, 16, 23),
        decided(2, 23, 22),
        makeRound(3, { status: 'failed', error: 'Stopped before this change was evaluated.' }),
      ],
    });
    expect(line).toHaveLength(4);
    expect(head).toEqual(line[1]);
  });
});

describe('describeCurve', () => {
  it('reads the chart out round by round, with the practice line', () => {
    expect(describeCurve(RUN)).toBe(
      'Score on the check tasks by round: 40% at the start, 58% after round 1, round 2 undone at 55%, ' +
        '78% after round 3, round 4 in progress. Target 90%. Practice tasks right: 58% in round 1, ' +
        '58% in round 2, 58% in round 3, 75% in round 4.',
    );
  });

  it('says when nothing is measured yet', () => {
    expect(describeCurve({ ...RUN, baseline: null, rounds: [] })).toBe(
      'Score on the check tasks by round: nothing measured yet. Target 90%.',
    );
  });
});
