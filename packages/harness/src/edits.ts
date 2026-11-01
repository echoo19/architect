import { isReservedToolName, type FileEdit, type Harness } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashFiles } from './hash';
import { INSTRUCTIONS_PATH, normalizeEditPath } from './paths';
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
    } else if (path === INSTRUCTIONS_PATH) {
      problems.push(
        `${INSTRUCTIONS_PATH}: cannot be deleted. Every harness needs its instructions.`,
      );
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
  const reserved = newReservedHelpers(edited, harness);
  if (reserved.length > 0) throw new HarnessValidationError(reserved);
  return { ...edited, meta: { ...edited.meta, hash: hashFiles(harnessToFiles(edited)) } };
}

/**
 * The helpers a harness newly names after a reserved tool that isn't built in: `ask_teammate`,
 * which a team's lead asks its teammates with (decision 100). One a harness already had stays,
 * so an agent made before the name was reserved still opens and runs as it did.
 */
export function newReservedHelpers(harness: Harness, before: Harness | null): string[] {
  return harness.tools
    .filter((tool) => isReservedToolName(tool.name))
    .filter((tool) => !before?.tools.some((kept) => kept.name === tool.name))
    .map(
      (tool) =>
        `tools/${tool.name}.json: "${tool.name}" is the tool a team's lead asks its teammates with. Pick a different name.`,
    );
}
