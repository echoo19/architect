import { describe, expect, it } from 'vitest';
import { mentorPreset } from '@architect/shared';
import {
  aboutSpan,
  aboutUsd,
  capText,
  comparisonCost,
  comparisonSeconds,
  estimateMentorUsd,
  estimateTime,
  finalTestSummary,
  formatAbout,
  formatAboutUsd,
  limitText,
  mentorPresetOf,
  mentorUsdFor,
  practiceUsd,
  typicalPracticeUsd,
  roundsLine,
  taskTimeText,
  tooSlow,
  trainingSummary,
} from '../../../src/renderer/src/flow/define/estimates';
import { makeJob } from './factories';

describe('estimateTime', () => {
  // 4 rounds of 6 practice tasks with 10 check tasks, a generous time cap and a 20-task test.
  const job = makeJob({
    budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 10_000 },
    splits: { seed: 1, calibration: 0, train: 30, dev: 10, test: 20 },
    evaluation: {
      trainBatch: 6,
      minDevGain: 2,
      maxTypeRegression: 1,
      devRepeats: 1,
      patience: 4,
    },
  });

  it('runs the check tasks two or four times a round, after a starting check', () => {
    // A round is 6 practice tasks and the 10 check tasks for the current version and the change,
    // and 20 more when a promising change is checked again. The test always runs on this computer.
    const local = { check: 10 * 150, short: (6 + 20) * 150, long: (6 + 40) * 150 };
    expect(estimateTime(job, 'local')).toEqual({
      startSeconds: local.check,
      trainingSeconds: { least: local.check + 4 * local.short, most: local.check + 4 * local.long },
      rounds: { fewest: 4, most: 4 },
      roundSeconds: { least: local.short, most: local.long },
    });
    const hosted = { check: 10 * 15, short: (6 + 20) * 15, long: (6 + 40) * 15 };
    expect(estimateTime(job, 'hosted')).toEqual({
      startSeconds: hosted.check,
      trainingSeconds: {
        least: hosted.check + 4 * hosted.short,
        most: hosted.check + 4 * hosted.long,
      },
      rounds: { fewest: 4, most: 4 },
      roundSeconds: { least: hosted.short, most: hosted.long },
    });
  });

  it('runs the check tasks once per repeat', () => {
    const repeated = makeJob({ ...job, evaluation: { ...job.evaluation, devRepeats: 2 } });
    expect(estimateTime(repeated, 'local').roundSeconds).toEqual({
      least: (6 + 40) * 150,
      most: (6 + 80) * 150,
    });
  });

  it('stops training at the time cap and says how many rounds fit', () => {
    // The sample job: a round is 12 practice tasks and 80 or 160 check tasks, at least 3.8 hours
    // locally against a 3-hour cap; a hosted copy fits 3 to 7 of the 12 rounds. The final test
    // is not part of what the cap limits.
    const sample = makeJob();
    const local = estimateTime(sample, 'local');
    expect(local.trainingSeconds).toEqual({ least: 180 * 60, most: 180 * 60 });
    expect(local.rounds).toEqual({ fewest: 0, most: 0 });
    const hosted = estimateTime(sample, 'hosted');
    expect(hosted.trainingSeconds).toEqual({ least: 180 * 60, most: 180 * 60 });
    expect(hosted.rounds).toEqual({ fewest: 3, most: 7 });
  });
});

describe('what the time cap allows', () => {
  it('names the cap the way people say it', () => {
    expect(capText(180)).toBe('3 hours');
    expect(capText(60)).toBe('1 hour');
    expect(capText(90)).toBe('90 minutes');
    expect(capText(150)).toBe('2.5 hours');
    expect(capText(1)).toBe('1 minute');
  });

  it('names the cap as a limit', () => {
    expect(limitText(240)).toBe('4-hour');
    expect(limitText(60)).toBe('1-hour');
    expect(limitText(90)).toBe('90-minute');
    expect(limitText(150)).toBe('2.5-hour');
  });

  it('says how many rounds fit, as a fact with its range', () => {
    const job = makeJob();
    expect(roundsLine(job, estimateTime(job, 'local'))).toBe(
      'No full round fits in 3 hours of training: the starting check takes 1 h 40 min here, then a round at least 3 h 50 min',
    );
    expect(roundsLine(job, estimateTime(job, 'hosted'))).toBe(
      '3 to 7 of 12 rounds fit in 3 hours of training',
    );
    const roomy = makeJob({ budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 2000 } });
    expect(roundsLine(roomy, estimateTime(roomy, 'local'))).toBe(
      'All 4 rounds fit, in about 17 to 30 hours of training',
    );
    const tight = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 360 } });
    expect(roundsLine(tight, estimateTime(tight, 'local'))).toBe(
      'At most 1 of 12 rounds fits in 6 hours of training',
    );
  });
});

