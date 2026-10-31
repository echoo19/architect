import type { ArmCaps, RunStatus, RunStopReason } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import { roundsOf } from '../src/comparisons';
import { plainStrings, plainText } from '../src/comparisons/plain';
import type { StoredRun } from '../src/store/records';
import { comparisonOne } from './support/report-fixture';

/** A run with just the fields the rounds are read from. */
function run(status: RunStatus, stopReason: RunStopReason | undefined, rounds: number): StoredRun {
  return {
    run: { status, stopReason, totals: { rounds } },
  } as unknown as StoredRun;
}

const CAPS = (rounds: number | null): ArmCaps => ({
  sparkUsd: 5,
  studentUsd: 5,
  computeUsd: null,
  wallMinutes: 720,
  rounds,
});

describe("how an arm's rounds ended", () => {
  it.each<[RunStatus, RunStopReason | undefined, string]>([
    ['finished', 'rounds', 'cap reached'],
    ['finished', 'patience', 'patience ran out'],
    ['finished', 'usd', 'money ran out'],
    ['finished', 'wall_clock', 'time ran out'],
    ['finished', 'target_met', 'done, the check-task target was reached'],
    ['finished', undefined, 'done'],
    // Training is over while a locked test waits to be released.
    ['testing', 'rounds', 'cap reached'],
    ['testing', undefined, 'done'],
    ['stopped', undefined, 'stopped'],
    ['stopped', 'user', 'stopped'],
    ['finished', 'leak', 'stopped by the leak check'],
    ['finished', 'rejected', 'replies it could not use'],
    ['finished', 'contract', 'the job contract changed'],
    ['failed', undefined, 'stopped by an error'],
  ])('reads %s with %s as "%s"', (status, stopReason, ended) => {
    expect(roundsOf(run(status, stopReason, 2), CAPS(2))).toEqual({ used: 2, ended });
  });

  it('says nothing about why while training is still going', () => {
    for (const status of ['queued', 'running', 'paused', 'stopping'] as const) {
      expect(roundsOf(run(status, undefined, 1), CAPS(2))).toEqual({ used: 1, ended: null });
    }
  });

  it('has no rounds for an arm that has none', () => {
    expect(roundsOf(run('finished', undefined, 0), CAPS(null))).toBeNull();
    expect(roundsOf(null, CAPS(2))).toBeNull();
  });
});

// The marks a report must not carry, as code point escapes so that this file holds none of them.
const ARROW = '\u{2192}';
const EN_DASH = '\u{2013}';
const EM_DASH = '\u{2014}';
const SINGLES = '\u{2018}d\u{2019}';
const DOUBLES = '\u{201C}e\u{201D}';
const ELLIPSIS = '\u{2026}';
const NO_BREAK_SPACE = '\u{A0}';

describe('plain text', () => {
  it('writes an arrow as "to", with or without spaces around it', () => {
    expect(plainText(`Dev 30/45 ${ARROW} 35/45; 60/90${ARROW}73/90`)).toBe(
      'Dev 30/45 to 35/45; 60/90 to 73/90',
    );
  });

  it('writes dashes, quotes, the ellipsis and the no-break space as ASCII', () => {
    expect(
      plainText(
        `a ${EN_DASH} b ${EM_DASH} c ${SINGLES} ${DOUBLES} f${ELLIPSIS} g${NO_BREAK_SPACE}h`,
      ),
    ).toBe('a - b - c \'d\' "e" f... g h');
    expect(plainText('Fix pickup_next to parse legacy dates.')).toBe(
      'Fix pickup_next to parse legacy dates.',
    );
  });

  it('cleans every string in a report, however deep, and nothing else', () => {
    const report = comparisonOne();
    const experiment = report.arms[1]?.experiments[0];
    if (experiment === undefined) throw new Error('The fixture has a draft with a round.');
    experiment.reason = `Dev 30/45 ${ARROW} 35/45`;
    experiment.title = `Pickups ${DOUBLES} ${EM_DASH} never late`;
    const plain = plainStrings(report);
    expect(plain.arms[1]?.experiments[0]?.reason).toBe('Dev 30/45 to 35/45');
    expect(plain.arms[1]?.experiments[0]?.title).toBe('Pickups "e" - never late');
    expect(plain.arms[0]?.spent).toEqual(report.arms[0]?.spent);
    expect(plain.plan.testSeeds).toEqual([101, 102]);
    expect(plain.backends[0]?.rows[0]?.scenarios.wilson95).toEqual(
      report.backends[0]?.rows[0]?.scenarios.wilson95,
    );
    // The original is left as it was.
    expect(report.arms[1]?.experiments[0]?.reason).toContain(ARROW);
  });
});
