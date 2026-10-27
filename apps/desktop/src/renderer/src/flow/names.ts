import type { Job } from '@architect/shared';
import { shortModelName } from '../lib/names';
import type { ModelNames } from './train/phase';

/** The short names the flow uses for a job's mentor and student, e.g. "Spark" and "Glimmer". */
export function modelNames(job: Job): ModelNames {
  return { mentor: shortModelName(job.mentor.label), student: shortModelName(job.student.label) };
}

/** A task type's label from the job, e.g. `invoice` → "Invoices". */
export function typeLabel(job: Job, type: string): string {
  return job.taskTypes.find((info) => info.id === type)?.label ?? type;
}
