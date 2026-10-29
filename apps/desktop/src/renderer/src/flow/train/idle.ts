import { HARNESS_INTERVENTIONS, mayIntervene } from '@architect/shared';
import { BLOCK_REASONS, keyHint, weightsBlock, type WeightsFacts } from '../define/teacher-menu';
import { modelNames } from '../names';
import { neverStarted, type LiveRun } from './run-state';

/*
 * A run that ended because its teacher had nothing it may change (decision 063), told to the
 * person from the job and what the app knows now, never from the engine's sentence. That one says
 * "mentor" and names parts of the engine; it waits under Details for whoever wants it.
 */

/** What the app knows besides the run's own record. */
export interface IdleFacts {
  /** Whether a Hugging Face key comes from anywhere; unknown while that is being read. */
  token: WeightsFacts['token'];
  /** The person added the key from the notice, so it is no longer what is missing. */
  keyAdded: boolean;
}

/** What the notice for such a run says. */
export interface IdleView {
  /** "Training didn't start" when nothing ran, "Training stopped" when the run had begun. */
  title: string;
  /** What is off and what is missing, and that nothing was spent when nothing was. */
  body: string;
  /** The Hugging Face key is what keeps the run from going on, so the way to add it is offered. */
  missingKey: boolean;
  /**
   * The person turned the other kinds of change off, so the way out is to turn one back on. False
   * when a kind is on already and the reason is the engine's to give, under Details.
   */
  turnOn: boolean;
}

/** Whether the run had begun: a round was started or a check task attempted. */
export function hadStarted(live: LiveRun): boolean {
  return live.rounds.length > 0 || !neverStarted(live.run);
}

/**
 * Why the run ended with nothing to try. The person turned off every kind of change that can be
 * tried here, except perhaps retraining the student itself, and the app can say what keeps that
 * from running when it can see it: the key, the final test online, or the missing budget.
 */
export function idleView(live: LiveRun, facts: IdleFacts): IdleView {
  const { run, job } = live;
  const { mentor, student } = modelNames(job);
  const started = hadStarted(live);
  const title = started ? 'Training stopped' : "Training didn't start";
  const spent = started || run.totals.mentorUsd > 0 ? [] : ['Nothing was spent.'];
  const harness = HARNESS_INTERVENTIONS.some((kind) => mayIntervene(job, kind));
  const view = (
    reason: string,
    how: { missingKey?: boolean; turnOn?: boolean } = {},
  ): IdleView => ({
    title,
    body: [reason, ...spent].join(' '),
    missingKey: how.missingKey ?? false,
    turnOn: how.turnOn ?? false,
  });

  // The simpler versions of a comparison change nothing but the harness, and never the weights.
  if (run.method !== 'architect') {
    return harness
      ? view(`${mentor} couldn't change anything in this run. The reason is under Details.`)
      : view(
          'This simpler version can only change instructions, what it reads and small tools, and every one of them is turned off for this job.',
          { turnOn: true },
        );
  }
  // A job always keeps one kind of change that changes the agent, so with the harness's three
  // off the weights are on. Anything else is for the engine's sentence to explain.
  if (harness || !mayIntervene(job, 'weights')) {
    return view(`${mentor} couldn't change anything in this run. The reason is under Details.`);
  }

  const block = weightsBlock(job, { token: facts.token, testPlace: live.lockedTestOn });
  const except = `Every kind of change ${mentor} may make is turned off for this job, except retraining ${student} itself`;
  if (block !== null) {
    return view(`${except}, which ${BLOCK_REASONS[block]}.${keyHint(block)}`, {
      missingKey: block === 'no_token',
      turnOn: true,
    });
  }
  if (facts.keyAdded) {
    return view(
      `${except}, which needed a Hugging Face key. The key is saved now, so start again from the job.`,
      { turnOn: true },
    );
  }
  return view(`${except}, which couldn't ${started ? 'go on' : 'run here'}.`, { turnOn: true });
}
