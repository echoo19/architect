import type { FileEdit, Harness, Intervention, Lesson } from '@architect/shared';
import { HARNESS_VALIDATION_ERROR } from './deps';
import { must } from './errors';
import { interventionOfRound } from './intervene';
import type { RunState } from './run-state';

/** Worked examples a round adds at most. */
export const MAX_WORKED_EXAMPLES = 2;
/** A tool result in a worked example's file is cut here; the prompt shows less still. */
const EXAMPLE_RESULT_CHARS = 1_200;

function clip(text: string): string {
  return text.length > EXAMPLE_RESULT_CHARS
    ? `${text.slice(0, EXAMPLE_RESULT_CHARS)}\n[cut: ${text.length - EXAMPLE_RESULT_CHARS} more characters]`
    : text;
}

/**
 * A verified lesson as a harness example file, the conversation it verified without the system
 * prompt: the request, every tool call with its result, and the answer. It shows one train task
 * done right; it is no table of answers, and it carries no rule.
 */
function exampleFile(lesson: Lesson, title: string): string {
  const episode = must(lesson.episode, 'The verified episode');
  const messages = episode.messages.flatMap((message) => {
    switch (message.role) {
      case 'system':
        return [];
      case 'user':
        return [{ role: 'user', content: message.content }];
      case 'assistant':
        return [
          {
            role: 'assistant',
            content: message.content,
            ...(message.toolCalls?.length
              ? {
                  tool_calls: message.toolCalls.map((call) => ({
                    id: call.id,
                    name: call.name,
                    arguments: call.arguments,
                  })),
                }
              : {}),
          },
        ];
      case 'tool':
        return [
          {
            role: 'tool',
            tool_call_id: message.toolCallId,
            name: message.name,
            content: clip(message.content),
          },
        ];
    }
  });
  return `${JSON.stringify({ title, task_types: [lesson.taskType], messages }, null, 2)}\n`;
}

/**
 * The intervention's change set and, when it asks for them, the round's verified lessons as
 * worked examples with a retrieval rule that loads them for its words. Throws the harness's own
 * error when the result doesn't validate.
 */
async function buildHarness(
  state: RunState,
  base: Harness,
  intervention: Intervention,
): Promise<{ harness: Harness; files: string[] }> {
  const { harness: deps } = state.ctx.deps;
  let candidate = deps.applyEdits(base, intervention.edits);
  const files = new Set(intervention.edits.map((edit) => edit.path));
  const lessons = state.ctx.store.lessons
    .list({ runId: state.ctx.runId, round: intervention.round, status: 'verified' })
    .slice(0, MAX_WORKED_EXAMPLES);
  if (intervention.workedExamples.length === 0 || lessons.length === 0) {
    return { harness: candidate, files: [...files] };
  }
  const label = (type: string) =>
    state.job.taskTypes.find((info) => info.id === type)?.label ?? type;
  const slugs = lessons.map((_, position) => `lesson-${intervention.round}-${position + 1}`);
  const examples: FileEdit[] = lessons.map((lesson, position) => ({
    op: 'write',
    path: `examples/${slugs[position]}.json`,
    content: exampleFile(lesson, `A verified ${label(lesson.taskType).toLowerCase()} task`),
  }));
  candidate = deps.applyEdits(candidate, examples);
  const withRule: Harness = {
    ...candidate,
    retrieval: {
      ...candidate.retrieval,
      rules: [
        ...candidate.retrieval.rules,
        { whenAny: [...intervention.workedExamples], loadSkills: [], loadExamples: slugs },
      ],
    },
  };
  const retrieval = must(
    deps.harnessToFiles(withRule, { includeDefaults: true })['retrieval.yaml'],
    'retrieval.yaml',
  );
  candidate = deps.applyEdits(candidate, [
    { op: 'write', path: 'retrieval.yaml', content: retrieval },
  ]);
  for (const edit of examples) files.add(edit.path);
  files.add('retrieval.yaml');
  return { harness: candidate, files: [...files].sort() };
}

/**
 * A harness intervention's candidate, once its teaching is done: saved as a new version and
 * handed to dev. A change that no longer validates with its examples ends the round as invalid.
 */
export async function saveHarnessCandidate(state: RunState, index: number): Promise<void> {
  const intervention = interventionOfRound(state, index);
  const base = await state.resources.harness(intervention.parent.harnessVersion);
  let built: { harness: Harness; files: string[] };
  try {
    built = await buildHarness(state, base, intervention);
  } catch (error) {
    if (!(error instanceof Error) || error.name !== HARNESS_VALIDATION_ERROR) throw error;
    state.closeRound(
      index,
      `The change with its worked examples didn't validate: ${error.message}`,
      undefined,
      'invalid',
    );
    return;
  }
  const saved = await state.versions.save(built.harness, base.meta.version);
  const stored = state.round(index);
  state.saveRound({
    ...stored,
    round: {
      ...stored.round,
      status: 'evaluating',
      files: built.files,
      candidateVersion: saved.meta.version,
    },
  });
}
