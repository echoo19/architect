import type { Harness, HarnessMeta } from '@architect/shared';
import { HARNESS_FORMAT, HarnessSchema, isHarnessSurfacePath } from '@architect/shared';
import { HarnessValidationError } from './errors';
import { hashHarness } from './hash';
import {
  belongsToHarness,
  DECODING_PATH,
  EXAMPLES_DIR,
  fileStem,
  GUARDRAILS_PATH,
  INSTRUCTIONS_PATH,
  itemName,
  LEGACY_SKILL,
  LEGACY_SYSTEM_PATH,
  META_PATH,
  reservedNameProblem,
  RETRIEVAL_PATH,
  SKILLS_DIR,
  skillPath,
  TOOLS_DIR,
} from './paths';
import {
  check,
  parseDecoding,
  parseExample,
  parseGuardrails,
  parseMeta,
  parseRetrieval,
  parseSkill,
  parseTool,
} from './parse';
import { byteLength, compareText, normalizeText } from './text';

/** The most a whole harness may hold, so the instructions, skills and examples stay in a small model's reach. */
export const MAX_HARNESS_BYTES = 256 * 1024;

export type ValidationResult = { ok: true; harness: Harness } | { ok: false; errors: string[] };

const NAME_HELP: Record<string, string> = {
  [SKILLS_DIR]:
    'a skill is a folder holding one SKILL.md, named with lowercase letters, digits and dashes, like skills/price-a-job/SKILL.md',
  [TOOLS_DIR]:
    'tool files are named with lowercase letters, digits and underscores, starting with a letter, like tools/invoice_total.js and tools/invoice_total.json',
  [EXAMPLES_DIR]:
    'example files are named with lowercase letters, digits and dashes, like examples/after-hours.json',
};

/** Why a format 1 name in a format 2 folder can't be read, with the name to use instead. */
function legacyNameProblem(path: string): string | undefined {
  if (path === LEGACY_SYSTEM_PATH) {
    return `${path}: format ${HARNESS_FORMAT} keeps the instructions in ${INSTRUCTIONS_PATH}. Move them there.`;
  }
  const skill = LEGACY_SKILL.exec(path);
  if (skill) {
    return `${path}: format ${HARNESS_FORMAT} keeps each skill in a folder. Move it to ${skillPath(skill[1] ?? '')}, with name and description in its front matter.`;
  }
  return undefined;
}

/**
 * Checks a harness folder's files (as read from disk or edited by the mentor) and builds the
 * harness from them. The files are in the current format; `readHarnessFiles` and the format 1
 * migration bring older folders to it first. The meta comes from `meta`, else from
 * `harness.yaml` in `files`, else a placeholder whose hash is computed from the content. Every
 * problem found is reported, each naming its file.
 */
export function validateHarnessFiles(
  input: Readonly<Record<string, string>>,
  meta?: HarnessMeta,
): ValidationResult {
  const problems: string[] = [];
  const files = Object.fromEntries(
    Object.entries(input).map(([path, text]) => [path, normalizeText(text)]),
  );

  let resolved = meta;
  let placeholder = false;
  if (!resolved) {
    const metaText = files[META_PATH];
    if (metaText === undefined) {
      resolved = { format: HARNESS_FORMAT, name: 'Harness', version: 0, hash: '' };
      placeholder = true;
    } else {
      resolved = parseMeta(metaText, problems)?.meta;
    }
  }

  const instructions = files[INSTRUCTIONS_PATH];
  if (instructions === undefined) {
    problems.push(`${INSTRUCTIONS_PATH}: missing. Every harness needs its standing instructions.`);
  } else if (instructions.trim() === '') {
    problems.push(`${INSTRUCTIONS_PATH}: is empty. Write the agent's standing instructions.`);
  }

  const skills = new Map<string, string>();
  const examples = new Map<string, string>();
  const tools = new Map<string, { manifest?: string; code?: string }>();

  for (const path of Object.keys(files).sort(compareText)) {
    const legacy = legacyNameProblem(path);
    if (legacy) {
      problems.push(legacy);
      continue;
    }
    if (!path.includes('/') || !belongsToHarness(path)) continue;
    const dir = path.split('/')[0] ?? '';
    const text = files[path] ?? '';
    if (!isHarnessSurfacePath(path)) {
      problems.push(`${path}: not a valid file name; ${NAME_HELP[dir]}.`);
      continue;
    }
    const reserved = reservedNameProblem(path);
    if (reserved) {
      problems.push(reserved);
      continue;
    }
    if (dir === SKILLS_DIR) skills.set(itemName(path), text);
    else if (dir === EXAMPLES_DIR) examples.set(fileStem(path), text);
    else {
      const entry = tools.get(fileStem(path)) ?? {};
      if (path.endsWith('.json')) entry.manifest = text;
      else entry.code = text;
      tools.set(fileStem(path), entry);
    }
  }

  const parsedSkills = [...skills].flatMap(([name, text]) => {
    return parseSkill(skillPath(name), text, problems) ?? [];
  });
  const parsedExamples = [...examples].flatMap(([slug, text]) => {
    return parseExample(`${EXAMPLES_DIR}/${slug}.json`, text, problems) ?? [];
  });
  const parsedTools = [...tools].flatMap(([name, entry]) => {
    return parseTool(name, entry.manifest, entry.code, problems) ?? [];
  });
  const retrieval = parseRetrieval(files[RETRIEVAL_PATH], problems);
  const decoding = parseDecoding(files[DECODING_PATH], problems);
  const guardrails = parseGuardrails(files[GUARDRAILS_PATH], problems);

  retrieval?.rules.forEach((rule, index) => {
    for (const name of rule.loadSkills) {
      if (!skills.has(name)) {
        problems.push(
          `retrieval.yaml: rule ${index + 1} loads skill "${name}", but ${skillPath(name)} does not exist.`,
        );
      }
    }
    for (const slug of rule.loadExamples) {
      if (!examples.has(slug)) {
        problems.push(
          `retrieval.yaml: rule ${index + 1} loads example "${slug}", but ${EXAMPLES_DIR}/${slug}.json does not exist.`,
        );
      }
    }
  });

  const size = Object.entries(files)
    .filter(([path]) => belongsToHarness(path) && path !== META_PATH)
    .reduce((total, [, text]) => total + byteLength(text), 0);
  if (size > MAX_HARNESS_BYTES) {
    problems.push(
      `harness: ${Math.ceil(size / 1024)} KB in total is over the ${MAX_HARNESS_BYTES / 1024} KB limit. Shorten or remove skills and examples.`,
    );
  }

  if (problems.length > 0 || !resolved || !retrieval || !decoding || !guardrails) {
    return { ok: false, errors: problems };
  }
  const built = check(
    'harness',
    HarnessSchema,
    {
      meta: resolved,
      system: instructions ?? '',
      skills: parsedSkills,
      tools: parsedTools,
      examples: parsedExamples,
      retrieval,
      decoding,
      guardrails,
    },
    problems,
  );
  if (!built) return { ok: false, errors: problems };
  if (placeholder) built.meta.hash = hashHarness(built);
  return { ok: true, harness: built };
}

/** Builds a harness from its files, or throws a HarnessValidationError listing every problem. */
export function filesToHarness(
  files: Readonly<Record<string, string>>,
  meta: HarnessMeta,
): Harness {
  const result = validateHarnessFiles(files, meta);
  if (!result.ok) throw new HarnessValidationError(result.errors);
  return result.harness;
}
