import { describe, expect, it } from 'vitest';
import { mentorPreset } from '@architect/shared';
import {
  aboutSpan,
  aboutUsd,
  allowingLine,
  capText,
  comparisonCost,
  comparisonSeconds,
  estimateMentorUsd,
  estimateTime,
  expectedMentorUsd,
  fittingRounds,
  formatAbout,
  formatAboutUsd,
  limitText,
  mentorPresetOf,
  minutesForOneRound,
  mentorPriceOf,
  mentorRounds,
  mentorUsdFor,
  placePhrase,
  planBills,
  planSeconds,
  practiceUsd,
  roughUsd,
  shownTotalUsd,
  typicalPracticeUsd,
  roundsLine,
  shortDuration,
  shortSpan,
  taskTimeText,
  testSeconds,
  testUsd,
  tooSlow,
  trainsTooSlow,
  wontTeachBody,
  wontTeachTitle,
  type Bills,
} from '../../../src/renderer/src/flow/define/estimates';
import { makeJob } from './factories';

/** Both bills added up, or null when neither has a price. */
function sumOf(bills: Bills): number | null {
  if (bills.hostedUsd === null && bills.testUsd === null && bills.mentorUsd === null) return null;
  return (bills.hostedUsd ?? 0) + (bills.testUsd ?? 0) + (bills.mentorUsd ?? 0);
}

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
      'No full round fits in 3 hours of training: the starting measurement takes 1 h 40 min here, then a round at least 3 h 50 min',
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
    expect(tooSlow(job, estimateTime(job, 'local'))).toBe('Too slow for the 3-hour limit');
    expect(tooSlow(job, estimateTime(job, 'hosted'))).toBeNull();
  });

  it('knows when the place a job trains at cannot fit a round, and only that place', () => {
    // 3 hours: this computer can't fit one, the online copy fits a few.
    expect(trainsTooSlow(makeJob())).toBe(true);
    const online = makeJob({ student: { ...job.student, trainOn: 'hosted' } });
    expect(trainsTooSlow(online)).toBe(false);
    const roomy = makeJob({ budget: { maxRounds: 4, maxMentorUsd: 5, maxWallMinutes: 2000 } });
    expect(trainsTooSlow(roomy)).toBe(false);
    // One round that fits is enough to teach: the warning is for a place where none does.
    const tight = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 360 } });
    expect(trainsTooSlow(tight)).toBe(false);
  });

  it('offers the limit, in whole hours, that is sure to fit one round', () => {
    // 40 check tasks once, then a round of at most 172 tasks, at 2.5 minutes each: 8 h 50 min.
    expect(minutesForOneRound(job, 'local')).toBe(540);
    const nine = makeJob({ budget: { ...job.budget, maxWallMinutes: 540 } });
    expect(estimateTime(nine, 'local').rounds.fewest).toBe(1);
    expect(trainsTooSlow(nine)).toBe(false);
    // Online, 15 seconds a task: 53 minutes, so an hour.
    expect(minutesForOneRound(job, 'hosted')).toBe(60);
    // 2,000 check tasks on this computer: not even a week.
    expect(
      minutesForOneRound(makeJob({ splits: { ...job.splits, dev: 2000 } }), 'local'),
    ).toBeNull();
  });

  it('says what the time button gives, in the limit that button sets', () => {
    // The button's limit and the line beside it are found from the same number.
    expect(allowingLine(540)).toBe('Allowing 9 hours leaves room for one round.');
    expect(allowingLine(60)).toBe('Allowing 1 hour leaves room for one round.');
    expect(allowingLine(150)).toBe('Allowing 2.5 hours leaves room for one round.');
    for (const place of ['local', 'hosted'] as const) {
      const minutes = minutesForOneRound(job, place);
      if (minutes === null) throw new Error('A round fits in a week.');
      const allowed = makeJob({ budget: { ...job.budget, maxWallMinutes: minutes } });
      // What the line says is true: one round fits, even when its change is measured again.
      expect(estimateTime(allowed, place).rounds.fewest).toBeGreaterThanOrEqual(1);
      expect(allowingLine(minutes)).toBe(`Allowing ${capText(minutes)} leaves room for one round.`);
    }
  });

  it('says where a place is, in the middle of a sentence', () => {
    expect(placePhrase('local', 'this computer')).toBe('on this computer');
    expect(placePhrase('local', 'this Mac')).toBe('on this Mac');
    expect(placePhrase('hosted', 'this computer')).toBe('online');
  });

  it('says in plain words that not one round of teaching fits in a place, and why', () => {
    const names = { mentor: 'Spark', student: 'Glimmer' };
    const local = estimateTime(job, 'local');
    expect(wontTeachTitle(job, 'local', 'this computer')).toBe(
      'Not even one round of teaching fits in 3 hours on this computer',
    );
    expect(wontTeachTitle(job, 'hosted', 'this computer')).toBe(
      'Not even one round of teaching fits in 3 hours online',
    );
    expect(wontTeachTitle(job, 'local', 'this Mac')).toBe(
      'Not even one round of teaching fits in 3 hours on this Mac',
    );
    expect(wontTeachBody(job, 'local', local, names)).toBe(
      "Glimmer takes about 2.5 minutes a task here: about 1 h 40 min to score the check tasks once, and at least 3 h 50 min more for each round of practice and fixing. That doesn't fit in the 3 hours allowed, so Spark would run out of time before it changed anything.",
    );
    // Online, with a limit that leaves room to score the check tasks and not for a round after it.
    const short = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 20 } });
    expect(trainsTooSlow({ ...short, student: { ...short.student, trainOn: 'hosted' } })).toBe(
      true,
    );
    expect(wontTeachBody(short, 'hosted', estimateTime(short, 'hosted'), names)).toBe(
      "Glimmer takes about 15 seconds a task online: about 10 min to score the check tasks once, and at least 23 min more for each round of practice and fixing. That doesn't fit in the 20 minutes allowed, so Spark would run out of time before it changed anything.",
    );
  });

  it('says the check tasks alone are too long when they are', () => {
    const names = { mentor: 'Spark', student: 'Glimmer' };
    const hour = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 60 } });
    expect(wontTeachBody(hour, 'local', estimateTime(hour, 'local'), names)).toBe(
      "Glimmer takes about 2.5 minutes a task here, so scoring the check tasks once takes about 1 h 40 min. That doesn't fit in the 1 hour allowed, so Spark would never get to teach.",
    );
  });

  it("keeps the engine's words and the host's out of what it says", () => {
    const names = { mentor: 'Spark', student: 'Glimmer' };
    const words = [
      wontTeachTitle(job, 'local', 'this computer'),
      wontTeachBody(job, 'local', estimateTime(job, 'local'), names),
    ].join(' ');
    expect(words).not.toMatch(/mentor|student|host|adapter/i);
  });

  it('counts the rounds that fit beside the training time', () => {
    // The limit binds: 3 to 7 of the 12 rounds fit, so the clock ends training.
    expect(fittingRounds(job, estimateTime(job, 'hosted'))).toBe('3 to 7 rounds');
    const roomy = makeJob({ budget: { maxRounds: 2, maxMentorUsd: 5, maxWallMinutes: 600 } });
    expect(fittingRounds(roomy, estimateTime(roomy, 'hosted'))).toBe('All 2 rounds');
    const tight = makeJob({ budget: { maxRounds: 12, maxMentorUsd: 5, maxWallMinutes: 360 } });
    expect(fittingRounds(tight, estimateTime(tight, 'local'))).toBe('At most 1 round');
  });
});

