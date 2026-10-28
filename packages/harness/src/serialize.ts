import type {
  ChatMessage,
  Example,
  Harness,
  HarnessMeta,
  HarnessTool,
  Skill,
} from '@architect/shared';
import { DecodingSchema, GuardrailsSchema, RetrievalSchema } from '@architect/shared';
import { stringifyJson, stringifyYaml } from './codec';
import { sortKeys } from './keys';
import {
  DECODING_PATH,
  examplePath,
  GUARDRAILS_PATH,
  INSTRUCTIONS_PATH,
  RETRIEVAL_PATH,
  skillPath,
  toolCodePath,
  toolManifestPath,
} from './paths';
import { compareText, normalizeText } from './text';

export interface HarnessFilesOptions {
  /**
   * Also emit retrieval.yaml, decoding.yaml and guardrails.yaml when they hold the defaults.
   * Folders on disk leave them out; the mentor's view includes them so it can see every setting.
   */
  includeDefaults?: boolean;
}

const DEFAULT_RETRIEVAL = RetrievalSchema.parse({});
const DEFAULT_DECODING = DecodingSchema.parse({});
const DEFAULT_GUARDRAILS = GuardrailsSchema.parse({});

/**
 * The files of a harness folder, keyed by relative path with forward slashes, in path order.
 * `harness.yaml` is not included: it is managed by the runner and excluded from the hash.
 * Optional files that would be empty or default are left out, so a blank harness is one file.
 * Skills, tools and examples are written in name order; reading them back gives the same order.
 */
export function harnessToFiles(
  harness: Harness,
  options: HarnessFilesOptions = {},
): Record<string, string> {
  const files: Record<string, string> = { [INSTRUCTIONS_PATH]: normalizeText(harness.system) };

  for (const skill of harness.skills) files[skillPath(skill.name)] = skillToFile(skill);
  for (const tool of harness.tools) {
    files[toolManifestPath(tool.name)] = toolManifestToFile(tool);
    files[toolCodePath(tool.name)] = normalizeText(tool.code);
  }
  for (const example of harness.examples) files[examplePath(example.slug)] = exampleToFile(example);

  const emit = (path: string, value: unknown, defaults: unknown, render: () => string): void => {
    if (options.includeDefaults || !sameJson(value, defaults)) files[path] = render();
  };
  emit(RETRIEVAL_PATH, harness.retrieval, DEFAULT_RETRIEVAL, () => retrievalToFile(harness));
  emit(DECODING_PATH, harness.decoding, DEFAULT_DECODING, () => decodingToFile(harness));
  emit(GUARDRAILS_PATH, harness.guardrails, DEFAULT_GUARDRAILS, () => guardrailsToFile(harness));

  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => compareText(a, b)));
}

/** Each skill's SKILL.md as the harness folder holds it, by its path, in name order. */
export function skillFiles(harness: Harness): Record<string, string> {
  return Object.fromEntries(
    [...harness.skills]
      .sort((a, b) => compareText(a.name, b.name))
      .map((skill) => [skillPath(skill.name), skillToFile(skill)]),
  );
}

export function metaToFile(meta: HarnessMeta): string {
  return stringifyYaml({
    format: meta.format,
    name: meta.name,
    version: meta.version,
    ...(meta.parent === undefined ? {} : { parent: meta.parent }),
    hash: meta.hash,
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function skillToFile(skill: Skill): string {
  const front = stringifyYaml({ name: skill.name, description: skill.description });
  return `---\n${front}---\n${normalizeText(skill.body)}`;
}

function toolManifestToFile(tool: HarnessTool): string {
  return stringifyJson({
    name: tool.name,
    description: tool.description,
    parameters: sortKeys(tool.parameters),
  });
}

function exampleToFile(example: Example): string {
  return stringifyJson({
    title: example.title,
    ...(example.taskTypes.length > 0 ? { task_types: example.taskTypes } : {}),
    messages: example.messages.map(messageToDisk),
  });
}

function messageToDisk(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case 'system':
    case 'user':
      return { role: message.role, content: normalizeText(message.content) };
    case 'assistant':
      return {
        role: 'assistant',
        content: normalizeText(message.content),
        ...(message.toolCalls === undefined
          ? {}
          : {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                name: call.name,
                arguments: sortKeys(call.arguments),
              })),
            }),
      };
    case 'tool':
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        name: message.name,
        content: normalizeText(message.content),
      };
  }
}

function retrievalToFile({ retrieval }: Harness): string {
  return stringifyYaml({
    list_skills: retrieval.listSkills,
    max_loaded_skills: retrieval.maxLoadedSkills,
    max_examples: retrieval.maxExamples,
    rules: retrieval.rules.map((rule) => ({
      when_any: rule.whenAny,
      ...(rule.loadSkills.length > 0 ? { load_skills: rule.loadSkills } : {}),
      ...(rule.loadExamples.length > 0 ? { load_examples: rule.loadExamples } : {}),
    })),
  });
}

function decodingToFile({ decoding }: Harness): string {
  return stringifyYaml({
    temperature: decoding.temperature,
    top_p: decoding.topP,
    top_k: decoding.topK,
    max_steps: decoding.maxSteps,
    max_output_tokens: decoding.maxOutputTokens,
    thinking: decoding.thinking,
  });
}

function guardrailsToFile({ guardrails }: Harness): string {
  return stringifyYaml({
    refuse: guardrails.refuse.map((rule) => ({
      task_type: rule.taskType,
      when_any: rule.whenAny,
      reason: rule.reason,
    })),
  });
}
