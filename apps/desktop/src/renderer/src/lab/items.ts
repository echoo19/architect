import type {
  Correction,
  GraduateSummary,
  Improvement,
  JobSummary,
  RunPhase,
  WorkspaceChat,
} from '@architect/shared';
import { formatPercent } from '../lib/format';
import { paths } from '../lib/router';

/*
 * What the Lab shows, read from records the engine already keeps: the jobs' newest runs, the
 * agents, their chats, lessons and improvements. Nothing here is estimated or made up; a value
 * the records don't hold is left out, never shown as zero.
 */

type LatestRun = NonNullable<JobSummary['latestRun']>;

/** What waits for the person, by kind. */
export type NeedKind = 'question' | 'results' | 'approval' | 'lessons' | 'promote' | 'failed';

export interface Need {
  key: string;
  kind: NeedKind;
  /** The job, agent or chat it is about. */
  title: string;
  /** What it asks, in a few words. */
  detail: string;
  /** Where it opens: a screen, or an agent's Teaching settings. */
  target: { path: string } | { teaching: string };
}

/** The jobs' runs that wait for the person: a question, results to read, or an error. */
export function jobNeeds(jobs: readonly JobSummary[]): Need[] {
  return jobs.flatMap((job): Need[] => {
    const run = job.latestRun;
    if (!run) return [];
    const at = (kind: NeedKind, detail: string, path: string): Need[] => [
      { key: `${kind}:${run.id}`, kind, title: job.name, detail, target: { path } },
    ];
    if (run.status === 'paused' && run.phase === 'clarifying') {
      return at('question', 'A question for you', paths.train(run.id));
    }
    if (run.status === 'finished' && run.improves !== true && run.accepted === false) {
      return at('results', 'Results ready', paths.report(run.id));
    }
    if (run.status === 'failed') return at('failed', 'Stopped on an error', paths.train(run.id));
    return [];
  });
}

/** Chats where an agent waits for the person to approve a change. */
export function approvalNeeds(graduate: GraduateSummary, chats: readonly WorkspaceChat[]): Need[] {
  return chats
    .filter((chat) => chat.waiting)
    .map((chat) => ({
      key: `approval:${chat.id}`,
      kind: 'approval' as const,
      title: chat.title,
      detail: `${graduate.name} waits for your approval`,
      target: { path: paths.chat(graduate.id, chat.id) },
    }));
}

/**
 * An agent's teaching that waits for the person: lessons Spark proposed from flagged answers,
 * not yet queued or discarded, and versions an improvement made that may be promoted.
 */
export function teachingNeeds(
  graduate: GraduateSummary,
  corrections: readonly Correction[],
  improvements: readonly Improvement[],
): Need[] {
  const needs: Need[] = [];
  const proposed = corrections.filter((correction) => correction.status === 'proposed').length;
  if (proposed > 0) {
    needs.push({
      key: `lessons:${graduate.id}`,
      kind: 'lessons',
      title: graduate.name,
      detail: proposed === 1 ? 'A lesson to review' : `${proposed} lessons to review`,
      target: { teaching: graduate.id },
    });
  }
  for (const improvement of improvements) {
    const version = improvement.candidateVersion;
    if (
      improvement.status !== 'finished' ||
      version === undefined ||
      !improvement.promotion.allowed ||
      version === graduate.activeVersion
    ) {
      continue;
    }
    needs.push({
      key: `promote:${improvement.runId}`,
      kind: 'promote',
      title: graduate.name,
      detail: versionDetail(version, improvement, graduate.activeVersion),
      target: { path: paths.improvement(improvement.runId) },
    });
  }
  return needs;
}

/**
 * A new version beside the one in use, by their check-task scores, so the line never recommends
 * a version that scored lower: "Version 3: 88% on check tasks, active version 2: 94%". The
 * active version's score is the improvement's starting score only when it started from it.
 */
function versionDetail(version: number, improvement: Improvement, active: number | null): string {
  const after = improvement.dev.after;
  if (!after || after.total === 0) return `Version ${version} to review`;
  const own = `Version ${version}: ${formatPercent(after)} on check tasks`;
  const before = improvement.dev.before;
  return active !== null && improvement.fromVersion === active && before && before.total > 0
    ? `${own}, active version ${active}: ${formatPercent(before)}`
    : own;
}

export interface RunRow {
  jobId: string;
  jobName: string;
  runId: string;
  run: LatestRun;
}

const ACTIVE = new Set<LatestRun['status']>(['queued', 'running', 'stopping', 'testing']);

/** Runs under way, and paused ones that aren't waiting on a question (those need the person). */
export function runningRuns(jobs: readonly JobSummary[]): RunRow[] {
  return jobs.flatMap((job) => {
    const run = job.latestRun;
    if (!run) return [];
    const paused = run.status === 'paused' && run.phase !== 'clarifying';
    return ACTIVE.has(run.status) || paused
      ? [{ jobId: job.id, jobName: job.name, runId: run.id, run }]
      : [];
  });
}

/** Training runs that finished with a final test, newest jobs first as the list keeps them. */
export function finishedRuns(jobs: readonly JobSummary[], limit = 4): RunRow[] {
  return jobs
    .flatMap((job) => {
      const run = job.latestRun;
      return run && run.status === 'finished' && run.improves !== true
        ? [{ jobId: job.id, jobName: job.name, runId: run.id, run }]
        : [];
    })
    .slice(0, limit);
}

/** What a run is doing, in a word or two. */
export function runWord(run: Pick<LatestRun, 'status' | 'phase'>): string {
  if (run.status === 'paused') return 'Paused';
  if (run.status === 'queued') return 'Waiting to start';
  if (run.status === 'stopping') return 'Stopping';
  if (run.status === 'testing') return 'Final test';
  const words: Record<RunPhase, string> = {
    preparing: 'Preparing',
    baseline: 'Measuring',
    attempting: 'Practicing',
    diagnosing: 'Diagnosing',
    teaching: 'Teaching',
    training: 'Training weights',
    clarifying: 'Asking',
    evaluating: 'Scoring',
    testing: 'Final test',
    done: 'Finishing',
  };
  return words[run.phase];
}

export { orgScores, type OrgScores } from '@architect/shared';
