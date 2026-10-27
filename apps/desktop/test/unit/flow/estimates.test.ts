import { describe, expect, it } from 'vitest';
import { mentorPreset } from '@architect/shared';
import {
  aboutUsd,
  capPhrase,
  estimateMentorUsd,
  estimateTime,
  formatAbout,
  formatAboutUsd,
  hostedAdvantage,
  mentorPresetOf,
  mentorUsdFor,
  roundsLine,
} from '../../../src/renderer/src/flow/define/estimates';
import { makeJob } from './factories';

describe('estimateTime', () => {
  it('times every round plus a final test that always runs on this computer', () => {
    // 4 rounds of 6 practice tasks and the 10 check tasks twice (the change and the current
    // harness), then 20 test tasks, with a generous time cap.
    const job = makeJob({
      budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 10_000 },
      splits: { seed: 1, calibration: 0, train: 30, dev: 10, test: 20 },
      evaluation: {
        trainBatch: 6,
        minDevGain: 2,
        maxTypeRegression: 1,
        devRepeats: 1,
        patience: 3,
      },
    });
    expect(estimateTime(job, 'local')).toEqual({
      seconds: (104 + 20) * 150,
      rounds: 4,
      roundSeconds: 26 * 150,
    });
    expect(estimateTime(job, 'hosted')).toEqual({
      seconds: 104 * 15 + 20 * 150,
      rounds: 4,
      roundSeconds: 26 * 15,
    });
  });

  it('runs the check tasks once per repeat', () => {
    const job = makeJob({
      budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 10_000 },
      splits: { seed: 1, calibration: 0, train: 30, dev: 10, test: 20 },
      evaluation: {
        trainBatch: 6,
        minDevGain: 2,
        maxTypeRegression: 1,
        devRepeats: 2,
        patience: 3,
      },
    });
    expect(estimateTime(job, 'local')).toEqual({
      seconds: (4 * 46 + 20) * 150,
      rounds: 4,
      roundSeconds: 46 * 150,
    });
  });

  it('stops training at the time cap and says how many rounds fit', () => {
    // The sample job: a round is 12 practice and 80 check tasks, 3.8 hours locally against a
    // 3-hour cap; a hosted copy fits 7 of the 12 rounds.
    const job = makeJob();
    const local = estimateTime(job, 'local');
    expect(local.seconds).toBe(180 * 60 + 60 * 150);
    expect(local.rounds).toBe(0);
    const hosted = estimateTime(job, 'hosted');
    expect(hosted.seconds).toBe(180 * 60 + 60 * 150);
    expect(hosted.rounds).toBe(7);
  });
});

describe('what the time cap allows', () => {
  it('names the cap the way people say it', () => {
    expect(capPhrase(180)).toBe('3-hour');
    expect(capPhrase(90)).toBe('90-minute');
    expect(capPhrase(45)).toBe('45-minute');
    expect(capPhrase(150)).toBe('2.5-hour');
  });

  it('says how many rounds fit, as a fact', () => {
    const job = makeJob();
    expect(roundsLine(job, estimateTime(job, 'local'))).toBe(
      'A round takes about 4 hours, longer than the 3-hour training cap',
    );
    expect(roundsLine(job, estimateTime(job, 'hosted'))).toBe(
      'The 3-hour training cap fits 7 of 12 rounds',
    );
    const roomy = makeJob({ budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 1200 } });
    expect(roundsLine(roomy, estimateTime(roomy, 'local'))).toBe(
      'All 4 rounds fit in the 20-hour training cap',
    );
  });

  it('says plainly when a hosted copy is faster', () => {
    const job = makeJob();
    const local = estimateTime(job, 'local');
    const hosted = estimateTime(job, 'hosted');
    expect(hostedAdvantage(job, local, hosted)).toBe('A hosted copy fits 7 rounds');
    const roomy = makeJob({ budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 1200 } });
    expect(
      hostedAdvantage(roomy, estimateTime(roomy, 'local'), estimateTime(roomy, 'hosted')),
    ).toBe('A hosted copy takes about 4 hours');
    expect(hostedAdvantage(job, hosted, hosted)).toBeNull();
  });
});

describe('formatAbout', () => {
  it('rounds to what a person would say', () => {
    expect(formatAbout(20)).toBe('Under a minute');
    expect(formatAbout(60)).toBe('About 5 minutes');
    expect(formatAbout(41 * 60)).toBe('About 40 minutes');
    expect(formatAbout(70 * 60)).toBe('About 1 hour');
    expect(formatAbout(3 * 3600 - 500)).toBe('About 3 hours');
    expect(formatAbout(5.1 * 3600)).toBe('About 5 hours');
    expect(formatAbout(60 * 3600)).toBe('About 3 days');
  });
});

describe('mentor spending', () => {
  it('finds the preset a mentor came from', () => {
    expect(mentorPresetOf(makeJob())?.key).toBe('meta-spark');
    const contributor = mentorPreset('meta-spark-contributor');
    const job = makeJob({
      mentor: {
        kind: 'model',
        provider: 'meta',
        label: contributor.label,
        baseUrl: contributor.baseUrl,
        model: contributor.model,
        reasoningEffort: 'medium',
        secretRef: 'meta',
      },
    });
    expect(mentorPresetOf(job)?.key).toBe('meta-spark-contributor');
  });

  it('prices every round of the budget at the preset rate', () => {
    // 30k input tokens at $1.25/M plus 5k output at $4.25/M is $0.05875 a round.
    expect(estimateMentorUsd(makeJob())).toBeCloseTo(12 * 0.05875, 6);
    expect(mentorUsdFor(mentorPreset('meta-spark').pricing, 8)).toBeCloseTo(8 * 0.05875, 6);
  });

  it('has no estimate when the price is unknown', () => {
    const job = makeJob({
      mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' },
    });
    expect(estimateMentorUsd(job)).toBeNull();
    const custom = makeJob({
      mentor: {
        kind: 'model',
        provider: 'other',
        label: 'My model',
        baseUrl: 'https://models.example.com/v1',
        model: 'my-model',
        reasoningEffort: 'medium',
        secretRef: 'other',
      },
    });
    expect(estimateMentorUsd(custom)).toBeNull();
  });

  it('formats an estimate without false precision', () => {
    expect(formatAboutUsd(0.04)).toBe('under $0.10');
    expect(formatAboutUsd(0.705)).toBe('$0.70');
    expect(formatAboutUsd(4.2)).toBe('$4');
    expect(formatAboutUsd(4.4)).toBe('$4.50');
    expect(formatAboutUsd(18.4)).toBe('$18');
    expect(aboutUsd(0.705)).toBe('About $0.70');
    expect(aboutUsd(0.04)).toBe('Under $0.10');
  });
});
