import { describe, expect, it } from 'vitest';
import {
  curveGeometry,
  describeCurve,
  PLOT,
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
    makeRound(4, { status: 'evaluating' }),
  ],
  target: 0.9,
  maxRounds: 12,
};

describe('curveGeometry', () => {
  it('spreads rounds 0 to the current one across the plot', () => {
    const { ticks } = curveGeometry(RUN);
    expect(ticks.map((tick) => tick.round)).toEqual([0, 1, 2, 3, 4]);
    expect(ticks.map((tick) => tick.x)).toEqual([52, 192, 332, 472, 612]);
    expect(ticks.every((tick) => tick.reached)).toBe(true);
  });

  it('keeps a short run spread over at least four rounds, dimming the ones not reached', () => {
    const { ticks, line } = curveGeometry({ ...RUN, rounds: [decided(1, 16, 23)] });
    expect(ticks.map((tick) => tick.round)).toEqual([0, 1, 2, 3, 4]);
    expect(ticks.filter((tick) => tick.reached).map((tick) => tick.round)).toEqual([0, 1]);
    expect(line.map((point) => point.x)).toEqual([52, 192]);
  });

  it('never spans more rounds than the budget allows when the run is short', () => {
    const { ticks } = curveGeometry({ ...RUN, rounds: [], maxRounds: 2 });
    expect(ticks.map((tick) => tick.round)).toEqual([0, 1, 2]);
  });

  it('draws kept rounds on the line and holds it flat through a reverted one', () => {
    const { line, head } = curveGeometry(RUN);
    expect(line.map((point) => point.value)).toEqual([40, 57.5, 57.5, 77.5]);
    expect(head).toEqual(line[3]);
  });

  it('branches a reverted round from the line to what it measured', () => {
    const { line, branches } = curveGeometry(RUN);
    expect(branches).toHaveLength(1);
    const [branch] = branches;
    expect(branch?.round).toBe(2);
    expect(branch?.from).toEqual(line[1]);
    expect(branch?.to.x).toBe(332);
    expect(branch?.to.value).toBe(55);
    expect(branch?.to.y).toBeGreaterThan(line[1]?.y ?? 0);
  });

  it('maps higher pass rates higher up and puts the target inside the plot', () => {
    const { line, targetY } = curveGeometry(RUN);
    const ys = line.map((point) => point.y);
    expect(ys[0]).toBeGreaterThan(ys[1] ?? 0);
    expect(targetY).toBeLessThan(ys[3] ?? 0);
    for (const y of [...ys, targetY]) {
      expect(y).toBeGreaterThanOrEqual(PLOT.top);
      expect(y).toBeLessThanOrEqual(PLOT.bottom);
    }
  });

  it('keeps small changes small by never zooming in past 40 points', () => {
    const flat = curveGeometry({
      ...RUN,
      baseline: { pass: 36, total: 40 },
      rounds: [decided(1, 36, 38)],
      target: 0.92,
    });
    const [start, end] = flat.line;
    const pointsPerPixel = 40 / (PLOT.bottom - PLOT.top);
    expect(((start?.y ?? 0) - (end?.y ?? 0)) * pointsPerPixel).toBeCloseTo(5, 5);
  });

  it('draws only the axis and target before the baseline is measured', () => {
    const geometry = curveGeometry({ ...RUN, baseline: null, rounds: [] });
    expect(geometry.line).toEqual([]);
    expect(geometry.head).toBeNull();
    expect(geometry.pending).toBeNull();
    expect(geometry.ticks.map((tick) => tick.reached)).toEqual([true, false, false, false, false]);
  });

  it('marks the round in progress level with the line, at its own round', () => {
    const { head, pending } = curveGeometry(RUN);
    expect(pending?.round).toBe(4);
    expect(pending?.from).toEqual(head);
    expect(pending?.to).toEqual({ x: 612, y: head?.y, value: head?.value });
    const settled = curveGeometry({ ...RUN, rounds: RUN.rounds.slice(0, 3) });
    expect(settled.pending).toBeNull();
  });

  it('labels the percentage axis at round values inside the plot', () => {
    const { valueTicks } = curveGeometry(RUN);
    expect(valueTicks.map((tick) => tick.value)).toEqual([40, 60, 80, 100]);
    for (const tick of valueTicks) {
      expect(tick.y).toBeGreaterThanOrEqual(PLOT.top);
      expect(tick.y).toBeLessThanOrEqual(PLOT.bottom);
    }
    const narrow = curveGeometry({
      ...RUN,
      baseline: { pass: 36, total: 40 },
      rounds: [decided(1, 36, 38)],
      target: 0.92,
    });
    expect(narrow.valueTicks.map((tick) => tick.value)).toEqual([60, 70, 80, 90, 100]);
  });

  it('labels only every few rounds on a long run, always including the last', () => {
    const rounds = Array.from({ length: 40 }, (_, index) => decided(index + 1, 20, 20));
    const { ticks } = curveGeometry({ ...RUN, rounds, maxRounds: 40 });
    const gaps = ticks.slice(1).map((tick, index) => tick.x - (ticks[index]?.x ?? 0));
    expect(ticks.at(-1)?.round).toBe(40);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(28);
  });

  it('holds the line flat through a failed round', () => {
    const { line } = curveGeometry({
      ...RUN,
      rounds: [decided(1, 16, 23), makeRound(2, { status: 'failed', error: 'Mentor timed out' })],
    });
    expect(line.map((point) => point.value)).toEqual([40, 57.5, 57.5]);
  });
});

describe('describeCurve', () => {
  it('reads the chart out round by round', () => {
    expect(describeCurve(RUN)).toBe(
      'Check tasks right by round: 40% at the start, 58% after round 1, round 2 reverted at 55%, ' +
        '78% after round 3, round 4 in progress. Target 90%.',
    );
  });

  it('says when nothing is measured yet', () => {
    expect(describeCurve({ ...RUN, baseline: null, rounds: [] })).toBe(
      'Check tasks right by round: nothing measured yet. Target 90%.',
    );
  });
});
