import type { Installation, ReportCard } from '@architect/shared';
import { installProblem, type InstallProblemContext } from '../../install/labels';
import { missedRequirements } from './requirements';

/**
 * What the results say about the agent, once: whether it met the job's targets on its final test
 * and whether it runs on this computer. The two never disagree on screen, so a page never calls an
 * agent graduated and ready beside a check that says it can't run.
 */
export type VerdictState = 'ready' | 'below_target' | 'needs_attention' | 'blocked';

export interface Verdict {
  state: VerdictState;
  /** The pill's words. */
  pill: string;
  title: string;
  /** What lies behind it, a plain sentence each, in the order to read them. */
  because: string[];
  /** The agent can be used from here as it is; false when this computer must be put right first. */
  usable: boolean;
}

/** The final test's own result, said once: "58 of 60 on its final test". */
function testResult(report: ReportCard): string {
  const { pass, total } = report.test.score;
  return `${pass} of ${total} on its final test`;
}

/**
 * The verdict from the report card and, once the agent exists here, its install checks. A failed
 * check on this computer comes first: the agent can't be used until it is put right, whatever its
 * score. A missed target comes next, and only an agent with neither is ready.
 */
export function reportVerdict(
  report: ReportCard,
  installation: Pick<Installation, 'status' | 'checks'> | null,
  context: InstallProblemContext,
): Verdict {
  const missed = missedRequirements(report);
  const problem =
    installation && installation.status !== 'ready' && installation.status !== 'unchecked'
      ? installProblem(installation, context)
      : null;
  const { name } = report;

  if (installation?.status === 'blocked') {
    return {
      state: 'blocked',
      pill: "Can't run",
      title: `${name} can't run on this computer`,
      because: [
        problem?.cause ?? "One of this computer's checks failed.",
        missed.length === 0
          ? `It scored ${testResult(report)}.`
          : `It also fell short: ${missed.join(', and ')}.`,
      ],
      usable: false,
    };
  }
  if (missed.length > 0) {
    return {
      state: 'below_target',
      pill: 'Not ready',
      title: `${name} finished training`,
      because: [
        `Not ready: ${missed.join(', and ')}.`,
        ...(problem ? [problem.cause] : []),
        'You can still use it, or train again.',
      ],
      usable: installation?.status !== 'needs_attention',
    };
  }
  if (installation?.status === 'needs_attention') {
    return {
      state: 'needs_attention',
      pill: 'Needs attention',
      title: `${name} needs one more step`,
      because: [problem?.cause ?? "One of this computer's checks needs you."],
      usable: false,
    };
  }
  return { state: 'ready', pill: 'Ready', title: `${name} graduated`, because: [], usable: true };
}
