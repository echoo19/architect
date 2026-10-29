import type { RuleConfirmationState, RuleDetails, TaskPlan } from '@architect/shared';
import { shortDate } from '../format';

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

/**
 * What the section says first: who read the policy, and what rests on the rule. The agent is
 * called by its short name, as everywhere else on the screen, and the sentence says what happens
 * in the order it happens: the right answers come from the rule, the agent is graded against them.
 */
export function reviewIntro(teacher: string, student: string, count: number): string {
  return count === 1
    ? `${teacher} turned your policy into this rule. Architect works out the right answer to every task from this rule and grades ${student} against those answers, so if the rule is wrong, the grades are wrong too.`
    : `${teacher} turned your policy into these rules. Architect works out the right answer to every task from these rules and grades ${student} against those answers, so if the rules are wrong, the grades are wrong too.`;
}

/**
 * The line beside the button that confirms, and what the way out of it keeps: changing the
 * description puts the person's words and files back as they left them, and drafts again, so the
 * teacher's questions are asked again and the answers to them are not kept.
 */
export function confirmLine(teacher: string, count: number): string {
  const kept = `Your words and files come back as you left them, and ${teacher} may ask its questions again.`;
  return count === 1
    ? `Check that the lines from your policy are the right ones, and that the rule and the examples match them. Training can't start until you confirm it. If it isn't right, change the description. ${kept}`
    : `Check that the lines from your policy are the right ones, and that the rules and the examples match them. Training can't start until you confirm them. If they aren't right, change the description. ${kept}`;
}

/** When the person confirmed, as a short date: "Oct 29". */
export function confirmedOn(state: RuleConfirmationState): string | null {
  return state.confirmedAt === undefined ? null : shortDate(state.confirmedAt);
}

/**
 * "62 of 180 rows left out of the tasks" for the rows that couldn't be worked out, and why when
 * there is one reason for all of them: "62 of 180 rows left out of the tasks: parts_cost is empty
 * or N/A". It says what they were left out of, which is the tasks this job is made of.
 */
export function leftOutLine(details: RuleDetails): string | null {
  const out = details.cases.total - details.cases.eligible;
  if (out <= 0) return null;
  const rows = `${out} of ${details.cases.total} ${details.cases.total === 1 ? 'row' : 'rows'} left out of the tasks`;
  const [only, ...others] = details.excluded;
  return only !== undefined && others.length === 0 ? `${rows}: ${only.reason}` : rows;
}
