import { describe, expect, it } from 'vitest';
import { mentorPreset } from '@architect/shared';
import {
  estimateMentorUsd,
  estimateTime,
  formatAbout,
  formatAboutUsd,
  mentorPresetOf,
} from '../../../src/renderer/src/flow/define/estimates';
import { makeJob } from './factories';

describe('estimateTime', () => {
  it('times every round plus a final test that always runs on this computer', () => {
    // 4 rounds of (6 practice + 10 check) tasks, then 20 test tasks, with a generous time cap.
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
    expect(estimateTime(job, 'local')).toEqual({ seconds: (64 + 20) * 150, rounds: 4 });
    expect(estimateTime(job, 'hosted')).toEqual({ seconds: 64 * 15 + 20 * 150, rounds: 4 });
  });

  it('stops training at the time cap and says how many rounds fit', () => {
    // The sample job: 12 rounds of 52 tasks would take 26 hours locally; the cap is 3 hours.
    const job = makeJob();
    const local = estimateTime(job, 'local');
    expect(local.seconds).toBe(180 * 60 + 60 * 150);
    expect(local.rounds).toBe(1);
    const hosted = estimateTime(job, 'hosted');
    expect(hosted.seconds).toBe(12 * 52 * 15 + 60 * 150);
    expect(hosted.rounds).toBe(12);
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
  });
});
