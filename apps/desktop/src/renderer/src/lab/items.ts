import type {
  Correction,
  GraduateSummary,
  Improvement,
  JobSummary,
  OrgTypeResult,
  RunPhase,
  Score,
  WorkspaceChat,
} from '@architect/shared';
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
      detail: `Version ${version} is ready to promote`,
      target: { path: paths.improvement(improvement.runId) },
    });
  }
  return needs;
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
    attempting: 'Practising',
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

export interface OrgScores {
  /** Organizations it trained on. */
  seen: Score | null;
  /** Generated organizations it never saw. */
  unseen: Score | null;
  /** Real organizations it never saw. */
  real: Score | null;
}

function add(total: Score | null, result: OrgTypeResult): Score {
  return { pass: (total?.pass ?? 0) + result.pass, total: (total?.total ?? 0) + result.total };
}

/**
 * A final test's results by kind of organization: the ones it trained on, generated ones it
 * never saw, and real ones it never saw. A kind with no tasks is null: not measured.
 */
export function orgScores(perOrg: readonly OrgTypeResult[]): OrgScores {
  const scores: OrgScores = { seen: null, unseen: null, real: null };
  for (const result of perOrg) {
    if (result.total === 0) continue;
    const kind = result.seen ? 'seen' : result.synthetic ? 'unseen' : 'real';
    scores[kind] = add(scores[kind], result);
  }
  return scores;
}
