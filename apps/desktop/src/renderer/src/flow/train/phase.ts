import type { Run } from '@architect/shared';

/** The three steps of a round, shown in the panel's phase strip. */
export const ROUND_STAGES = ['attempting', 'diagnosing', 'evaluating'] as const;
/** A round's steps, or the final test, which runs once after training. */
export type Stage = (typeof ROUND_STAGES)[number] | 'testing';

/** The steps as the panel names them. */
export const STAGE_LABELS: Record<Stage, string> = {
  attempting: 'Practice',
  diagnosing: 'Diagnose',
  evaluating: 'Check',
  testing: 'Final test',
};

/**
 * What the Spark to Glimmer panel animates: the mentor's rings turn faster while it reads
 * failures, and the student's grid lights up while it answers; `testing` runs with the mentor
 * gone; `still` is a run that has ended.
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

/**
 * What the panel shows for the run's state. `drafting` is true while the current round writes
 * the first full draft of the agent's instructions instead of one watched change.
 */
export function phaseView(run: Run, names: ModelNames, drafting = false): PhaseView {
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
        text: runningText(run, names, drafting),
      };
  }
}

function runningText(run: Run, { mentor, student }: ModelNames, drafting: boolean): string {
  if (drafting && run.phase === 'diagnosing') {
    return `${mentor} is writing a first full draft of ${student}'s instructions`;
  }
  if (drafting && run.phase === 'evaluating') return 'Scoring the first draft on the check tasks';
  switch (run.phase) {
    case 'preparing':
      return `Getting ${student} ready`;
    case 'baseline':
      return `Scoring ${student} on the check tasks before any teaching`;
    case 'attempting':
      return `${student} is working through practice tasks`;
    case 'diagnosing':
      return `${mentor} is reading the failures`;
    case 'evaluating':
      return 'Scoring the change on the check tasks';
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
