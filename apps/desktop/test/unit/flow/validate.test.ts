import { describe, expect, it } from 'vitest';
import {
  issuesUnder,
  tasksSplit,
  validateJob,
} from '../../../src/renderer/src/flow/define/validate';
import { makeJob } from './factories';

describe('validateJob', () => {
  it('accepts the sample job', () => {
    expect(validateJob(makeJob(), 170)).toEqual({});
  });

  it('checks the splits against the tasks the job has', () => {
    const issues = validateJob(makeJob(), 150);
    expect(issues.splits).toBe('These add up to 170 tasks, but the job has 150.');
    expect(validateJob(makeJob(), null)).toEqual({});
  });

  it('holds a job with no tasks yet to nothing about its sets, which are used when tasks arrive', () => {
    expect(validateJob(makeJob(), 0)).toEqual({});
  });

  it('keeps the practice batch within the practice split', () => {
    const job = makeJob({
      evaluation: {
        trainBatch: 80,
        minDevGain: 2,
        maxTypeRegression: 1,
        devRepeats: 1,
        patience: 3,
      },
    });
    expect(validateJob(job, 170)['evaluation.trainBatch']).toBe(
      "A batch can't be larger than the 60 practice tasks.",
    );
  });

  it('explains out-of-range budgets and targets in plain words', () => {
    const job = {
      ...makeJob(),
      requirements: { passRate: 0 },
      budget: { maxRounds: 0, maxMentorUsd: -1, maxWallMinutes: 1.5 },
    };
    const issues = validateJob(job, null);
    expect(issues['requirements.passRate']).toBe('Pick a target between 1% and 100%.');
    expect(issues['budget.maxRounds']).toBe('Use a whole number of rounds from 1 to 100.');
    expect(issues['budget.maxMentorUsd']).toBe('Use an amount from $0 to $1,000.');
    expect(issues['budget.maxWallMinutes']).toBe(
      'Use whole minutes, from 1 up to a week (10,080).',
    );
  });

  it('needs the paths and choices that a kind of checker or harness depends on', () => {
    const job = {
      ...makeJob(),
      checker: { kind: 'module' as const, path: ' ' },
      startingHarness: { kind: 'import' as const, path: '' },
    };
    const issues = validateJob(job, null);
    expect(issues['checker.path']).toBe('Choose the checker file.');
    expect(issues['startingHarness.path']).toBe('Choose the agent folder.');
  });

  it('needs a hosted copy before training can run on one', () => {
    const job = makeJob();
    const hostedWithoutEndpoint = {
      ...job,
      student: { ...job.student, trainOn: 'hosted' as const },
    };
    expect(validateJob(hostedWithoutEndpoint, null)['student.hosted']).toBe(
      'Pick a hosted copy, or train on this computer.',
    );
  });

  it('needs a price for a mentor the app has none for', () => {
    const job = makeJob();
    const mentor = {
      kind: 'model' as const,
      provider: 'other' as const,
      label: 'My model',
      baseUrl: 'https://models.example.com/v1',
      model: 'my-model',
      reasoningEffort: 'medium' as const,
      secretRef: 'custom:models.example.com',
    };
    expect(validateJob({ ...job, mentor }, null)['mentor.pricing']).toBe(
      'Enter what this model costs, so training can keep to the spending cap.',
    );
    const pricing = { inputPerM: 1, cachedInputPerM: 1, outputPerM: 4 };
    expect(validateJob({ ...job, mentor: { ...mentor, pricing } }, null)).toEqual({});
    const here = { ...mentor, provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434' };
    const { secretRef: _none, ...keyless } = here;
    expect(validateJob({ ...job, mentor: keyless }, null)).toEqual({});
  });

  it('keeps the dev repeats between one and three', () => {
    const job = makeJob();
    for (const devRepeats of [0, 4, 1.5]) {
      const issues = validateJob({ ...job, evaluation: { ...job.evaluation, devRepeats } }, null);
      expect(issues['evaluation.devRepeats']).toBe('Use a whole number from 1 to 3.');
    }
    const three = validateJob({ ...job, evaluation: { ...job.evaluation, devRepeats: 3 } }, null);
    expect(three).toEqual({});
  });

  it('still reports contract problems the field checks do not cover', () => {
    const job = makeJob();
    const issues = validateJob({ ...job, name: '' }, null);
    expect(Object.keys(issues)).toEqual(['name']);
  });
});

describe('issuesUnder', () => {
  it('collects every issue in a group of fields', () => {
    const issues = { splits: 'Too many', 'splits.dev': 'Too few', 'budget.maxRounds': 'No' };
    expect(issuesUnder(issues, 'splits')).toEqual(['Too many', 'Too few']);
    expect(issuesUnder(issues, 'evaluation')).toEqual([]);
  });
});

describe('tasksSplit', () => {
  it('is true once the job has tasks, since they were split when they were added', () => {
    expect(tasksSplit(170)).toBe(true);
    expect(tasksSplit(1)).toBe(true);
  });

  it('is false for a job with no tasks yet', () => {
    expect(tasksSplit(0)).toBe(false);
  });

  it('counts a task count that is not known yet as split, so no change is offered that might do nothing', () => {
    expect(tasksSplit(null)).toBe(true);
  });
});