describe('what each part of a run takes', () => {
  const job = makeJob();

  it('says how long a task takes at each place', () => {
    expect(taskTimeText('local')).toBe('about 2.5 minutes');
    expect(taskTimeText('hosted')).toBe('about 15 seconds');
  });

  it('says why a place is too slow, and only then', () => {
    // The starting check is 40 tasks and a round at least 92, at 2.5 minutes each.
    expect(tooSlow(job, estimateTime(job, 'local'))).toBe(
      'Too slow: the first round would end after about 5 h 30 min, past the 3-hour limit. Raise the limit in Advanced settings to train here.',
    );
    expect(tooSlow(job, estimateTime(job, 'hosted'))).toBeNull();
  });

  it('keeps training apart from the final test', () => {
    expect(trainingSummary(job, estimateTime(job, 'local'), 'this computer')).toBe(
      'No full round fits in the 3-hour limit on this computer, so no change could be kept.',
    );
    // The limit binds: 3 to 7 of the 12 rounds fit, so the clock ends training.
    expect(trainingSummary(job, estimateTime(job, 'hosted'), 'OpenRouter')).toBe(
      'About 3 hours on OpenRouter. The 3-hour limit ends it after 3 to 7 rounds.',
    );
    const roomy = makeJob({ budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 600 } });
    expect(trainingSummary(roomy, estimateTime(roomy, 'hosted'), 'OpenRouter')).toBe(
      'About 1 to 2 hours on OpenRouter, within the 10-hour limit.',
    );
    // 60 tasks at 2.5 minutes each, on this computer whatever trained the agent.
    expect(finalTestSummary(job, 'this computer')).toBe(
      'About 2.5 hours on this computer, on 60 tasks it has never seen.',
    );
  });
});

describe('what the three simpler versions add', () => {
  const pricing = { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 };
  const hosted = makeJob({
    student: {
      label: 'Glimmer',
      local: {
        runtime: 'ollama',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'muse-glimmer:30b',
        contextLength: 16_384,
      },
      trainOn: 'hosted',
      hosted: {
        runtime: 'openai_compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'meta/muse-glimmer-30b',
        secretRef: 'openrouter',
        contextLength: 16_384,
      },
    },
  });

  it('adds three final tests and the time of one more training', () => {
    const estimate = estimateTime(hosted, 'hosted');
    // Three tests of 60 tasks at 2.5 minutes, and 3 hours of training that revises itself.
    expect(comparisonSeconds(hosted, estimate)).toBe(3 * 60 * 150 + 180 * 60);
    expect(formatAbout(comparisonSeconds(hosted, estimate))).toBe('About 11 hours');
  });

  it('bills the hosted practice to its host and one call to the mentor', () => {
    const estimate = estimateTime(hosted, 'hosted');
    const cost = comparisonCost(hosted, estimate, pricing);
    expect(cost.hostedUsd).toBeCloseTo(practiceUsd(pricing, estimate), 6);
    expect(cost.mentorUsd).toBeCloseTo(mentorUsdFor(mentorPreset('meta-spark').pricing, 1), 6);
  });

  it('bills the host nothing when training stays on this computer, or has no price', () => {
    const local = makeJob();
    expect(comparisonCost(local, estimateTime(local, 'local'), pricing).hostedUsd).toBeNull();
    expect(comparisonCost(hosted, estimateTime(hosted, 'hosted'), null).hostedUsd).toBeNull();
    const codingAgent = makeJob({
      mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' },
    });
    expect(
      comparisonCost(codingAgent, estimateTime(codingAgent, 'local'), null).mentorUsd,
    ).toBeNull();
  });
});

describe('typicalPracticeUsd', () => {
  it('prices four hours of hosted practice before there is a job', () => {
    const pricing = { inputPerM: 0.3, cachedInputPerM: 0.04, outputPerM: 1.2 };
    expect(typicalPracticeUsd(pricing)).toBeCloseTo(960 * 0.00318, 6);
  });
});

describe('practiceUsd', () => {
  it('prices the practice tasks that fit in the training time at the host’s rate', () => {
    // 3 hours at 15 seconds a task is 720 tasks of 9,000 tokens in and 400 out.
    const pricing = { inputPerM: 0.35, cachedInputPerM: 0.04, outputPerM: 1.5 };
    expect(practiceUsd(pricing, estimateTime(makeJob(), 'hosted'))).toBeCloseTo(720 * 0.00375, 6);
  });
});

describe('aboutSpan', () => {
  it('says a span once when both ends round alike, else in the longer end’s unit', () => {
    expect(aboutSpan({ least: 3 * 3600, most: 3 * 3600 + 600 })).toBe('About 3 hours');
    expect(aboutSpan({ least: 20 * 60, most: 45 * 60 })).toBe('About 20 to 45 minutes');
    expect(aboutSpan({ least: 13_800, most: 25_800 })).toBe('About 4 to 7 hours');
    expect(aboutSpan({ least: 40 * 60, most: 2 * 3600 })).toBe('About 1 to 2 hours');
  });
});

describe('formatAbout', () => {
  it('rounds to what a person would say', () => {
    expect(formatAbout(20)).toBe('Under a minute');
    expect(formatAbout(60)).toBe('About 5 minutes');
    expect(formatAbout(41 * 60)).toBe('About 40 minutes');
    expect(formatAbout(70 * 60)).toBe('About 1 hour');
    expect(formatAbout(3 * 3600 - 500)).toBe('About 3 hours');
    expect(formatAbout(2.5 * 3600)).toBe('About 2.5 hours');
    expect(formatAbout(1.6 * 3600)).toBe('About 1.5 hours');
    expect(formatAbout(10.4 * 3600)).toBe('About 10 hours');
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
    expect(formatAboutUsd(0.04)).toBe('$0.04');
    expect(formatAboutUsd(0.004)).toBe('under $0.01');
    expect(formatAboutUsd(0.705)).toBe('$0.70');
    expect(formatAboutUsd(4.2)).toBe('$4');
    expect(formatAboutUsd(4.4)).toBe('$4.50');
    expect(formatAboutUsd(18.4)).toBe('$18');
    expect(aboutUsd(0.705)).toBe('About $0.70');
    expect(aboutUsd(0.048)).toBe('About $0.05');
    expect(aboutUsd(0.004)).toBe('Under $0.01');
  });
});
