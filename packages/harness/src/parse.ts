import type { Example, Guardrails, HarnessMeta, HarnessTool, Skill } from '@architect/shared';
import {
  DecodingSchema,
  ExampleSchema,
  GuardrailSchema,
  GuardrailsSchema,
  HARNESS_FORMAT,
  HarnessMetaSchema,
  HarnessToolSchema,
  isBuiltinTool,
  RetrievalRuleSchema,
  RetrievalSchema,
  SkillSchema,
} from '@architect/shared';
import { errorMessage, parseJson, parseYaml } from './codec';
import { camelToSnake, isRecord, mapKeys, snakeToCamel } from './keys';
import { fileStem } from './paths';

interface Issue {
  path: readonly PropertyKey[];
  message: string;
}

interface Schema<T> {
  safeParse(
    input: unknown,
  ): { success: true; data: T } | { success: false; error: { issues: readonly Issue[] } };
}

/** The settings a file may contain, written as they appear on disk. */
const snakeKeysOf = (shape: object): string[] => Object.keys(shape).map(camelToSnake);

const META_KEYS = ['format', 'name', 'version', 'parent', 'hash'];
const SKILL_KEYS = ['name', 'summary', 'task_types'];
const TOOL_KEYS = ['name', 'description', 'parameters'];
const EXAMPLE_KEYS = ['title', 'task_types', 'messages'];
const RETRIEVAL_KEYS = snakeKeysOf(RetrievalSchema.shape);
const RULE_KEYS = snakeKeysOf(RetrievalRuleSchema.shape);
const DECODING_KEYS = snakeKeysOf(DecodingSchema.shape);
const GUARDRAILS_KEYS = snakeKeysOf(GuardrailsSchema.shape);
const REFUSAL_KEYS = snakeKeysOf(GuardrailSchema.shape);
const MESSAGE_KEYS: Record<string, string[]> = {
  system: ['role', 'content'],
  user: ['role', 'content'],
  assistant: ['role', 'content', 'tool_calls'],
  tool: ['role', 'tool_call_id', 'name', 'content'],
};
const TOOL_CALL_KEYS = ['id', 'name', 'arguments'];

/** Settings from earlier versions of the format that are read and dropped. */
const DECODING_RETIRED_KEYS = ['seed'];

const FRONT_MATTER = /^---\n(?:([\s\S]*?)\n)?---(?:\n([\s\S]*))?$/;
const RUN_FUNCTION = /\bfunction\s+run\s*\(/;

function pathLabel(path: readonly PropertyKey[]): string {
  return path.reduce<string>((label, segment) => {
    if (typeof segment === 'number') return `${label}[${segment}]`;
    const key = camelToSnake(String(segment));
    return label === '' ? key : `${label}.${key}`;
  }, '');
}

export function check<T>(
  file: string,
  schema: Schema<T>,
  input: unknown,
  problems: string[],
): T | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  for (const issue of result.error.issues) {
    const where = pathLabel(issue.path);
    if (/received undefined$/.test(issue.message)) problems.push(`${file}: "${where}" is required`);
    else problems.push(where ? `${file}: ${where}: ${issue.message}` : `${file}: ${issue.message}`);
  }
  return undefined;
}

function checkKeys(
  file: string,
  value: Record<string, unknown>,
  allowed: readonly string[],
  problems: string[],
  where = '',
  retired: readonly string[] = [],
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key) || retired.includes(key)) continue;
    const suggestion = camelToSnake(key);
    const hint =
      suggestion !== key && allowed.includes(suggestion) ? ` Did you mean "${suggestion}"?` : '';
    problems.push(
      `${file}: unknown key "${where}${key}".${hint} Allowed keys here: ${allowed.join(', ')}.`,
    );
  }
}

function readYamlRecord(
  file: string,
  text: string,
  problems: string[],
): Record<string, unknown> | undefined {
  let raw: unknown;
  try {
    raw = parseYaml(text);
  } catch (error) {
    problems.push(`${file}: not valid YAML (${errorMessage(error)})`);
    return undefined;
  }
  if (raw === null || raw === undefined) return {};
  if (!isRecord(raw)) {
    problems.push(`${file}: expected a list of settings such as "name: value"`);
    return undefined;
  }
  return raw;
}

function readJsonRecord(
  file: string,
  text: string,
  problems: string[],
): Record<string, unknown> | undefined {
  let raw: unknown;
  try {
    raw = parseJson(text);
  } catch (error) {
    problems.push(`${file}: not valid JSON (${errorMessage(error)})`);
    return undefined;
  }
  if (!isRecord(raw)) {
    problems.push(`${file}: expected a JSON object`);
    return undefined;
  }
  return raw;
}

/** harness.yaml. `version` and `hash` are derived values, so a hand-made file may leave them out. */
export function parseMeta(text: string, problems: string[]): HarnessMeta | undefined {
  const file = 'harness.yaml';
  const raw = readYamlRecord(file, text, problems);
  if (!raw) return undefined;
  checkKeys(file, raw, META_KEYS, problems);
  if (raw['format'] !== HARNESS_FORMAT) {
    problems.push(
      `${file}: format ${JSON.stringify(raw['format'] ?? null)} is not supported; this version reads format ${HARNESS_FORMAT}`,
    );
    return undefined;
  }
  return check(file, HarnessMetaSchema, { version: 0, hash: '', ...raw }, problems);
}

