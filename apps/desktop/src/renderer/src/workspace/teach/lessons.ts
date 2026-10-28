import {
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
  procedure: 'A preference or procedure',
  source: 'A missing fact or source',
  weakness: 'A weakness to train',
  ambiguous: 'An ambiguous request',
  invalid: "Something it can't verify",
};

/** The same kinds in a word or two, for a list. */
export const KIND_SHORT: Record<CorrectionKind, string> = {
  procedure: 'Procedure',
  source: 'Fact or source',
  weakness: 'Weakness',
  ambiguous: 'Ambiguous',
  invalid: "Can't verify",
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
      return { title: 'Practice on requests like this one' };
    case 'ambiguous':
      return {
        title: 'None until you say which you meant',
        ...(proposal.question === undefined ? {} : { detail: proposal.question }),
      };
    case 'invalid':
      return { title: 'None' };
  }
}

/** Whether a lesson needs training, in a few words. */
export const TRAINING_NEED: Record<CorrectionKind, string> = {
  procedure: 'Not needed',
  source: 'Not needed',
  weakness: 'Yes, through Improve agent',
  ambiguous: 'Not yet',
  invalid: 'No',
};

/** Where a flagged answer stands, in a few words. */
export function correctionStatus(correction: Correction, improving: boolean): string {
  switch (correction.status) {
    case 'proposed':
      return 'Waiting for you';
    case 'queued':
      return improving && correction.runId !== undefined ? 'Being taught' : 'In the queue';
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

/** "1 waiting for you · 2 in the queue", or null when nothing is open. */
export function flaggedSummary(corrections: readonly Correction[]): string | null {
  const waiting = corrections.filter((correction) => correction.status === 'proposed').length;
  const queued = corrections.filter((correction) => correction.status === 'queued').length;
  const parts = [
    waiting > 0 && `${waiting} waiting for you`,
    queued > 0 && `${queued} in the queue`,
  ].filter(Boolean);
  return parts.length === 0 ? null : parts.join(' · ');
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

/** "$5 of Spark and 4 h", with compute when an improvement may train weights. */
export function budgetLine(budget: Budget, mentor: string): string {
  const compute =
    budget.maxComputeUsd === undefined ? '' : `, ${formatUsd(budget.maxComputeUsd)} of compute`;
  return `${formatUsd(budget.maxMentorUsd)} of ${mentor}${compute} and ${formatDuration(budget.maxWallMinutes * 60_000)}`;
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

/**
 * Why a lesson couldn't be proposed, in the app's words. The engine's leak check names the
 * locked test, which every screen calls the final test; its other reasons read as they are.
 */
export function proposeFailure(message: string, mentor: string): string {
  if (/payload matched \d+ locked test tasks?/.test(message)) {
    return `Nothing was sent: the exchange quotes a task from its final test, which ${mentor} may never see.`;
  }
  return message;
}

/** A request shortened to fit one line of a subtitle. */
export function shortRequest(text: string, limit = 64): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= limit ? line : `${line.slice(0, limit - 1).trimEnd()}…`;
}
