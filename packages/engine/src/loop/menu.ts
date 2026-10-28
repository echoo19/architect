import {
  InterventionTypeSchema,
  type CostEstimate,
  type InterventionPlan,
  type InterventionType,
} from '@architect/shared';
import { formatUsd } from './budget';
import type { RunState } from './run-state';
import { MIN_JOB_SECONDS } from '../training/recipe';

/** The types that change only the harness. */
const HARNESS_TYPES: readonly InterventionType[] = ['procedure', 'retrieval', 'helper'];

/** What a run may choose from this round, and why the rest are off the menu. */
export interface Menu {
  allowed: InterventionType[];
  refused: Partial<Record<InterventionType, string>>;
  /** Verified corrections can be made: the mentor's model can act as the agent here. */
  canTeach: boolean;
  /** Compute dollars a new training job could still be paid from. */
  computeLeftUsd: number;
}

/** Compute dollars the run may still spend, against the job's cap. */
export function computeLeft(state: RunState): number {
  const training = state.ctx.deps.training;
  if (!training) return 0;
  return training.worker.usage(state.ctx.runId, state.job.budget.maxComputeUsd ?? 0).leftUsd;
}

/** Why a weights intervention can't run now, or null when it can. */
async function weightsRefusal(state: RunState, canTeach: boolean): Promise<string | null> {
  const { deps } = state.ctx;
  if (!deps.training) return 'No training worker is set up in this build.';
  if (!deps.adapters.createAdapterStudent) {
    return "This build can't serve an adapter, so a trained one couldn't be measured.";
  }
  if (!canTeach)
    return 'Verified corrections, which an adapter trains on, need the mentor as the agent.';
  if (state.record.lockedTestOn === 'hosted') {
    return "This run's locked test runs on the hosted copy of the student, which can't load an adapter.";
  }
  const backend = await deps.training.backend();
  if (backend === null) return 'No training backend is set up.';
  if (!backend.real && deps.training.offersStandIn !== true) {
    return 'Only the stand-in backend is set up here, and it trains nothing. Add a Hugging Face token to train an adapter.';
  }
  if (backend.pricePerHourUsd > 0) {
    const least = (MIN_JOB_SECONDS / 3600) * backend.pricePerHourUsd;
    const left = computeLeft(state);
    if (left + 1e-9 < least) {
      return `The compute budget has ${formatUsd(left)} left, and a training job needs at least ${formatUsd(least)}.`;
    }
  }
  return null;
}

/**
 * The intervention menu for this run's next round (spec section 7). Harness changes are always
 * on it; weights need a training worker, a backend, an adapter runtime, and compute budget for
 * one job; a clarification needs someone there to answer.
 */
export async function menuOf(state: RunState): Promise<Menu> {
  const { adapters } = state.ctx.deps;
  const canTeach =
    adapters.createActor !== undefined &&
    state.job.mentor.kind === 'model' &&
    (adapters.canAct?.(state.job.mentor) ?? true);
  const refused: Menu['refused'] = {};
  const weights = await weightsRefusal(state, canTeach);
  if (weights !== null) refused.weights = weights;
  if (state.record.interactive !== true) {
    refused.clarification = "Nobody is there to answer: this run wasn't started from the app.";
  }
  // A comparison that fixes the intervention offers that one alone (decision 045).
  const fixed = state.record.protocol?.interventions;
  if (fixed !== undefined) {
    for (const type of InterventionTypeSchema.options) {
      if (!fixed.includes(type) && refused[type] === undefined) {
        refused[type] =
          `This run's comparison fixes the intervention to ${fixed.join(' or ')}, so the mentor doesn't choose it.`;
      }
    }
  }
  const allowed: InterventionType[] = [
    ...HARNESS_TYPES,
    ...(['weights', 'clarification'] as const),
  ].filter((type) => refused[type] === undefined);
  return { allowed, refused, canTeach, computeLeftUsd: computeLeft(state) };
}

function overBudget(estimate: CostEstimate, state: RunState, menu: Menu): string | null {
  const left = state.budget.left();
  if (estimate.mentorUsd > left.usd + 1e-9) {
    return `Its estimate of ${formatUsd(estimate.mentorUsd)} of mentor spend is more than the ${formatUsd(left.usd)} left.`;
  }
  if (estimate.computeUsd > menu.computeLeftUsd + 1e-9) {
    return `Its estimate of ${formatUsd(estimate.computeUsd)} of compute is more than the ${formatUsd(menu.computeLeftUsd)} left.`;
  }
  if (estimate.minutes > left.minutes + 1e-9) {
    return `Its estimate of ${Math.ceil(estimate.minutes)} minutes is more than the ${Math.floor(left.minutes)} left.`;
  }
  return null;
}

/**
 * Why the runner can't take an intervention, or null when it can: a type the job or this run
 * doesn't allow, teaching it asks for that can't happen here, nothing to teach from, or an
 * estimate past what is left of a budget.
 */
export function interventionRefusal(
  plan: InterventionPlan,
  findings: number,
  state: RunState,
  menu: Menu,
): string | null {
  if (!menu.allowed.includes(plan.type)) {
    return `A ${plan.type} intervention isn't possible in this run: ${menu.refused[plan.type] ?? 'it is off the menu.'}`;
  }
  const teaches = plan.workedExamples.length > 0 || plan.practicePerFinding > 0;
  if (plan.type === 'weights' && findings === 0) {
    return 'A weights intervention trains on corrections of failed train attempts, and no finding held up.';
  }
  if (plan.type === 'clarification' && plan.question === '') {
    return 'A clarification needs its one question.';
  }
  if (plan.type === 'clarification' && teaches) {
    return 'A clarification comes before any correction is made, so it asks for no examples or practice.';
  }
  if (teaches && !menu.canTeach) {
    return "Worked examples and practice need the mentor as the agent, which this build or mentor can't run.";
  }
  if (plan.workedExamples.length > 0 && findings === 0) {
    return 'Worked examples come from corrections of failed train attempts, and no finding held up.';
  }
  return overBudget(plan.estimatedCost, state, menu);
}
