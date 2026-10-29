import {
  AGENT_INTERVENTIONS,
  allowedInterventions,
  fileOffLimits,
  HARNESS_INTERVENTIONS,
  INTERVENTION_LABELS,
  InterventionTypeSchema,
  interventionsForFile,
  mayIntervene,
  type CostEstimate,
  type InterventionPlan,
  type InterventionType,
  type Job,
} from '@architect/shared';
import { formatUsd } from './budget';
import type { RunState } from './run-state';
import { MIN_JOB_SECONDS } from '../training/recipe';

/** What choosing each type amounts to, in words for a refusal a person reads. */
const CHOICES: Record<InterventionType, string> = {
  procedure: 'a procedure',
  retrieval: 'retrieval',
  helper: 'a helper',
  weights: 'to train the weights',
  clarification: 'to ask a question',
};

/**
 * Why a kind of change the person switched off is refused, for the person to read and for the
 * mentor to be told (decision 063).
 */
export const TURNED_OFF = "Turned off for this job in the teacher's settings.";

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
  if (!deps.training) return 'This copy of Architect has no trainer for weights.';
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
 * The intervention menu for this run's next round (spec section 7). What the job turned off is
 * off. Of the rest, harness changes are always on; weights need a training worker, a backend, an
 * adapter runtime, and compute budget for one job; a clarification needs someone there to answer.
 */
export async function menuOf(state: RunState): Promise<Menu> {
  const { adapters } = state.ctx.deps;
  const canTeach =
    adapters.createActor !== undefined &&
    state.job.mentor.kind === 'model' &&
    (adapters.canAct?.(state.job.mentor) ?? true);
  const refused: Menu['refused'] = {};
  // The person's choice comes first: it holds whatever else is set up, so it is the reason given.
  const permitted = allowedInterventions(state.job);
  for (const type of InterventionTypeSchema.options) {
    if (!permitted.includes(type)) refused[type] = TURNED_OFF;
  }
  if (refused.weights === undefined) {
    const weights = await weightsRefusal(state, canTeach);
    if (weights !== null) refused.weights = weights;
  }
  if (refused.clarification === undefined && state.record.interactive !== true) {
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
    ...HARNESS_INTERVENTIONS,
    ...(['weights', 'clarification'] as const),
  ].filter((type) => refused[type] === undefined);
  return { allowed, refused, canTeach, computeLeftUsd: computeLeft(state) };
}

/**
 * The menu a round's author chooses from: Architect's full one, or the harness changes alone for
 * the simpler methods, which the job's choice still limits.
 */
export async function roundMenu(state: RunState): Promise<Menu> {
  if (state.run.method === 'architect') return menuOf(state);
  const permitted = allowedInterventions(state.job);
  const refused: Menu['refused'] = {};
  for (const type of HARNESS_INTERVENTIONS) {
    if (!permitted.includes(type)) refused[type] = TURNED_OFF;
  }
  return {
    allowed: HARNESS_INTERVENTIONS.filter((type) => refused[type] === undefined),
    refused,
    canTeach: false,
    computeLeftUsd: 0,
  };
}