describe('what the three simpler versions add', () => {
  it('adds three final tests and the time of one more training', () => {
    const estimate = estimateTime(hosted, 'hosted');
    // Three tests of 60 tasks at 2.5 minutes, and 3 hours of training that revises itself.
    expect(comparisonSeconds(hosted, estimate)).toBe(3 * 60 * 150 + 180 * 60);
    expect(formatAbout(comparisonSeconds(hosted, estimate))).toBe('About 10.5 hours');
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

describe('the plan in all', () => {
  const local = makeJob();
  const codingAgent = makeJob({
    mentor: { kind: 'coding_agent', agent: 'claude_code', label: 'Claude Code' },
  });
  const spark = mentorPreset('meta-spark').pricing;

  it('counts the mentor for the rounds that fit in the limit', () => {
    // 3 to 7 of 12 rounds fit on a hosted copy; none fits here, which counts them all.
    expect(mentorRounds(hosted, estimateTime(hosted, 'hosted'))).toBe(7);
    expect(mentorRounds(local, estimateTime(local, 'local'))).toBe(12);
    expect(expectedMentorUsd(hosted, estimateTime(hosted, 'hosted'))).toBeCloseTo(
      mentorUsdFor(spark, 7),
      6,
    );
    expect(expectedMentorUsd(local, estimateTime(local, 'local'))).toBeCloseTo(
      mentorUsdFor(spark, 12),
      6,
    );
    expect(expectedMentorUsd(codingAgent, estimateTime(codingAgent, 'local'))).toBeNull();
  });

  it('adds training and the final test, and the comparison when asked for', () => {
    const estimate = estimateTime(hosted, 'hosted');
    // 3 hours of training and a 2.5-hour final test; the comparison adds 10.5 hours.
    expect(planSeconds(hosted, estimate, false)).toEqual({ least: 19_800, most: 19_800 });
    expect(planSeconds(hosted, estimate, true)).toEqual({ least: 57_600, most: 57_600 });
    expect(aboutSpan(planSeconds(hosted, estimate, true))).toBe('About 16 hours');
  });

  it('adds the host’s bill and the mentor’s expected cost, the comparison’s share apart', () => {
    const estimate = estimateTime(hosted, 'hosted');
    const { total, comparison } = planBills(hosted, estimate, pricing, false);
    expect(sumOf(total)).toBeCloseTo(practiceUsd(pricing, estimate) + mentorUsdFor(spark, 7), 6);
    expect(sumOf(comparison)).toBeCloseTo(
      practiceUsd(pricing, estimate) + mentorUsdFor(spark, 1),
      6,
    );
  });

  it('leaves out what has no price', () => {
    // Training here costs the host nothing, so only the mentor is left.
    const here = planBills(local, estimateTime(local, 'local'), pricing, false);
    expect(here.total.hostedUsd).toBeNull();
    expect(sumOf(here.total)).toBeCloseTo(mentorUsdFor(spark, 12), 6);
    expect(sumOf(here.comparison)).toBeCloseTo(mentorUsdFor(spark, 1), 6);
    const unpriced = planBills(codingAgent, estimateTime(codingAgent, 'local'), null, false);
    expect(sumOf(unpriced.total)).toBeNull();
    expect(sumOf(unpriced.comparison)).toBeNull();
  });

  it('totals the bills as they are shown, so the figures add up', () => {
    // $3.04 shows as $3 and $0.5875 as $0.60, so the total shows $3.60, not $3.50.
    expect(roughUsd(3.04)).toBe(3);
    expect(roughUsd(0.5875)).toBeCloseTo(0.6, 6);
    const bills = (hostedUsd: number | null, testUsd: number | null, mentorUsd: number | null) => ({
      hostedUsd,
      testUsd,
      mentorUsd,
    });
    expect(shownTotalUsd(bills(3.04, null, 0.5875))).toBeCloseTo(3.6, 6);
    expect(shownTotalUsd(bills(null, null, 0.004))).toBe(0);
    expect(shownTotalUsd(bills(null, null, null))).toBeNull();
    // The online final test is a line of its own, rounded like the others: $0.19 shows as $0.20.
    expect(shownTotalUsd(bills(3.04, 0.19, 0.5875))).toBeCloseTo(3.8, 6);
  });
});

describe('the final test on the online copy', () => {
  const estimate = estimateTime(hosted, 'hosted');
  const test = 60 * 0.00318;

  it('takes the time of the online copy instead of the time of this computer', () => {
    expect(testSeconds(hosted)).toBe(60 * 150);
    expect(testSeconds(hosted, 'local')).toBe(60 * 150);
    expect(testSeconds(hosted, 'hosted')).toBe(60 * 15);
    // 3 hours of training, then 15 minutes where it was 2.5 hours.
    expect(planSeconds(hosted, estimate, false, 'hosted')).toEqual({ least: 11_700, most: 11_700 });
    expect(planSeconds(hosted, estimate, false, 'local')).toEqual({ least: 19_800, most: 19_800 });
  });

  it('shortens the comparison, whose three simpler versions are tested in the same place', () => {
    expect(comparisonSeconds(hosted, estimate, 'hosted')).toBe(3 * 60 * 15 + 180 * 60);
    expect(planSeconds(hosted, estimate, true, 'hosted')).toEqual({
      least: 11_700 + 3 * 900 + 10_800,
      most: 11_700 + 3 * 900 + 10_800,
    });
  });

  it('bills the host for the tasks of the final test, apart from the practice', () => {
    expect(testUsd(hosted, pricing)).toBeCloseTo(test, 6);
    const online = planBills(hosted, estimate, pricing, false, 'hosted');
    expect(online.total.testUsd).toBeCloseTo(test, 6);
    expect(online.total.hostedUsd).toBeCloseTo(practiceUsd(pricing, estimate), 6);
    expect(online.comparison.testUsd).toBeCloseTo(3 * test, 6);
    const withComparison = planBills(hosted, estimate, pricing, true, 'hosted');
    expect(withComparison.total.testUsd).toBeCloseTo(4 * test, 6);
  });

  it('bills the final test to the host even when the practice stays on this computer', () => {
    const local = makeJob({
      student: { ...hosted.student, trainOn: 'local' },
    });
    const bills = planBills(local, estimateTime(local, 'local'), pricing, false, 'hosted');
    expect(bills.total.hostedUsd).toBeNull();
    expect(bills.total.testUsd).toBeCloseTo(test, 6);
  });

  it('bills nothing for a final test on this computer, or on a copy with no price', () => {
    expect(planBills(hosted, estimate, pricing, false).total.testUsd).toBeNull();
    expect(planBills(hosted, estimate, pricing, false, 'local').total.testUsd).toBeNull();
    expect(planBills(hosted, estimate, null, false, 'hosted').total.testUsd).toBeNull();
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
    expect(formatAbout(10.4 * 3600)).toBe('About 10.5 hours');
    expect(formatAbout(11.5 * 3600)).toBe('About 11.5 hours');
    expect(formatAbout(36 * 3600)).toBe('About 2 days');
    expect(formatAbout(5.1 * 3600)).toBe('About 5 hours');
    expect(formatAbout(60 * 3600)).toBe('About 3 days');
  });
});

describe('shortDuration and shortSpan', () => {
  it('round the same way in a column of figures', () => {
    expect(shortDuration(20)).toBe('<1 min');
    expect(shortDuration(41 * 60)).toBe('40 min');
    expect(shortDuration(70 * 60)).toBe('1 h');
    expect(shortDuration(2.5 * 3600)).toBe('2.5 h');
    expect(shortDuration(11.5 * 3600)).toBe('11.5 h');
    expect(shortDuration(36 * 3600)).toBe('2 days');
  });

  it('say a span once when both ends round alike, else as a range', () => {
    expect(shortSpan({ least: 3 * 3600, most: 3 * 3600 + 600 })).toBe('3 h');
    expect(shortSpan({ least: 20 * 60, most: 45 * 60 })).toBe('20–45 min');
    expect(shortSpan({ least: 4 * 3600, most: 7 * 3600 })).toBe('4–7 h');
    expect(shortSpan({ least: 40 * 60, most: 2 * 3600 })).toBe('40 min to 2 h');
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

  it('prices a mentor at the price saved with it, and one on this computer at nothing', () => {
    const listed = { inputPerM: 2, cachedInputPerM: 0.2, outputPerM: 8 };
    const openRouter = makeJob({
      mentor: {
        kind: 'model',
        provider: 'openrouter',
        label: 'Some model',
        baseUrl: 'https://openrouter.ai/api/v1',
        model: 'maker/some-model',
        reasoningEffort: 'medium',
        secretRef: 'openrouter',
        pricing: listed,
      },
    });
    expect(mentorPriceOf(openRouter)).toEqual(listed);
    expect(estimateMentorUsd(openRouter)).toBeCloseTo(12 * mentorUsdFor(listed, 1), 6);
    const here = makeJob({
      mentor: {
        kind: 'model',
        provider: 'ollama',
        label: 'granite4.2:8b',
        baseUrl: 'http://127.0.0.1:11434',
        model: 'granite4.2:8b',
        reasoningEffort: 'medium',
      },
    });
    expect(estimateMentorUsd(here)).toBe(0);
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
