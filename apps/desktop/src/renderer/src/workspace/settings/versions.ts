import type { EvaluationStatus, GraduateVersion } from '@architect/shared';

/** How a version's own locked test came out, in the words every screen uses. */
export const EVALUATION_LABELS: Record<EvaluationStatus, string> = {
  ready: 'Ready',
  experimental: 'Experimental',
  unevaluated: 'Not evaluated',
};

/** What can be done with a version from the list: make it active, or go back to it. */
export type VersionMove = 'promote' | 'rollback';

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
      ? `from v${version.parent}`
      : `from v${version.parent}, imported`;
  }
  return version.origin === undefined ? null : 'imported';
}

/** The score from the version's own report, when a locked test measured it. */
export function versionScore(version: GraduateVersion): { pass: number; total: number } | null {
  return version.manifest.evidence.summary?.score ?? null;
}
