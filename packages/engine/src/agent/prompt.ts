import type { Example, Guardrail, Harness, Skill } from '@architect/shared';
import type { AgentFile } from '../files/agent-files';
import { count } from '../files/text';

/** `task` runs a task for training and tests; `chat` works with a person in the workspace. */
export type AgentMode = 'task' | 'chat';

/** The agent's folder as the system prompt describes it. */
export interface FolderSummary {
  files: readonly AgentFile[];
  /** Present when the job has an `output/` folder. */
  output?: { description?: string };
}

export interface SystemPromptInput {
  harness: Harness;
  folder: FolderSummary;
  mode: AgentMode;
  /** The working date, as YYYY-MM-DD. */
  today: string;
  /** Skills loaded by retrieval rules: their full text goes in the prompt. */
  loadedSkills: readonly Skill[];
  examples: readonly Example[];
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
/** Example tool results are cut to this length: the lesson is in the calls, not the data. */
const EXAMPLE_RESULT_CHARS = 400;
const CHAT_LINE =
  'You are talking with the user directly. Reply in plain language; no ANSWER line is needed.';

/**
 * Assembles the system prompt: the standing instructions from AGENTS.md, the date, the agent's
 * files, its skills by name and description, and whatever the retrieval rules loaded. The same
 * inputs always give the same text.
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const { harness, folder, mode, today, loadedSkills, examples } = input;
  const sections = [
    harness.system.trim(),
    `Today is ${describeDay(today)}.`,
    describeFolder(folder),
  ];
  if (harness.retrieval.listSkills && harness.skills.length > 0) {
    sections.push(skillIndex(harness.skills));
  }
  for (const skill of loadedSkills) {
    sections.push(`Skill ${skill.name}, loaded for this request:\n${skill.body.trim()}`);
  }
  for (const example of examples) sections.push(renderExample(example));
  if (harness.guardrails.refuse.length > 0) sections.push(refusals(harness.guardrails.refuse));
  if (mode === 'chat') sections.push(CHAT_LINE);
  return sections.filter((section) => section !== '').join('\n\n');
}

function describeDay(today: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  const date = match
    ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
    : null;
  if (!date || date.toISOString().slice(0, 10) !== today) {
    throw new Error(`today must be a date like 2026-11-03, not "${today}".`);
  }
  return `${WEEKDAYS[date.getUTCDay()]}, ${today}`;
}

function describeFolder({ files, output }: FolderSummary): string {
  const data = files.filter((file) => file.area === 'data');
  const lines = data.map((file) => {
    const access = file.writable ? 'writable' : 'read-only';
    const about = file.description ? ` ${file.description}` : '';
    return `- ${file.path}: ${file.kind}, ${count(file.lines, 'line')}, ${access}.${about}`;
  });
  if (output) {
    const about = output.description ? ` ${output.description}` : '';
    lines.push(`- output/: a folder for files you write.${about}`);
  }
  if (lines.length === 0) return 'You have no files.';
  return ['Your files:', ...lines].join('\n');
}

function skillIndex(skills: readonly Skill[]): string {
  const lines = skills.map((skill) => `- ${skill.name}: ${skill.description}`);
  return [
    'Skills (read skills/<name>/SKILL.md for the steps before you follow one):',
    ...lines,
  ].join('\n');
}

function renderExample(example: Example): string {
  const lines = [`Example: ${example.title}`];
  for (const message of example.messages) {
    switch (message.role) {
      case 'system':
        lines.push(`System: ${message.content}`);
        break;
      case 'user':
        lines.push(`User: ${message.content}`);
        break;
      case 'assistant':
        if (message.content.trim() !== '') lines.push(`Assistant: ${message.content}`);
        for (const call of message.toolCalls ?? []) {
          lines.push(`Assistant calls ${call.name} ${JSON.stringify(call.arguments)}`);
        }
        break;
      case 'tool':
        lines.push(`${message.name} returned: ${clip(message.content, EXAMPLE_RESULT_CHARS)}`);
        break;
    }
  }
  return lines.join('\n');
}

function refusals(rules: readonly Guardrail[]): string {
  const lines = rules.map((rule) => `- ${rule.taskType}: ${rule.reason}`);
  return [
    'Refuse these kinds of requests, giving the reason instead of attempting them:',
    ...lines,
  ].join('\n');
}

function clip(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
