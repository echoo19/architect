import { createTwoFilesPatch } from 'diff';
import type { FileDiff, Harness } from '@architect/shared';
import { harnessToFiles } from './serialize';
import { compareText } from './text';

const CONTEXT_LINES = 3;

/**
 * One entry per file that was added, changed or deleted between two harnesses, sorted by path,
 * each with a unified diff. The comparison is of the folders the harnesses would write, so an
 * optional file that holds defaults counts as absent.
 */
export function diffHarness(before: Harness, after: Harness): FileDiff[] {
  const old = harnessToFiles(before);
  const next = harnessToFiles(after);
  const paths = [...new Set([...Object.keys(old), ...Object.keys(next)])].sort(compareText);

  const diffs: FileDiff[] = [];
  for (const path of paths) {
    const was = old[path];
    const now = next[path];
    if (was === now) continue;
    if (was === undefined) {
      diffs.push({
        path,
        status: 'added',
        patch: patchOf('/dev/null', `b/${path}`, '', now ?? ''),
      });
    } else if (now === undefined) {
      diffs.push({ path, status: 'deleted', patch: patchOf(`a/${path}`, '/dev/null', was, '') });
    } else {
      diffs.push({ path, status: 'modified', patch: patchOf(`a/${path}`, `b/${path}`, was, now) });
    }
  }
  return diffs;
}

function patchOf(oldName: string, newName: string, oldText: string, newText: string): string {
  const patch = createTwoFilesPatch(oldName, newName, oldText, newText, undefined, undefined, {
    context: CONTEXT_LINES,
  });
  return patch.replace(/^=+\n/, '');
}
