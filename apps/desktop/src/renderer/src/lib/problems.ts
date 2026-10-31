import { CodedError, type ErrorCode } from '@architect/shared';

/** What a screen says about a failure: one plain cause, and whether asking again can help. */
export interface Problem {
  /** One plain sentence on what happened, with no ids, hashes, paths or inner parts named. */
  cause: string;
  /** What helps when asking again can: said after the cause. Absent when it can't. */
  next?: string;
}

/*
 * The failures that carry a code, in the words a screen leads with. The precise message stays
 * available to whoever opens Details.
 */
const PROBLEMS: Record<ErrorCode, Problem> = {
  run_not_found: { cause: 'This run is gone.' },
  job_not_found: { cause: 'This job is gone.' },
  agent_not_found: { cause: 'This agent is gone.' },
  chat_not_found: { cause: 'This chat is gone.' },
  draft_not_found: { cause: 'This conversation is gone.' },
  record_not_found: { cause: 'This record is gone.' },
  version_modified: { cause: 'This version was changed after it was made.' },
  not_a_package: {
    cause: "That isn't an Architect agent.",
    next: 'Check the name and try again.',
  },
  not_a_job: {
    cause: "That isn't a job file.",
    next: "A job folder holds job.json, tasks.jsonl and the files the job works on, in a data folder or in each organization's orgs/<id>/data folder. Choose its job.json.",
  },
  package_changed: {
    cause: 'This package was edited after it was made.',
    next: 'Ask whoever sent it for a new copy.',
  },
  disk_full: {
    cause: "There isn't enough free space on this computer.",
    next: 'Free some space, then try again.',
  },
  guard_split: { cause: 'This matches a question from the final test.' },
  split_sealed: { cause: 'These tasks are sealed, so only how many there are is shown.' },
  guard_budget: { cause: 'That would cost more than the limit allows.' },
  rule_unconfirmed: {
    cause: "The rule for this job isn't confirmed yet.",
    next: 'Check it on the job page, confirm it, then start training.',
  },
  rule_changed: {
    cause: 'The records or the rule changed after the rule was confirmed.',
    next: 'Describe the job again, so the tasks are made from the records as they are now.',
  },
  study_unconfirmed: {
    cause: "The study of this job's organizations isn't confirmed yet.",
    next: 'Read the brief on the job page, confirm it, then start training.',
  },
  experiment_not_found: { cause: 'This experiment is gone.' },
  experiment_frozen: {
    cause: 'This experiment is preregistered, so its arms, seeds and caps stay as they are.',
    next: 'Plan a new experiment to try other settings.',
  },
  experiment_state: {
    cause: "This experiment can't do that right now.",
    next: 'Wait for what it is doing to finish, then try again.',
  },
  process_starting: {
    cause: 'Architect is still starting up.',
    next: 'Try again in a moment.',
  },
  process_restarting: {
    cause: 'Architect had a problem and is starting again.',
    next: 'Try again in a moment.',
  },
  process_failed: {
    cause: "Architect couldn't get ready.",
    next: 'Try again, or restart Architect if it keeps happening.',
  },
  process_closing: { cause: 'Architect is closing.' },
};

/** The plain words for a failure that carries a code, or null for every other failure. */
export function problemOf(error: Error): Problem | null {
  return error instanceof CodedError ? PROBLEMS[error.code] : null;
}

/** True when asking again can't help: what was asked for is gone, or Architect is closing. */
export function isFinal(problem: Problem): boolean {
  return problem.next === undefined;
}
