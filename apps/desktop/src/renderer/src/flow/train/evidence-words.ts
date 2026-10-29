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
  CircleAlert,
  CircleSlash,
  Equal,
  FilePen,
  FileWarning,
  ListChecks,
  ListEnd,
  MessageCircleQuestion,
  OctagonPause,
  ShieldAlert,
  Square,
  Target,
  TimerOff,
  ToggleLeft,
  Undo2,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { modelNames } from '../names';

/*
 * The words and icons the evidence screens use for mentoring records, in one place, so a
 * round, an example and the report name each thing the same way.
 */

export interface Named {
  label: string;
  icon: LucideIcon;
}

/** The bounded menu of interventions (spec section 7), each with its icon and what it is. */
export const INTERVENTIONS: Record<InterventionType, Named & { meaning: string }> = {
  procedure: {
    label: 'Procedure',
    icon: ListChecks,
    meaning: 'a written rule the agent follows',
  },
  retrieval: {
    label: 'Retrieval',
    icon: BookOpenText,
    meaning: 'a reference the agent loads when a request needs it',
  },
  helper: { label: 'Helper', icon: Wrench, meaning: 'a small tool written for the agent' },
  weights: {
    label: 'Trained weights',
    icon: BrainCircuit,
    meaning: 'the model itself trained on worked examples',
  },
  clarification: {
    label: 'Question',
    icon: MessageCircleQuestion,
    meaning: 'a question put to you',
  },
};

/** A blank start's first round: the mentor's whole first setup. */
export const FIRST_DRAFT: Named = { label: 'First draft', icon: FilePen };

/**
 * How a round's change ended: five outcomes that are never run together, since the agent holds
 * only what was kept and the other four say why it doesn't. `label` fits a list; `headline` leads
 * the round's own view; `meaning` is for a tooltip.
 */
export const DISPOSITIONS: Record<
  ExperimentDisposition,
  Named & { headline: string; tone: string; meaning: string }
> = {
  kept: {
    label: 'Kept',
    headline: 'Kept',
    icon: Check,
    tone: 'text-student',
    meaning: 'It gained enough on the check tasks and broke no rule, so the agent keeps it.',
  },
  reverted: {
    label: 'No gain',
    headline: 'Undone, no gain',
    icon: Undo2,
    tone: 'text-fg-muted',
    meaning: "It didn't gain enough on the check tasks, so it was undone.",
  },
  rejected: {
    label: 'Made it worse',
    headline: 'Undone, made things worse',
    icon: Ban,
    tone: 'text-danger',
    meaning: 'It made the check tasks worse or broke a rule, so it was undone.',
  },
  invalid: {
    label: "Couldn't be tried",
    headline: "Couldn't be tried",
    icon: CircleSlash,
    tone: 'text-fg-muted',
    meaning: "It couldn't be tried in this run, so nothing changed.",
  },
  stopped: {
    label: 'Stopped',
    headline: 'Stopped',
    icon: OctagonPause,
    tone: 'text-fg-muted',
    meaning: 'Training ended before it was scored, so the agent never took it.',
  },
};

/** How an example's right answer was obtained, in a few words. */
export function lessonOrigin(lesson: Lesson): string {
  switch (lesson.kind) {
    case 'replay_correction':
      return `Replayed from step ${lesson.checkpoint?.turn ?? 1}`;
    case 'full_task_demonstration':
      return 'Full-task demonstration';
    case 'practice':
      return 'Practice on a similar task';
    case 'user_correction':
      return 'Your correction';
  }
}

/** Whether the checker passed an example: what makes it one the agent can learn from. */
export function lessonStatus(lesson: Lesson): string {
  return lesson.status === 'verified' ? 'Passed the checker' : 'Failed the checker';
}

/**
 * What the checker said of an example, the line that tells one apart from another: the verified
 * result, or what was wrong with a rejected one. The lesson's own reason when no check ran.
 */
export function lessonVerdict(lesson: Lesson): string {
  return lesson.check?.reason ?? lesson.reason;
}

/** The task an example came from: the failed attempt's task, or the practice task. */
export function lessonTaskId(lesson: Lesson): string | null {
  return lesson.source.kind === 'correction' ? null : lesson.source.taskId;
}

/** Each way training can end, with an icon of its own: a budget, the target, or a stop. */
export const TRAINING_END_ICONS: Record<RunStopReason, LucideIcon> = {
  target_met: Target,
  rounds: ListEnd,
  usd: Wallet,
  wall_clock: TimerOff,
  patience: Equal,
  rejected: Ban,
  leak: ShieldAlert,
  user: Square,
  error: CircleAlert,
  contract: FileWarning,
  nothing_to_try: ToggleLeft,
};

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
    case 'nothing_to_try':
      return `${modelNames(job).mentor} couldn't change anything`;
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

/**
 * The measurements on check tasks. A smoke check runs on practice tasks (decision 051), so it is
 * never read as one.
 */
export function checkMeasurements(experiment: Experiment): Measurement[] {
  return experiment.measurements.filter((item) => item.split !== 'train');
}

/** The check-task measurements in the order a table reads them: before, after, then the rest. */
export function orderedMeasurements(experiment: Experiment): Measurement[] {
  const order = Object.keys(MEASUREMENT_LABELS);
  const rank = (label: string) => {
    const at = order.indexOf(label);
    return at < 0 ? order.length : at;
  };
  return checkMeasurements(experiment).sort((a, b) => rank(a.label) - rank(b.label));
}

/** What each hard gate looks at. */
export const GATES: Record<GateResult['gate'], string> = {
  permission: 'Writes',
  device: 'Answer time',
  stand_in: 'Trained weights',
  smoke: 'Runs with the weights',
};

/** A sentence from the engine, ended as a sentence. */
export function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed === '') return trimmed;
  const capital = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}
