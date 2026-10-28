import type { Example, Harness, Skill } from '@architect/shared';

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

export interface Retrieved {
  skills: Skill[];
  examples: Example[];
}

export interface GuardrailMatch {
  taskType: string;
  reason: string;
}

/**
 * True when the phrase appears in the text at the start of a word, ignoring case and extra
 * spaces: "invoice" matches "Invoices" and "invoiced" but not "reinvoice".
 */
export function containsPhrase(text: string, phrase: string): boolean {
  const haystack = normalize(text);
  const needle = normalize(phrase);
  if (needle === '') return false;
  const wordStart = WORD_CHARACTER.test(needle.charAt(0));
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    if (!wordStart || at === 0 || !WORD_CHARACTER.test(haystack.charAt(at - 1))) return true;
  }
  return false;
}

/** The skills and examples the harness's retrieval rules load for a request, in rule order. */
export function selectRetrieval(harness: Harness, request: string): Retrieved {
  const { retrieval } = harness;
  const skills: Skill[] = [];
  const examples: Example[] = [];
  for (const rule of retrieval.rules) {
    if (!rule.whenAny.some((phrase) => containsPhrase(request, phrase))) continue;
    for (const name of rule.loadSkills) {
      addUpTo(
        skills,
        harness.skills.find((skill) => skill.name === name),
        retrieval.maxLoadedSkills,
      );
    }
    for (const slug of rule.loadExamples) {
      addUpTo(
        examples,
        harness.examples.find((example) => example.slug === slug),
        retrieval.maxExamples,
      );
    }
  }
  return { skills, examples };
}

/** The first guardrail whose phrases match the request; the agent refuses before the model runs. */
export function matchGuardrail(harness: Harness, request: string): GuardrailMatch | null {
  const rule = harness.guardrails.refuse.find((candidate) =>
    candidate.whenAny.some((phrase) => containsPhrase(request, phrase)),
  );
  return rule ? { taskType: rule.taskType, reason: rule.reason } : null;
}

function normalize(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function addUpTo<T>(list: T[], item: T | undefined, cap: number): void {
  if (item !== undefined && list.length < cap && !list.includes(item)) list.push(item);
}
