import type {
  Experiment,
  ExperimentDisposition,
  GateResult,
  InterventionType,
  Job,
  Lesson,
  Measurement,
  RunStopReason,
} from '@architect/shared';
import {
  Ban,
  BookOpenText,
  BrainCircuit,
  Check,
  CircleSlash,
  FilePen,
  ListChecks,
  MessageCircleQuestion,
  OctagonPause,
  Undo2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/*
 * The words and icons the evidence screens use for mentoring records, in one place, so a
 * round, an example and the report name each thing the same way.
 */

export interface Named {
  label: string;
  icon: LucideIcon;
}

/** The bounded menu of interventions (spec section 7), each with its icon. */
export const INTERVENTIONS: Record<InterventionType, Named> = {
  procedure: { label: 'Procedure', icon: ListChecks },
  retrieval: { label: 'Retrieval', icon: BookOpenText },
  helper: { label: 'Helper', icon: Wrench },
  weights: { label: 'Trained weights', icon: BrainCircuit },
  clarification: { label: 'Question', icon: MessageCircleQuestion },
};

/** A blank start's first round: the mentor's whole first setup. */
export const FIRST_DRAFT: Named = { label: 'First draft', icon: FilePen };

export const DISPOSITIONS: Record<ExperimentDisposition, Named & { tone: string }> = {
  kept: { label: 'Kept', icon: Check, tone: 'text-student' },
  reverted: { label: 'Reverted', icon: Undo2, tone: 'text-fg-muted' },
  rejected: { label: 'Rejected', icon: Ban, tone: 'text-danger' },
  invalid: { label: 'Invalid', icon: CircleSlash, tone: 'text-fg-muted' },
  stopped: { label: 'Stopped', icon: OctagonPause, tone: 'text-fg-muted' },
};

/** How an example's right answer was obtained, in a few words. */
export function lessonOrigin(lesson: Lesson): string {
  switch (lesson.kind) {
    case 'replay_correction':
      return `Replayed from step ${lesson.checkpoint?.turn ?? 1}`;
    case 'full_task_demonstration':
      return 'Full-task demonstration';
    case 'practice':
      return 'Related practice';
    case 'user_correction':
      return 'Your correction';
  }
}

/** "Verified" or "Rejected". */
export function lessonStatus(lesson: Lesson): string {
  return lesson.status === 'verified' ? 'Verified' : 'Rejected';
}

/** The task an example came from: the failed attempt's task, or the practice task. */
export function lessonTaskId(lesson: Lesson): string | null {
  return lesson.source.kind === 'correction' ? null : lesson.source.taskId;
}

/** Why training ended, as it happened, for the line after the last round. */
export function trainingEnd(reason: RunStopReason, job: Job): string {
  switch (reason) {
    case 'target_met':
      return 'Reached the target';
    case 'rounds':
      return `Used all ${job.budget.maxRounds} rounds`;
    case 'usd':
      return "Spark's budget ran out";
    case 'wall_clock':
      return 'The time limit ran out';
    case 'patience':
      return `No gain in ${job.evaluation.patience} rounds in a row`;
    case 'rejected':
      return "Two replies in a row couldn't be used";
    case 'leak':
      return 'A request would have shown final-test content';
    case 'user':
      return 'Stopped by you';
    case 'error':
      return 'Stopped on an error';
    case 'contract':
      return 'Your answer changed what counts as success';
  }
}

/** What each measured configuration is, for a column over its numbers. */
const MEASUREMENT_LABELS: Record<string, string> = {
  incumbent: 'Before',
  candidate: 'After',
  'H0/A0': 'Untouched',
  'H1/A0': 'Setup only',
  'H0/A1': 'Weights only',
  'H1/A1': 'Both',
};

export function measurementLabel(measurement: Pick<Measurement, 'label'>): string {
  return MEASUREMENT_LABELS[measurement.label] ?? measurement.label;
}

/** The measurements in the order a table reads them: before, then after, then the rest. */
export function orderedMeasurements(experiment: Experiment): Measurement[] {
  const order = Object.keys(MEASUREMENT_LABELS);
  const rank = (label: string) => {
    const at = order.indexOf(label);
    return at < 0 ? order.length : at;
  };
  return [...experiment.measurements].sort((a, b) => rank(a.label) - rank(b.label));
}

/** What each hard gate looks at. */
export const GATES: Record<GateResult['gate'], string> = {
  permission: 'Writes',
  device: 'Answer time',
  stand_in: 'Trained weights',
};

/** A sentence from the engine, ended as a sentence. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  const capital = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