export function parseSkill(path: string, text: string, problems: string[]): Skill | undefined {
  const match = FRONT_MATTER.exec(text);
  if (!match) {
    problems.push(
      `${path}: has no front matter. Start the file with a block between "---" lines that sets name and summary.`,
    );
    return undefined;
  }
  const front = readYamlRecord(`${path} front matter`, match[1] ?? '', problems);
  if (!front) return undefined;
  checkKeys(path, front, SKILL_KEYS, problems);
  return check(
    path,
    SkillSchema,
    {
      ...(mapKeys(front, snakeToCamel) as Record<string, unknown>),
      slug: fileStem(path),
      body: match[2] ?? '',
    },
    problems,
  );
}

export function parseTool(
  stem: string,
  manifest: string | undefined,
  code: string | undefined,
  problems: string[],
): HarnessTool | undefined {
  const manifestFile = `tools/${stem}.json`;
  const codeFile = `tools/${stem}.js`;
  if (manifest === undefined) {
    problems.push(
      `${codeFile}: has no manifest. Add ${manifestFile} with the tool's name, description and parameters.`,
    );
  }
  if (code === undefined) {
    problems.push(
      `${manifestFile}: has no code. Add ${codeFile} that defines function run(args, ctx).`,
    );
  }
  if (manifest === undefined || code === undefined) return undefined;

  const before = problems.length;
  if (isBuiltinTool(stem)) {
    problems.push(`${manifestFile}: "${stem}" is a built-in tool name. Pick a different name.`);
  }
  if (!RUN_FUNCTION.test(code)) {
    problems.push(`${codeFile}: does not define function run(args, ctx), which every tool needs.`);
  }
  const raw = readJsonRecord(manifestFile, manifest, problems);
  if (!raw) return undefined;
  checkKeys(manifestFile, raw, TOOL_KEYS, problems);
  // The file name is the tool name, which also keeps names unique.
  if (raw['name'] !== stem) {
    problems.push(
      `${manifestFile}: name must match the file name, so it should be "${stem}" (it is ${JSON.stringify(raw['name'] ?? null)}).`,
    );
  }
  const tool = check(
    manifestFile,
    HarnessToolSchema,
    { name: raw['name'], description: raw['description'], parameters: raw['parameters'], code },
    problems,
  );
  return problems.length === before ? tool : undefined;
}

export function parseExample(path: string, text: string, problems: string[]): Example | undefined {
  const raw = readJsonRecord(path, text, problems);
  if (!raw) return undefined;
  checkKeys(path, raw, EXAMPLE_KEYS, problems);
  const messages = Array.isArray(raw['messages'])
    ? raw['messages'].map((message, index) => messageFromDisk(path, message, index, problems))
    : raw['messages'];
  return check(
    path,
    ExampleSchema,
    { slug: fileStem(path), title: raw['title'], taskTypes: raw['task_types'] ?? [], messages },
    problems,
  );
}

function messageFromDisk(
  file: string,
  message: unknown,
  index: number,
  problems: string[],
): unknown {
  if (!isRecord(message)) return message;
  const where = `messages[${index}].`;
  const role = typeof message['role'] === 'string' ? message['role'] : '';
  checkKeys(file, message, MESSAGE_KEYS[role] ?? ['role'], problems, where);
  const { tool_calls: toolCalls, tool_call_id: toolCallId, ...rest } = message;
  if (Array.isArray(toolCalls)) {
    toolCalls.forEach((call, callIndex) => {
      if (isRecord(call))
        checkKeys(file, call, TOOL_CALL_KEYS, problems, `${where}tool_calls[${callIndex}].`);
    });
  }
  return { ...rest, toolCalls, toolCallId };
}

export function parseRetrieval(
  text: string | undefined,
  problems: string[],
): ReturnType<typeof RetrievalSchema.parse> | undefined {
  const file = 'retrieval.yaml';
  if (text === undefined) return RetrievalSchema.parse({});
  const raw = readYamlRecord(file, text, problems);
  if (!raw) return undefined;
  checkKeys(file, raw, RETRIEVAL_KEYS, problems);
  if (Array.isArray(raw['rules'])) {
    raw['rules'].forEach((rule, index) => {
      if (isRecord(rule)) checkKeys(file, rule, RULE_KEYS, problems, `rules[${index}].`);
    });
  }
  return check(file, RetrievalSchema, mapKeys(raw, snakeToCamel), problems);
}

export function parseDecoding(
  text: string | undefined,
  problems: string[],
): ReturnType<typeof DecodingSchema.parse> | undefined {
  const file = 'decoding.yaml';
  if (text === undefined) return DecodingSchema.parse({});
  const raw = readYamlRecord(file, text, problems);
  if (!raw) return undefined;
  checkKeys(file, raw, DECODING_KEYS, problems, '', DECODING_RETIRED_KEYS);
  return check(file, DecodingSchema, mapKeys(raw, snakeToCamel), problems);
}

export function parseGuardrails(
  text: string | undefined,
  problems: string[],
): Guardrails | undefined {
  const file = 'guardrails.yaml';
  if (text === undefined) return GuardrailsSchema.parse({});
  const raw = readYamlRecord(file, text, problems);
  if (!raw) return undefined;
  checkKeys(file, raw, GUARDRAILS_KEYS, problems);
  if (Array.isArray(raw['refuse'])) {
    raw['refuse'].forEach((rule, index) => {
      if (isRecord(rule)) checkKeys(file, rule, REFUSAL_KEYS, problems, `refuse[${index}].`);
    });
  }
  return check(file, GuardrailsSchema, mapKeys(raw, snakeToCamel), problems);
}
