import {
  CodedError,
  INSTRUCTION_KINDS,
  TEACHABLE_KINDS,
  type Budget,
  type Correction,
  type CorrectionKind,
  type CorrectionProposal,
  type Improvement,
  type RunStatus,
} from '@architect/shared';
import { formatDuration, formatUsd } from '../../lib/format';

/** What each kind of lesson is, in the person's words. */
export const KIND_LABELS: Record<CorrectionKind, string> = {
  procedure: 'Rule',
  source: 'Missing fact',
  weakness: 'Needs practice',
  ambiguous: 'Unclear request',
  invalid: "Can't be checked",
};

/** A lesson that can join the teaching queue. */
export function canQueue(kind: CorrectionKind): boolean {
  return TEACHABLE_KINDS.includes(kind);
}

/** A lesson that can take effect as an instruction, with no training. */
export function canApply(proposal: CorrectionProposal): boolean {
  return INSTRUCTION_KINDS.includes(proposal.kind) && proposal.instruction !== undefined;
}

/** The change a lesson would make to the agent: a heading, and what it is. */
export function lessonChange(proposal: CorrectionProposal): { title: string; detail?: string } {
  switch (proposal.kind) {
    case 'procedure':
    case 'source':
      return { title: 'Adds to its instructions', detail: proposal.instruction };
    case 'weakness':
      return { title: 'Practice on tasks like this one' };
    case 'ambiguous':
      return {
        title: 'None until you say which you meant',
        ...(proposal.question === undefined ? {} : { detail: proposal.question }),
      };
    case 'invalid':
      return { title: 'None' };
  }
}

/** Whether a lesson needs practice, in a few words. */
export const TRAINING_NEED: Record<CorrectionKind, string> = {
  procedure: 'No, a rule is enough',
  source: 'No, a rule is enough',
  weakness: 'Yes, Improve will practice it',
  ambiguous: 'Not until you say which you meant',
  invalid: 'No',
};

/** Where a flagged answer stands, in a few words. */
export function correctionStatus(correction: Correction, improving: boolean): string {
  switch (correction.status) {
    case 'proposed':
      return 'To review';
    case 'queued':
      return improving && correction.runId !== undefined
        ? 'Being taught'
        : 'Saved for next improve';
    case 'applied':
      return `In version ${correction.candidateVersion ?? '?'}`;
    case 'used':
      return `Taught in version ${correction.candidateVersion ?? '?'}`;
    case 'discarded':
      return 'Discarded';
  }
}

/** Flagged answers still open: proposed and waiting for the person, or in the queue. */
export function openCorrections(corrections: readonly Correction[]): Correction[] {
  return corrections.filter(
    (correction) => correction.status === 'proposed' || correction.status === 'queued',
  );
}

/** "3 flagged answers · 1 to review", or null when nothing is open. */
export function flaggedSummary(corrections: readonly Correction[]): string | null {
  const open = openCorrections(corrections).length;
  if (open === 0) return null;
  const waiting = corrections.filter((correction) => correction.status === 'proposed').length;
  const count = `${open} flagged ${open === 1 ? 'answer' : 'answers'}`;
  return waiting > 0 ? `${count} · ${waiting} to review` : count;
}

const ACTIVE: ReadonlySet<RunStatus> = new Set([
  'queued',
  'running',
  'paused',
  'stopping',
  'testing',
]);

/** The improvement still going, if any: the newest, while it hasn't ended. */
export function runningImprovement(improvements: readonly Improvement[]): Improvement | null {
  const newest = improvements[0];
  return newest !== undefined && ACTIVE.has(newest.status) ? newest : null;
}

/** A time limit in words: "4 hours", "90 minutes", "1 h 30 min". */
function spelled(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  if (minutes % 60 === 0) return `${minutes / 60} ${minutes === 60 ? 'hour' : 'hours'}`;
  return formatDuration(minutes * 60_000);
}

/** "up to $5 and 4 hours": what an improvement may spend, with compute where weights may train. */
export function budgetLine(budget: Budget): string {
  const compute =
    budget.maxComputeUsd === undefined ? '' : ` and ${formatUsd(budget.maxComputeUsd)} of compute`;
  return `up to ${formatUsd(budget.maxMentorUsd)}${compute} and ${spelled(budget.maxWallMinutes)}`;
}

/**
 * Every cap an improvement keeps to, as the dialog says them: it stops at the first one reached,
 * and none is ever passed.
 */
export function capsLine(budget: Budget, mentor: string): string {
  const rounds = budget.maxRounds === 1 ? '1 round' : `${budget.maxRounds} rounds`;
  const compute =
    budget.maxComputeUsd === undefined ? '' : `, ${formatUsd(budget.maxComputeUsd)} of compute`;
  return `Stops at ${formatUsd(budget.maxMentorUsd)} of ${mentor}${compute}, ${spelled(budget.maxWallMinutes)} or ${rounds}, whichever comes first.`;
}

/** "1 lesson", "3 lessons". */
export function lessonCount(count: number): string {
  return count === 1 ? '1 lesson' : `${count} lessons`;
}

/**
 * The evidence the person gave, as the mentor reads it: the files it should have used and the
 * rows they pasted. Undefined when they gave none.
 */
export function evidenceText(files: readonly string[], rows: string): string | undefined {
  const parts = [
    files.length > 0 &&
      `Files it should have used: ${files.map((file) => `data/${file}`).join(', ')}`,
    rows.trim() !== '' && `Rows it should have used:\n${rows.trim()}`,
  ].filter((part): part is string => typeof part === 'string');
  return parts.length === 0 ? undefined : parts.join('\n');
}

/** Why a lesson couldn't be proposed, and whether sending it again could help. */
export interface ProposeFailure {
  title: string;
  text: string;
  /** The engine's own message, for whoever opens Details. */
  details?: string;
  retry: boolean;
}

/**
 * Why a lesson couldn't be proposed, in the app's words, from the guard that refused it. The
 * leak check refuses the same exchange however it is described, so it reads as a refusal and
 * isn't offered again; a cost over the cap says what to shorten; any other reason reads as it
 * is, with the note kept to send again. The engine's own message always goes with it.
 */
export function proposeFailure(error: Error, mentor: string, capUsd: number): ProposeFailure {
  const code = error instanceof CodedError ? error.code : undefined;
  if (code === 'guard_split') {
    return {
      title: 'Not shared',
      text: `It matches a question from the final test, which ${mentor} must never see.`,
      details: error.message,
      retry: false,
    };
  }
  if (code === 'guard_budget') {
    return {
      title: 'Too long to review',
      text: `Reading it would cost more than the ${formatUsd(capUsd)} limit. Shorten your note, or flag a shorter answer.`,
      details: error.message,
      retry: true,
    };
  }
  return { title: "Couldn't propose a lesson", text: error.message, retry: true };
}

/** A request shortened to fit one line of a subtitle. */
export function shortRequest(text: string, limit = 64): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
}
