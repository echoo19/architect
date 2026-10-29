import type { RuleConfirmationState, RuleDetails, TaskPlan } from '@architect/shared';

/** The rule types of a task plan: the ones Architect works an answer out for from a policy. */
export function ruleTypesOf(
  plan: TaskPlan,
): (TaskPlan['types'][number] & { details: RuleDetails })[] {
  return plan.types.flatMap((type) =>
    type.details === undefined ? [] : [{ ...type, details: type.details }],
  );
}

/** The plan of a job as the screen holds it: being read, not readable, or read. */
export interface PlanQuery {
  status: 'loading' | 'error' | 'success';
  data: TaskPlan | undefined;
}

/**
 * What training waits for before it may start. The plan says whether the job has a rule and
 * whether the person has confirmed it over these records, so until it has been read, and whenever
 * it couldn't be, it is not known that nothing is owed. `confirm`: a rule the person hasn't
 * confirmed. `describe`: records that changed under the rule, which confirming can't mend.
 */
export type TrainingWait = 'reading' | 'unreadable' | 'confirm' | 'describe';

export function trainingWait(plan: PlanQuery): TrainingWait | null {
  if (plan.status === 'loading') return 'reading';
  if (plan.status === 'error') return 'unreadable';
  switch (plan.data?.confirmation?.state) {
    case 'needed':
      return 'confirm';
    case 'changed':
      return 'describe';
    default:
      return null;
  }
}

/** What the footer says in place of "Keep Architect open" while training has to wait. */
export function waitLine(wait: TrainingWait | null): string | null {
  switch (wait) {
    case 'reading':
      return 'Checking the job';
    case 'unreadable':
      return "Couldn't check the job";
    case 'confirm':
      return 'Confirm the rule first';
    case 'describe':
      return 'Describe the job again first';
    case null:
      return null;
  }
}

/** What the section says first: who read the policy, and what rests on the rule. */
export function reviewIntro(teacher: string, count: number): string {
  return count === 1
    ? `${teacher} turned your policy into this rule. Architect works out every expected answer from it, so what the agent is tested on is only as right as the rule.`
    : `${teacher} turned your policy into these rules. Architect works out every expected answer from them, so what the agent is tested on is only as right as the rules.`;
}

/** The line beside the button that confirms. */
export function confirmLine(count: number): string {
  return count === 1
    ? "Check the passages, the rule and the examples against your policy. Training can't start until you confirm it. If it isn't right, describe the job again with what is missing."
    : "Check the passages, the rules and the examples against your policy. Training can't start until you confirm them. If they aren't right, describe the job again with what is missing.";
}

/** When the person confirmed, as a short date: "Oct 29". */
export function confirmedOn(state: RuleConfirmationState): string | null {
  if (state.confirmedAt === undefined) return null;
  const at = new Date(state.confirmedAt);
  return Number.isNaN(at.getTime())
    ? null
    : at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** "62 of 180 rows left out" for the rows that couldn't be worked out. */
export function leftOutLine(details: RuleDetails): string | null {
  const out = details.cases.total - details.cases.eligible;
  if (out <= 0) return null;
  return `${out} of ${details.cases.total} ${details.cases.total === 1 ? 'row' : 'rows'} left out`;
}
