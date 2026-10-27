import type { Run } from '@architect/shared';

/** The four steps of a round, shown as the marks in the panel's phase strip. */
export const STAGES = ['attempting', 'diagnosing', 'evaluating', 'testing'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * What the Spark to Glimmer panel animates. `practising` and `checking` send tasks past the
 * checker; `returning` sends failures back to the mentor; `testing` runs with the mentor gone;
 * `still` is a run that has ended.
 */
export type Motion = 'idle' | 'practising' | 'returning' | 'checking' | 'testing' | 'still';

export interface PhaseView {
  stage: Stage | null;
  motion: Motion;
  /** Paused: the motion holds where it is. */
  frozen: boolean;
  text: string;
}

export interface ModelNames {
  mentor: string;
  student: string;
}

export function phaseView(run: Run, names: ModelNames): PhaseView {
  const { mentor, student } = names;
  switch (run.status) {
    case 'queued':
      return { stage: null, motion: 'idle', frozen: false, text: 'Waiting to start' };
    case 'paused':
      return { stage: stageOf(run), motion: motionOf(run), frozen: true, text: 'Paused' };
    case 'stopping':
      return {
        stage: stageOf(run),
        motion: motionOf(run),
        frozen: false,
        text: 'Stopping after this step',
      };
    case 'finished':
      return {
        stage: null,
        motion: 'still',
        frozen: true,
        text: `${student} finished the final test`,
      };
    case 'stopped':
      return { stage: null, motion: 'still', frozen: true, text: 'Training stopped' };
    case 'failed':
      return { stage: null, motion: 'still', frozen: true, text: 'Training stopped on an error' };
    case 'testing':
      return {
        stage: 'testing',
        motion: 'testing',
        frozen: false,
        text: `Final test, ${mentor} disconnected`,
      };
    case 'running':
      return {
        stage: stageOf(run),
        motion: motionOf(run),
        frozen: false,
        text: runningText(run, names),
      };
  }
}

function runningText(run: Run, { mentor, student }: ModelNames): string {
  switch (run.phase) {
    case 'preparing':
      return `Getting ${student} ready`;
    case 'baseline':
      return `Measuring ${student} before any teaching`;
    case 'attempting':
      return `${student} is working through practice tasks`;
    case 'diagnosing':
      return `${mentor} is reading the failures`;
    case 'evaluating':
      return "Checking the change on tasks it hasn't practiced";
    case 'testing':
      return `Final test, ${mentor} disconnected`;
    case 'done':
      return 'Wrapping up';
  }
}

function stageOf(run: Run): Stage | null {
  switch (run.phase) {
    case 'attempting':
    case 'diagnosing':
    case 'evaluating':
    case 'testing':
      return run.phase;
    case 'baseline':
      return 'evaluating';
    case 'preparing':
    case 'done':
      return null;
  }
}

function motionOf(run: Run): Motion {
  switch (run.phase) {
    case 'baseline':
    case 'attempting':
      return 'practising';
    case 'diagnosing':
      return 'returning';
    case 'evaluating':
      return 'checking';
    case 'testing':
      return 'testing';
    case 'preparing':
    case 'done':
      return 'idle';
  }
}