/** Names joined for a sentence: "a", "a and b", "a, b and c". */
function listOf(names: readonly string[]): string {
  if (names.length < 2) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * Why the mentor has nothing it may change in this round, or null when it has something: a kind
 * of change that changes the agent is on its menu. A round that writes a whole first draft needs
 * a harness change to be on it, and nothing else will do. Said before the mentor is asked, so
 * nothing is spent on a round whose every proposal would be refused.
 */
export async function nothingToTry(state: RunState, index: number): Promise<string | null> {
  if (state.run.method === 'bare') return null;
  const menu = await roundMenu(state);
  const wanted = state.drafts(index) ? HARNESS_INTERVENTIONS : AGENT_INTERVENTIONS;
  if (wanted.some((type) => menu.allowed.includes(type))) return null;
  const turnedOff = wanted.filter((type) => menu.refused[type] === TURNED_OFF);
  const sentences = [
    ...(turnedOff.length === 0
      ? []
      : [
          `${listOf(turnedOff.map((type) => INTERVENTION_LABELS[type]))} ${turnedOff.length === 1 ? 'is' : 'are'} turned off for this job in the teacher's settings.`,
        ]),
    ...wanted.flatMap((type) => {
      const reason = menu.refused[type];
      return reason === undefined || reason === TURNED_OFF
        ? []
        : [`${INTERVENTION_LABELS[type]}: ${reason}`];
    }),
  ];
  return `The mentor has nothing it may change in this run. ${sentences.join(' ')} Change what it may change in the job's advanced settings, under Teacher, or set up what is missing, then start a new run.`;
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
 * The kind a reply that names none stands for: a student's own, one from before the menu, or one
 * that left the field out (decision 063). It chose no kind, so it is read as the kind its files
 * belong to, the first the job allows, and as a procedure when they belong to none.
 */
export function impliedKind(paths: readonly string[], job: Job): InterventionType {
  const owners = paths.flatMap((path) => interventionsForFile(path) ?? []);
  const allowed = allowedInterventions(job);
  return owners.find((kind) => allowed.includes(kind)) ?? owners[0] ?? 'procedure';
}

/**
 * Why a change set can't be applied, or null when it can: it writes or deletes a file that only a
 * kind of change this round doesn't allow may write, whatever the mentor called the change, or it
 * changes the harness where no kind of change to it is allowed. The round's menu has the kinds and
 * the reasons, a comparison's among them; a first draft has none and is held to what the job
 * allows.
 */
export function changeSetRefusal(paths: readonly string[], job: Job, menu?: Menu): string | null {
  const allowed = menu?.allowed ?? allowedInterventions(job);
  const reasons = (kinds: readonly InterventionType[]) => [
    ...new Set(kinds.map((kind) => menu?.refused[kind] ?? TURNED_OFF)),
  ];
  const off = fileOffLimits(paths, { interventions: allowed });
  if (off !== null) {
    const names = off.kinds.map((kind) => `"${INTERVENTION_LABELS[kind]}"`);
    const why = reasons(off.kinds);
    if (why.length === 1 && why[0] === TURNED_OFF) {
      const which =
        names.length === 1 ? `${names[0]}, which is` : `${names.join(' or ')}, and both are`;
      return `${off.path} needs ${which} turned off for this job in the teacher's settings.`;
    }
    return `${off.path} needs ${names.join(' or ')}, which this run can't do. ${why.join(' ')}`;
  }
  // Decoding and guardrails belong to no kind, but they are the harness all the same.
  const [first] = paths;
  if (first !== undefined && !HARNESS_INTERVENTIONS.some((kind) => allowed.includes(kind))) {
    const names = listOf(HARNESS_INTERVENTIONS.map((kind) => INTERVENTION_LABELS[kind]));
    return `${first} changes the harness, and ${names} are all off. ${reasons(HARNESS_INTERVENTIONS).join(' ')}`;
  }
  return null;
}

/** What a reply says it is, and what it writes: a reply that names no kind is judged by its files. */
export interface Change {
  named: boolean;
  paths: readonly string[];
}

/**
 * Why the runner can't take an intervention, or null when it can: a type the job or this run
 * doesn't allow, teaching it asks for that can't happen here, nothing to teach from, or an
 * estimate past what is left of a budget. A reply that names no kind chose none, so it is not held
 * to the kind it is read as: the files it writes decide, and the refusal names those.
 */
export function interventionRefusal(
  plan: InterventionPlan,
  findings: number,
  state: RunState,
  menu: Menu,
  change: Change,
): string | null {
  if (change.named) {
    if (!menu.allowed.includes(plan.type)) {
      return `The mentor chose ${CHOICES[plan.type]}, which this run can't do. ${menu.refused[plan.type] ?? 'It is off the menu.'}`;
    }
  } else {
    const unusable = changeSetRefusal(change.paths, state.job, menu);
    if (unusable !== null) return unusable;
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
  // The runner adds a retrieval rule that loads a worked example, so the job has to allow one.
  if (
    plan.workedExamples.length > 0 &&
    HARNESS_INTERVENTIONS.includes(plan.type) &&
    !mayIntervene(state.job, 'retrieval')
  ) {
    return `Worked examples are loaded by a retrieval rule, and "${INTERVENTION_LABELS.retrieval}" is turned off for this job in the teacher's settings.`;
  }
  return overBudget(plan.estimatedCost, state, menu);
}
