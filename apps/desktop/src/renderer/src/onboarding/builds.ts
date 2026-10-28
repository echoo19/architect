import type { StudentBuild } from '@architect/shared';

/** What a build is next to the one recommended here: "Recommended", "Smaller" or "Larger". */
export function sizeWord(build: StudentBuild, recommended: StudentBuild): string {
  if (build.key === recommended.key) return 'Recommended';
  return build.downloadBytes < recommended.downloadBytes ? 'Smaller' : 'Larger';
}
