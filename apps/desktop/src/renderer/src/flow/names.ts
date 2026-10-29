import { INTERVENTION_LABELS, type InterventionType, type Job } from '@architect/shared';
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

/**
 * What a person calls a kind of change on a screen: the engine's name for it, except where that
 * leaves out whose model it is or reads as half a sentence. The engine's own sentences keep the
 * shared names, which sit in lists.
 */
export function kindLabel(type: InterventionType, student: string): string {
  if (type === 'retrieval') return 'What it reads, and when';
  if (type === 'weights') return `Retrain ${student} itself`;
  return INTERVENTION_LABELS[type];
}
