import type { ReportCard } from '@architect/shared';

/**
 * Where the final test's requests came from, said plainly, for a job whose tasks weren't shipped
 * with it (decision 058). Requests Architect made from the person's files are checked against the
 * job the teacher drafted, which nobody has certified as right for the business. Null for a job
 * whose tasks came with it, which has nothing to add. `mentor` is the teacher's short name.
 */
export function testSourceNote(tasks: ReportCard['tasks'], mentor: string): string | null {
  if (tasks === undefined) return null;
  if (tasks.source === 'attached') {
    return 'The final test is part of the tasks you attached. Its expected answers are the ones they came with.';
  }
  return `The final test's requests were made by Architect from your files, following a job ${mentor} drafted. Answers are checked against that job, not independently certified as right for your business.`;
}
