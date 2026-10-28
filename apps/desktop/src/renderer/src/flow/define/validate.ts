import { JobSchema, mentorPricing, type Job } from '@architect/shared';

/** A problem with one field, keyed by the field's dotted path (`splits.dev`). */
export type JobIssues = Record<string, string>;

function wholeNumber(value: number): boolean {
  return Number.isInteger(value);
}

function between(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Checks a job the way the engine will, with messages a person can act on. `taskCount` is the
 * number of tasks the job holds, when known, so the splits can be checked against it.
 */
export function validateJob(job: Job, taskCount: number | null): JobIssues {
  const issues: JobIssues = {};
  const add = (path: string, message: string) => {
    issues[path] ??= message;
  };

  const { requirements, budget, splits, evaluation, student, checker, startingHarness } = job;

  if (!(requirements.passRate > 0 && requirements.passRate <= 1)) {
    add('requirements.passRate', 'Pick a target between 1% and 100%.');
  }
  if (requirements.p95LatencyMs !== undefined && !(requirements.p95LatencyMs >= 1)) {
    add('requirements.p95LatencyMs', 'Use at least a millisecond, or turn the limit off.');
  }

  if (!wholeNumber(budget.maxRounds) || !between(budget.maxRounds, 1, 100)) {
    add('budget.maxRounds', 'Use a whole number of rounds from 1 to 100.');
  }
  if (!between(budget.maxMentorUsd, 0, 1000)) {
    add('budget.maxMentorUsd', 'Use an amount from $0 to $1,000.');
  }
  if (!wholeNumber(budget.maxWallMinutes) || !between(budget.maxWallMinutes, 1, 10_080)) {
    add('budget.maxWallMinutes', 'Use whole minutes, from 1 up to a week (10,080).');
  }

  const counts = { calibration: 0, train: 1, dev: 1, test: 1 } as const;
  for (const [name, min] of Object.entries(counts) as [keyof typeof counts, number][]) {
    const value = splits[name];
    if (!wholeNumber(value) || value < min) {
      add(`splits.${name}`, min === 0 ? 'Use a whole number.' : 'Use a whole number, at least 1.');
    }
  }
  if (!wholeNumber(splits.seed)) add('splits.seed', 'Use a whole number.');
  const used = splits.calibration + splits.train + splits.dev + splits.test;
  if (taskCount !== null && used > taskCount) {
    add('splits', `These add up to ${used} tasks, but the job has ${taskCount}.`);
  }

  if (!wholeNumber(evaluation.trainBatch) || evaluation.trainBatch < 1) {
    add('evaluation.trainBatch', 'Use a whole number, at least 1.');
  } else if (evaluation.trainBatch > splits.train) {
    add(
      'evaluation.trainBatch',
      `A batch can't be larger than the ${splits.train} practice tasks.`,
    );
  }
  if (!wholeNumber(evaluation.minDevGain) || evaluation.minDevGain < 1) {
    add('evaluation.minDevGain', 'Use a whole number, at least 1.');
  } else if (evaluation.minDevGain > splits.dev) {
    add('evaluation.minDevGain', `It can't be more than the ${splits.dev} check tasks.`);
  }
  if (!wholeNumber(evaluation.maxTypeRegression) || evaluation.maxTypeRegression < 0) {
    add('evaluation.maxTypeRegression', 'Use a whole number, 0 or more.');
  }
  if (!wholeNumber(evaluation.devRepeats) || !between(evaluation.devRepeats, 1, 3)) {
    add('evaluation.devRepeats', 'Use a whole number from 1 to 3.');
  }
  if (!wholeNumber(evaluation.patience) || evaluation.patience < 1) {
    add('evaluation.patience', 'Use a whole number, at least 1.');
  }

  if (!student.local.model.trim()) add('student.local.model', 'Name the model your agent runs on.');
  if (
    !wholeNumber(student.local.contextLength) ||
    !between(student.local.contextLength, 2048, 262_144)
  ) {
    add('student.local.contextLength', 'Use a context size from 2,048 to 262,144 tokens.');
  }
  if (student.trainOn === 'hosted' && !student.hosted) {
    add('student.hosted', 'Pick a hosted copy, or train on this computer.');
  }
  // The spending cap holds only at a known price (decision 034).
  if (job.mentor.kind === 'model' && !mentorPricing(job.mentor)) {
    add('mentor.pricing', 'Enter what this model costs, so training can keep to the spending cap.');
  }

  if (checker.kind === 'module' && !checker.path.trim()) {
    add('checker.path', 'Choose the checker file.');
  }
  if (startingHarness.kind === 'template' && !startingHarness.template.trim()) {
    add('startingHarness.template', 'Pick a template.');
  }
  if (startingHarness.kind === 'import' && !startingHarness.path.trim()) {
    add('startingHarness.path', 'Choose the agent folder.');
  }

  // Anything the field checks above don't cover still has to satisfy the contract.
  const parsed = JobSchema.safeParse(job);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path.map(String).join('.');
      if (!Object.keys(issues).some((key) => path === key || path.startsWith(`${key}.`))) {
        add(path || 'job', `This value isn't valid: ${issue.message}`);
      }
    }
  }
  return issues;
}

/** Issues for the fields that start with a prefix, such as every `splits.` field. */
export function issuesUnder(issues: JobIssues, prefix: string): string[] {
  return Object.entries(issues)
    .filter(([path]) => path === prefix || path.startsWith(`${prefix}.`))
    .map(([, message]) => message);
}
