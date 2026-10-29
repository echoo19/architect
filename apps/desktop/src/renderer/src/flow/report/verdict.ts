import type { Installation, ReportCard } from '@architect/shared';
import { installProblem, type InstallProblemContext } from '../../install/labels';
import { missedRequirements } from './requirements';

/**
 * What the results say about the agent, once: whether it met the job's targets on its final test
 * and whether it runs on this computer. The two never disagree on screen, so a page never calls an
 * agent graduated and ready beside a check that says it can't run. An agent is ready only once a
 * final test taken on this computer met the targets (decision 009): one whose test ran on the
 * online copy says it passed online, never that it is ready, until it is tested here.
 */
export type VerdictState =
  'ready' | 'tested_online' | 'below_target' | 'needs_attention' | 'blocked';

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

/** The final test's own result, said once: "58 of 60 on its final test", and where if online. */
function testResult(report: ReportCard): string {
  const { pass, total } = report.test.score;
  const where = report.testedOn === 'hosted' ? ', run online' : '';
  return `${pass} of ${total} on its final test${where}`;
}

/**
 * The verdict from the report card and, once the agent exists here, its install checks. A failed
 * check on this computer comes first: the agent can't be used until it is put right, whatever its
 * score. A missed target comes next, then a test that never ran on this computer, and only an
 * agent with none of these is ready. `here` is the run's final test on this computer when its own
 * ran online and it has been tested here since.
 */
export function reportVerdict(
  report: ReportCard,
  installation: Pick<Installation, 'status' | 'checks'> | null,
  context: InstallProblemContext,
  here: ReportCard | null = null,
): Verdict {
  // The test that decides is one taken on this computer: the run's own when it ran here, else
  // the one taken since. Until there is one, the online test is all there is.
  const online = report.testedOn === 'hosted';
  const local = online ? here : report;
  const deciding = local ?? report;
  const missed = missedRequirements(deciding);
  const problem =
    installation && installation.status !== 'ready' && installation.status !== 'unchecked'
      ? installProblem(installation, context)
      : null;
  const { name } = report;
  const where = !online ? '' : local === null ? ' on its online final test' : ' on this computer';

  if (installation?.status === 'blocked') {
    return {
      state: 'blocked',
      pill: "Can't run",
      title: `${name} can't run on this computer`,
      because: [
        problem?.cause ?? "One of this computer's checks failed.",
        missed.length === 0
          ? `It scored ${testResult(deciding)}.`
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
        `It missed the job's target${where}: ${missed.join(', and ')}.`,
        ...(online && local !== null ? [`It scored ${testResult(report)}.`] : []),
        ...(problem ? [problem.cause] : []),
        'You can still use it.',
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
  if (local === null) {
    const { pass, total } = report.test.score;
    return {
      state: 'tested_online',
      pill: 'Passed online',
      title: `${name} finished training`,
      because: [
        `Its final test ran on an online copy of ${context.model}, not on this computer. It got ${pass} of ${total}.`,
        'It is marked ready once it passes on this computer too.',
      ],
      usable: true,
    };
  }
  return {
    state: 'ready',
    pill: 'Ready',
    title: `${name} graduated`,
    because: online ? [`It passed on this computer too: ${testResult(local)}.`] : [],
    usable: true,
  };
}
