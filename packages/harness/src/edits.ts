import type { FileEdit, Harness } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashFiles } from './hash';
import { normalizeEditPath, SYSTEM_PATH } from './paths';
import { harnessToFiles } from './serialize';
import { validateHarnessFiles } from './validate';

/**
 * Applies a mentor's change set to a harness and returns the new harness; the input is left
 * untouched. Every path is checked first and a path outside the harness surface throws a
 * `harness_surface` GuardError before anything is applied. The edited files must then validate
 * as a whole, otherwise a HarnessValidationError lists what to fix. The version and parent stay
 * as they were: `HarnessVersions.save` assigns those.
 */
export function applyEdits(harness: Harness, edits: readonly FileEdit[]): Harness {
  const targets = edits.map((edit) => ({ edit, path: normalizeEditPath(edit.path) }));
  // The mentor is shown the default settings files, so it may also delete them to reset a file.
  const files = harnessToFiles(harness, { includeDefaults: true });
  const problems: string[] = [];

  for (const { edit, path } of targets) {
    if (edit.op === 'write') {
      files[path] = edit.content;
    } else if (path === SYSTEM_PATH) {
      problems.push('system.md: cannot be deleted. Every harness needs a system prompt.');
    } else if (Object.hasOwn(files, path)) {
      delete files[path];
    } else {
      problems.push(`${path}: cannot be deleted because it does not exist.`);
    }
  }
  if (problems.length > 0) throw new HarnessValidationError(problems);

  const result = validateHarnessFiles(files, harness.meta);
  if (!result.ok) throw new HarnessValidationError(result.errors);
  const edited = result.harness;
  return { ...edited, meta: { ...edited.meta, hash: hashFiles(harnessToFiles(edited)) } };
}
