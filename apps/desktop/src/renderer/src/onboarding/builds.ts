import type { StudentBuild } from '@architect/shared';

/** What a build gives and gives up, in a few words, for a person choosing between them. */
export function tradeoff(build: StudentBuild): string {
  return build.key === 'glimmer-4bit' ? 'Most accurate' : 'Lighter, but less accurate';
}

/** What a build is next to the one recommended here: "Recommended", "Smaller" or "Larger". */
export function sizeWord(build: StudentBuild, recommended: StudentBuild): string {
  if (build.key === recommended.key) return 'Recommended';
  return build.downloadBytes < recommended.downloadBytes ? 'Smaller' : 'Larger';
}
