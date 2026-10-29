import type { SplitCounts, TaskPlan } from '@architect/shared';

/** "1 task", "120 tasks". */
export function tasksText(count: number): string {
  return `${count} ${count === 1 ? 'task' : 'tasks'}`;
}

/** Every task in the sets. */
export function totalOf(counts: SplitCounts): number {
  return counts.calibration + counts.train + counts.dev + counts.test;
}

/**
 * How many tasks sit in each set, in the words the screens use for them: "40 practice, 30 check,
 * 40 final test", and the ones kept aside to measure the model before any teaching last.
 */
export function splitsText(counts: SplitCounts): string {
  const parts = [
    `${counts.train} practice`,
    `${counts.dev} check`,
    `${counts.test} final test`,
    ...(counts.calibration > 0 ? [`${counts.calibration} set aside`] : []),
  ];
  return parts.join(', ');
}

/** Where the tasks came from, in a sentence; `mentor` is the teacher's short name. */
export function sourceText(source: TaskPlan['source'], mentor: string): string {
  switch (source) {
    case 'generated':
      return `Made by Architect from your files, following the job ${mentor} drafted.`;
    case 'attached':
      return 'From the tasks you attached.';
    case 'included':
      return 'These came with the job.';
  }
}

/** What the answers of generated tasks are checked against, said without overselling. */
export function checkedAgainst(mentor: string): string {
  return `Answers are checked against what ${mentor} drafted from your files, not independently certified as right for your business.`;
}
