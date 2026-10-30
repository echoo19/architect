import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JobSchema } from '@architect/shared';
import { TooltipProvider } from '@architect/ui';
import { describe, expect, it } from 'vitest';
import {
  aboutUsd,
  estimateTime,
  expectedMentorUsd,
} from '../../../src/renderer/src/flow/define/estimates';
import { parseSeeds } from '../../../src/renderer/src/flow/define/EvaluationTab';
import { unitFor } from '../../../src/renderer/src/flow/define/fields';
import { tabOfField, tabWithIssue } from '../../../src/renderer/src/flow/define/inspector-tabs';
import { SpendingCap } from '../../../src/renderer/src/flow/define/TeacherTab';
import type { JobEditor } from '../../../src/renderer/src/flow/define/use-job-editor';
import { undone } from '../../../src/renderer/src/flow/define/use-undo';
import { validateJob } from '../../../src/renderer/src/flow/define/validate';
import { makeJob } from './factories';

describe("the Define inspector's tabs", () => {
  it('holds each field the engine checks in the tab that shows its control', () => {
    expect(tabOfField('mentor.pricing')).toBe('teacher');
    expect(tabOfField('student.local.contextLength')).toBe('student');
    expect(tabOfField('interventions')).toBe('teaching');
    expect(tabOfField('budget.maxRounds')).toBe('teaching');
    expect(tabOfField('evaluation.patience')).toBe('teaching');
    expect(tabOfField('startingHarness.path')).toBe('teaching');
    expect(tabOfField('evaluation.lockedTestSeeds')).toBe('evaluation');
    expect(tabOfField('splits.seed')).toBe('evaluation');
    expect(tabOfField('checker.path')).toBe('evaluation');
    expect(tabOfField('requirements.passRate')).toBe('evaluation');
    expect(tabOfField('budget.maxWallMinutes')).toBe('budget');
    expect(tabOfField('budget.maxComputeUsd')).toBe('budget');
  });

  it('sends Start training to the tab of the first problem', () => {
    const job = makeJob();
    const issues = validateJob({ ...job, budget: { ...job.budget, maxWallMinutes: 0 } }, 170);
    expect(tabWithIssue(issues)).toBe('budget');
    expect(tabWithIssue({})).toBeNull();
  });
});

describe("the final test's seeds", () => {
  it('reads whole numbers split by commas or spaces, and nothing as none', () => {
    expect(parseSeeds('11, 12 13')).toEqual([11, 12, 13]);
    expect(parseSeeds('')).toEqual([]);
    expect(parseSeeds('1, two')).toBeNull();
    expect(parseSeeds('-1')).toBeNull();
    expect(parseSeeds('1.5')).toBeNull();
  });

  it('holds them to what the engine takes: four at most, each once', () => {
    const job = makeJob();
    const seeds = (lockedTestSeeds: number[]) =>
      validateJob({ ...job, evaluation: { ...job.evaluation, lockedTestSeeds } }, 170)[
        'evaluation.lockedTestSeeds'
      ];
    expect(seeds([1, 2, 3, 4])).toBeUndefined();
    expect(seeds([1, 2, 3, 4, 5])).toBe('Use at most 4 seeds.');
    expect(seeds([7, 7])).toBe('Use each seed once.');
  });

  it('holds the compute cap to the range the engine takes', () => {
    const job = makeJob();
    const compute = (maxComputeUsd: number) =>
      validateJob({ ...job, budget: { ...job.budget, maxComputeUsd } }, 170)[
        'budget.maxComputeUsd'
      ];
    expect(compute(5)).toBeUndefined();
    expect(compute(2000)).toBe('Use an amount from $0 to $1,000.');
  });
});

describe('undo', () => {
  it('puts back only the settings the change touched, and keeps what changed since', () => {
    const before = makeJob();
    const after = { ...before, budget: { ...before.budget, maxMentorUsd: 9 } };
    const later = { ...after, requirements: { ...after.requirements, passRate: 0.8 } };
    const back = undone(later, before, after);
    expect(back.budget).toEqual(before.budget);
    expect(back.requirements.passRate).toBe(0.8);
    expect(JobSchema.safeParse(back).success).toBe(true);
  });

  it('takes away a setting the change added', () => {
    const before = makeJob();
    const after = { ...before, interventions: ['procedure' as const] };
    expect('interventions' in undone(after, before, after)).toBe(false);
  });
});

describe("the teacher's spending cap", () => {
  it("says the cap and what is expected of it, in the teacher's name", () => {
    const job = makeJob();
    const editor: JobEditor = {
      job,
      issues: {},
      saveStatus: 'saved',
      change: () => undefined,
      flush: () => Promise.resolve(job),
    };
    const html = renderToStaticMarkup(
      createElement(TooltipProvider, {
        children: createElement(SpendingCap, { editor, change: () => undefined }),
      }),
    );
    expect(html).toContain('Spark spending cap');
    const expected = expectedMentorUsd(job, estimateTime(job, job.student.trainOn)) ?? 0;
    expect(html).toContain(`${aboutUsd(expected)} expected`);
    expect(html).toContain(`aria-valuetext="$${job.budget.maxMentorUsd}"`);
  });
});

describe('units beside a value', () => {
  it('reads in the singular beside a 1', () => {
    expect(unitFor('tasks', 1)).toBe('task');
    expect(unitFor('times', 1)).toBe('time');
    expect(unitFor('tasks', 2)).toBe('tasks');
    expect(unitFor('%', 1)).toBe('%');
  });
});
