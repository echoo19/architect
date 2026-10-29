import {
  AGENT_INTERVENTIONS,
  allowedInterventions,
  HARNESS_INTERVENTIONS,
  storedInterventions,
  type HubTokenStatus,
  type InterventionType,
  type Job,
  type StudentTarget,
} from '@architect/shared';
import type { QueryState } from '../../api/query';

/*
 * What the person lets the teacher change (decision 063), as the Teacher tab and the pre-flight
 * read it: which kinds are on, which one can't be turned off, and what the app already knows
 * keeps the weights from being trained here.
 */

/** What the app can tell, before a run, of whether weights can be trained on this computer. */
export interface WeightsFacts {
  /** Whether a Hugging Face token comes from anywhere; unknown while that is being read. */
  token: 'found' | 'none' | 'unknown';
  /** Where the run's final test will run: an adapter can't be loaded by the online copy. */
  testPlace: StudentTarget;
}

/** Why weights can't be trained, in the order the engine looks for it. */
export type WeightsBlock = 'online_test' | 'no_token' | 'no_budget';

/** The token as the pre-flight knows it: nothing is claimed until it has been read. */
export function tokenState(query: QueryState<HubTokenStatus>): WeightsFacts['token'] {
  if (query.data === undefined) return 'unknown';
  return query.data.source === null ? 'none' : 'found';
}

/**
 * The first thing the app knows that stops weights from being trained, or null when it knows
 * nothing does. Only the engine knows the rest: it checks again when a round begins.
 */
export function weightsBlock(job: Job, facts: WeightsFacts): WeightsBlock | null {
  if (facts.testPlace === 'hosted') return 'online_test';
  if (facts.token === 'none') return 'no_token';
  if ((job.budget.maxComputeUsd ?? 0) <= 0) return 'no_budget';
  return null;
}

/** What a row says in place of its explanation while weights are on and can't be trained. */
export const BLOCK_NOTES: Record<WeightsBlock, string> = {
  online_test: "Can't run while the final test is online",
  no_token: 'Needs a Hugging Face token, added in Settings',
  no_budget: 'This job has no budget for training',
};

/** The same, as the end of a sentence about the weights. */
export const BLOCK_REASONS: Record<WeightsBlock, string> = {
  online_test: "can't be trained while the final test runs online",
  no_token: 'need a Hugging Face token, added in Settings',
  no_budget: 'need a training budget, and this job has none',
};

/** The kinds of change the mentor may use that change the agent. */
export function agentChanges(job: Job): InterventionType[] {
  return allowedInterventions(job).filter((type) => AGENT_INTERVENTIONS.includes(type));
}

/**
 * Whether a kind is the only one left that changes the agent, so it can't be turned off:
 * a teacher that may only ask questions teaches nothing.
 */
export function isLastChange(job: Job, type: InterventionType): boolean {
  const left = agentChanges(job);
  return left.length === 1 && left[0] === type;
}

/**
 * The job with one kind turned on or off. A job that allows everything holds no list, so one the
 * person turned back on is as it was before they began.
 */
export function withIntervention(job: Job, type: InterventionType, on: boolean): Job {
  const allowed = new Set(allowedInterventions(job));
  if (on) allowed.add(type);
  else allowed.delete(type);
  const { interventions: _before, ...rest } = job;
  const list = storedInterventions(allowed);
  return list === undefined ? rest : { ...rest, interventions: list };
}

/**
 * Why the teacher has nothing it may change before a run starts, or null when it has, or when the
 * app can't tell: the person left only the weights on, and the app knows they can't be trained
 * here. Questions alone change nothing, and a harness change is never held back by anything the
 * app can see.
 */
export function idleBlock(job: Job, facts: WeightsFacts): WeightsBlock | null {
  if (allowedInterventions(job).some((type) => HARNESS_INTERVENTIONS.includes(type))) return null;
  return weightsBlock(job, facts);
}
