import type { Round, Run } from '@architect/shared';
import { WORDS, type Words } from '@architect/ui';
import { neverStarted } from './run-state';

/** The three steps of a round, shown in the panel's phase strip. */
export const ROUND_STAGES = ['attempting', 'diagnosing', 'evaluating'] as const;
/** A round's steps, or the final test, which runs once after training. */
export type Stage = (typeof ROUND_STAGES)[number] | 'testing';

/** The steps as the panel names them. */
export const STAGE_LABELS: Record<Stage, string> = {
  attempting: 'Practice',
  diagnosing: 'Diagnose',
  evaluating: 'Score',
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
 * An improvement's last steps and how it ended: it writes a new version of the agent where a
 * training run takes its final test. Null while it is in its rounds, which read as any run's.
 */
function improvementView(run: Run): PhaseView | null {
  const still = { stage: null, motion: 'still', frozen: true } as const;
  switch (run.status) {
    case 'finished':
      return {
        ...still,
        text: run.graduateId ? 'Made a new version' : 'No change was kept, so it made no version',
      };
    case 'stopped':
      return { ...still, text: 'Improving stopped' };
    case 'failed':
      return { ...still, text: 'Improving stopped on an error' };
    default:
      if (run.phase !== 'testing' && run.status !== 'testing') return null;
      return run.status === 'paused'
        ? { stage: null, motion: 'idle', frozen: true, text: 'Paused' }
        : { stage: null, motion: 'idle', frozen: false, text: 'Writing its new version' };
  }
}

/**
 * What the panel shows for the run's state. `drafting` is true while the current round writes
 * the first full draft of the agent's instructions instead of one watched change; `improving`
 * when the run is Improve agent's, which ends in a new version rather than a final test.
 * `roundStatus` is the current round's, which says when a round scores its tries or makes one
 * change from them (decision 108).
 */
export function phaseView(
  run: Run,
  names: ModelNames,
  drafting = false,
  improving = false,
  w: Words = WORDS.personal,
  roundStatus?: Round['status'],
): PhaseView {
  const improvement = improving ? improvementView(run) : null;
  if (improvement) return improvement;
  const { mentor, student } = names;
  switch (run.status) {
    case 'queued':
      return { stage: null, motion: 'idle', frozen: false, text: 'Waiting to start' };
    case 'paused':
      return {
        stage: stageOf(run),
        motion: motionOf(run),
        frozen: true,
        text: run.phase === 'clarifying' ? `${mentor} has a question for you` : 'Paused',
      };
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
        text: `Training is done, and ${student} took the ${w.finalTest}`,
      };
    case 'stopped':
      return {
        stage: null,
        motion: 'still',
        frozen: true,
        // A teacher with nothing it may change ends the run before it begins: it never started.
        text:
          run.stopReason === 'nothing_to_try' && neverStarted(run)
            ? "Training didn't start"
            : 'Training stopped',
      };
    case 'failed':
      return { stage: null, motion: 'still', frozen: true, text: 'Training stopped on an error' };
    case 'testing':
      return {
        stage: 'testing',
        motion: 'testing',
        frozen: false,
        text: `${w.FinalTest}, ${mentor} disconnected`,
      };
    case 'running':
      return {
        stage: stageOf(run),
        motion: motionOf(run),
        frozen: false,
        text: runningText(run, names, drafting, w, roundStatus),
      };
  }
}

function runningText(
  run: Run,
  { mentor, student }: ModelNames,
  drafting: boolean,
  w: Words,
  roundStatus: Round['status'] | undefined,
): string {
  if (roundStatus === 'probing' && run.phase === 'evaluating') {
    return `Scoring each ${w.lab ? 'probe' : 'try'} on the ${w.checks}`;
  }
  if (roundStatus === 'composing' && run.phase === 'diagnosing') {
    return `${mentor} is making one change from the ${w.lab ? 'probes' : 'tries'}`;
  }
  if (drafting && run.phase === 'diagnosing') {
    return `${mentor} is writing a first full draft of ${student}'s ${w.lab ? 'harness' : 'instructions'}`;
  }
  if (drafting && run.phase === 'evaluating') return `Scoring the first draft on the ${w.checks}`;
  switch (run.phase) {
    case 'preparing':
      return `Getting ${student} ready`;
    case 'baseline':
      return `Scoring ${student} on the ${w.checks} before any teaching`;
    case 'attempting':
      return `${student} is working through practice tasks`;
    case 'diagnosing':
      return `${mentor} is reading the failures`;
    case 'teaching':
      return `${mentor} is working through corrections, each checked before it counts`;
    case 'training':
      return w.lab
        ? 'Fine-tuning a LoRA adapter on the checked corrections'
        : 'An adapter is training on the checked corrections';
    case 'clarifying':
      return `${mentor} has a question for you`;
    case 'evaluating':
      return `Scoring the change on the ${w.checks}`;
    case 'testing':
      return `${w.FinalTest}, ${mentor} disconnected`;
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
    case 'teaching':
    case 'training':
    case 'clarifying':
      return 'diagnosing';
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
    case 'teaching':
    case 'training':
      return 'returning';
    case 'evaluating':
      return 'checking';
    case 'testing':
      return 'testing';
    case 'clarifying':
    case 'preparing':
    case 'done':
      return 'idle';
  }
}
