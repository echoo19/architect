import type { EvaluationStatus, GraduateVersion } from '@architect/shared';
import { formatPercent } from '../../lib/format';

/** How a version's own final test came out, in the words every screen uses. */
export const EVALUATION_LABELS: Record<EvaluationStatus, string> = {
  ready: 'Passed its final test',
  experimental: 'Below its target',
  // A version with a score on the check tasks still hasn't taken the final test this names.
  unevaluated: 'No final test yet',
};

/** What can be done with a version from the list: make it active, or go back to it. */
export type VersionMove = 'promote' | 'rollback';

/** What each move is called on its button and in its dialog. */
export const MOVE_WORDS: Record<
  VersionMove,
  { action: string; title: (version: number) => string; confirm: (version: number) => string }
> = {
  promote: {
    action: 'Use this version',
    title: (version) => `Use version ${version}?`,
    confirm: (version) => `Use version ${version}`,
  },
  rollback: {
    action: 'Go back to this version',
    title: (version) => `Go back to version ${version}?`,
    confirm: () => 'Go back',
  },
};

/** What a version is to the agent: the one in use, a new one waiting, or an older or newer one. */
export function standing(version: GraduateVersion, active: number | null): string {
  if (version.active) return 'In use';
  if (version.state === 'candidate') return 'New, not in use yet';
  if (version.state === 'rejected') return 'Set aside';
  return active !== null && version.version > active ? 'Newer, not in use' : 'Earlier version';
}

/**
 * Promote for a candidate or an accepted version newer than the active one, Roll back for an
 * accepted version older than it, nothing for the active version or a rejected one.
 */
export function moveFor(version: GraduateVersion, active: number | null): VersionMove | null {
  if (version.active || version.state === 'rejected') return null;
  if (version.state === 'candidate') return 'promote';
  if (active === null || version.version > active) return 'promote';
  return 'rollback';
}

/** "Oct 28, 2026", kept on one line. */
export function versionDate(iso: string): string {
  return new Date(iso)
    .toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    .replaceAll(' ', ' ');
}

/** Where a version came from: the local version it was made from, or another computer. */
export function versionOrigin(version: GraduateVersion): string | null {
  if (version.parent !== undefined) {
    return version.origin === undefined
      ? `from version ${version.parent}`
      : `from version ${version.parent}, imported`;
  }
  return version.origin === undefined ? null : 'imported';
}

/** The score from the version's own report, when a locked test measured it. */
export function versionScore(version: GraduateVersion): { pass: number; total: number } | null {
  return version.manifest.evidence.summary?.score ?? null;
}

/**
 * Why a version is experimental, in a few words: below the job's target on its final test, or
 * tested on a hosted copy. Every other evaluation is its own label.
 */
export function evaluationNote(version: GraduateVersion): string {
  const { summary } = version.manifest.evidence;
  if (version.evaluation !== 'experimental' || !summary) {
    return EVALUATION_LABELS[version.evaluation];
  }
  return summary.passRate.met
    ? 'Final test run online'
    : `Below its ${Math.round(summary.passRate.target * 100)}% target`;
}

/**
 * What to know before promoting a version its own final test didn't vouch for: that it hasn't
 * taken one, that it fell short of the job's target, or that it took it on a hosted copy. Null
 * for a version that met its target here.
 */
export function promoteCaution(version: GraduateVersion): string | null {
  const { summary } = version.manifest.evidence;
  const number = version.version;
  if (version.evaluation === 'unevaluated') return `Version ${number} hasn't taken a final test.`;
  if (version.evaluation !== 'experimental') return null;
  if (!summary) return `Version ${number} is experimental.`;
  if (!summary.passRate.met) {
    return `Version ${number} fell short on its final test: ${formatPercent(summary.score)} passed, ${Math.round(summary.passRate.target * 100)}% needed.`;
  }
  return `Version ${number} took its final test online, not on a computer like this one.`;
}
