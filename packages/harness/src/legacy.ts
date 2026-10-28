import { isBuiltinTool } from '@architect/shared';
import { errorMessage, parseJson, parseYaml, stringifyJson, stringifyYaml } from './codec';
import { isRecord } from './keys';
import { splitFrontMatter } from './parse';
import { INSTRUCTIONS_PATH, LEGACY_SKILL, LEGACY_SYSTEM_PATH, skillPath } from './paths';
import { normalizeText } from './text';

const TOOL_FILE = /^tools\/([a-z][a-z0-9_]*)\.(json|js)$/;

/** True when files are laid out the format 1 way: `system.md`, or a skill in a single file. */
export function hasFormat1Layout(files: Readonly<Record<string, string>>): boolean {
  return Object.keys(files).some((path) => path === LEGACY_SYSTEM_PATH || LEGACY_SKILL.test(path));
}

/**
 * The files of a format 1 harness, laid out as format 2. `system.md` becomes `AGENTS.md`, and
 * each `skills/<slug>.md` (front matter `name`, `summary` and `task_types`) becomes
 * `skills/<slug>/SKILL.md` with `name: <slug>` and `description: <summary>`; the old name, a
 * title, opens the steps as a heading, and task types, which nothing read, are dropped. A helper
 * tool named like one of today's built-in tools (format 1 allowed `grep` or `run`) is renamed
 * `<name>_helper`, so the harness still loads. Every other file is the same in both formats.
 * Problems are reported under the old file names.
 */
export function migrateFormat1(
  files: Readonly<Record<string, string>>,
  problems: string[],
): Record<string, string> {
  const renamed = renamedTools(files);
  const migrated: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) {
    const skill = LEGACY_SKILL.exec(path);
    const tool = TOOL_FILE.exec(path);
    if (path === LEGACY_SYSTEM_PATH) {
      if (Object.hasOwn(files, INSTRUCTIONS_PATH)) {
        problems.push(
          `${LEGACY_SYSTEM_PATH}: the folder also has ${INSTRUCTIONS_PATH}. Keep the instructions in ${INSTRUCTIONS_PATH} only.`,
        );
        continue;
      }
      migrated[INSTRUCTIONS_PATH] = text;
    } else if (skill) {
      const converted = legacySkill(path, text, problems);
      if (converted !== undefined) migrated[skillPath(skill[1] ?? '')] = converted;
    } else if (tool && renamed.has(tool[1] ?? '')) {
      const name = renamed.get(tool[1] ?? '') ?? '';
      migrated[`tools/${name}.${tool[2]}`] = tool[2] === 'json' ? renameManifest(text, name) : text;
    } else {
      migrated[path] = text;
    }
  }
  return migrated;
}

/** Each helper whose name is now a built-in tool's, with a free name for it. */
function renamedTools(files: Readonly<Record<string, string>>): Map<string, string> {
  const names = new Set(
    Object.keys(files).flatMap((path) => {
      const tool = TOOL_FILE.exec(path);
      return tool ? [tool[1] ?? ''] : [];
    }),
  );
  const renamed = new Map<string, string>();
  for (const name of names) {
    if (!isBuiltinTool(name)) continue;
    let next = `${name}_helper`;
    for (let n = 2; names.has(next); n += 1) next = `${name}_helper${n}`;
    names.add(next);
    renamed.set(name, next);
  }
  return renamed;
}

/** A tool manifest with its name changed; one that isn't JSON is left for validation to report. */
function renameManifest(text: string, name: string): string {
  try {
    const manifest = parseJson(text);
    return isRecord(manifest) ? stringifyJson({ ...manifest, name }) : text;
  } catch {
    return text;
  }
}

function legacySkill(path: string, text: string, problems: string[]): string | undefined {
  const parts = splitFrontMatter(normalizeText(text));
  if (!parts) {
    problems.push(`${path}: has no front matter between "---" lines.`);
    return undefined;
  }
  let front: unknown;
  try {
    front = parts.front.trim() === '' ? {} : parseYaml(parts.front);
  } catch (error) {
    problems.push(`${path} front matter: not valid YAML (${errorMessage(error)})`);
    return undefined;
  }
  const title = isRecord(front) ? front['name'] : undefined;
  const summary = isRecord(front) ? front['summary'] : undefined;
  if (typeof title !== 'string' || typeof summary !== 'string') {
    problems.push(`${path}: a format 1 skill needs a name and a summary in its front matter.`);
    return undefined;
  }
  const name = path.slice('skills/'.length, -'.md'.length);
  const body = parts.body.trimStart();
  const heading = title.trim() === '' ? '' : `# ${title.trim()}\n\n`;
  return `---\n${stringifyYaml({ name, description: summary })}---\n${heading}${body}`;
}
