import type { RuleConfirmationState, RuleDetails, TaskPlan } from '@architect/shared';

/** The rule types of a task plan: the ones Architect works an answer out for from a policy. */
export function ruleTypesOf(
  plan: TaskPlan,
): (TaskPlan['types'][number] & { details: RuleDetails })[] {
  return plan.types.flatMap((type) =>
    type.details === undefined ? [] : [{ ...type, details: type.details }],
  );
}

/** Whether training has to wait: the plan has a rule the person has not confirmed over these records. */
export function waitsForRule(plan: TaskPlan | undefined): boolean {
  return plan?.confirmation !== undefined && plan.confirmation.state !== 'confirmed';
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
    ? "Check the passages, the rule and the examples against your policy. Training can't start until you confirm it."
    : "Check the passages, the rules and the examples against your policy. Training can't start until you confirm them.";
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
