import type { Finding, ListedLesson, Trace } from '@architect/shared';
import { playbackSteps, type PlaybackStep } from './trace-steps';

/** Who took a step: the student, or the mentor acting as the agent. */
export type StepActor = 'student' | 'mentor';

/** A step as the playback shows it: whose it was, and whether it was replayed as recorded. */
export interface ShownStep {
  step: PlaybackStep;
  actor: StepActor;
  replayed: boolean;
}

/** Something Spark wrote about one step: where it suspects the attempt went wrong, or evidence. */
export interface StepNote {
  number: number;
  text: string;
  suspected: boolean;
}

/** What an answer line holds: `{"decision":"approve"}` from `ANSWER: {"decision":"approve"}`. */
export function answerOf(text: string): string {
  const lines = text.trim().split('\n');
  const answer = [...lines].reverse().find((line) => line.trim().startsWith('ANSWER:'));
  return (answer ?? lines.at(-1) ?? '').replace(/^\s*ANSWER:\s*/, '').trim();
}

/** Spark's notes on a finding's attempt: the step it suspects, then its evidence. */
export function findingNotes(finding: Pick<Finding, 'failureTurn' | 'cause' | 'evidence'>) {
  const notes: StepNote[] = [
    { number: finding.failureTurn, text: finding.cause, suspected: true },
    ...finding.evidence.map((item) => ({ number: item.turn, text: item.note, suspected: false })),
  ];
  return notes;
}

/** Spark's notes on the attempt a lesson repaired, from the diagnosis the lesson kept. */
export function lessonNotes(lesson: ListedLesson): StepNote[] {
  return lesson.diagnosis ? findingNotes(lesson.diagnosis) : [];
}

/** The step a lesson's correction began at: its checkpoint for a replay, else the first. */
export function takeoverStep(lesson: ListedLesson): number {
  return lesson.kind === 'replay_correction' ? (lesson.checkpoint?.turn ?? 1) : 1;
}

/**
 * The correction as it played: the student's steps replayed up to the checkpoint, then the
 * mentor's, numbered on from there. A full-task demonstration is all the mentor's.
 */
export function correctionSteps(
  lesson: ListedLesson,
  correction: Trace,
  original: Trace | null,
): ShownStep[] {
  const from = takeoverStep(lesson);
  const replayed =
    original === null || from <= 1
      ? []
      : playbackSteps(original)
          .filter((step) => step.number < from)
          .map((step): ShownStep => ({ step, actor: 'student', replayed: true }));
  const taken = playbackSteps(correction, from).map((step): ShownStep => ({
    step,
    actor: 'mentor',
    replayed: false,
  }));
  return [...replayed, ...taken];
}
