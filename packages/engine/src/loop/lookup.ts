import type { Expected, FileEdit, JsonValue, Task } from '@architect/shared';

/** A value specific enough to give a task away: an id with a digit, or a long number. */
const ID = /^(?=.*\d)[A-Za-z0-9][A-Za-z0-9_./:-]{3,}$/;
const MIN_NUMBER_DIGITS = 5;

function scalars(value: JsonValue): string[] {
  if (Array.isArray(value)) return value.flatMap(scalars);
  if (value === null) return [];
  if (typeof value === 'object') return Object.values(value).flatMap(scalars);
  return [String(value)];
}

function expectedValues(expected: Expected): string[] {
  switch (expected.kind) {
    case 'answer':
      return scalars(expected.value);
    case 'facts':
      return expected.facts.flatMap((fact) => scalars(fact.value));
    case 'end_state':
      return scalars(expected.params);
  }
}

function specific(value: string): boolean {
  if (/^-?\d+(\.\d+)?$/.test(value)) return value.replace(/\D/g, '').length >= MIN_NUMBER_DIGITS;
  return ID.test(value);
}

/** Whether `text` holds `value` as a whole token, not inside a longer word or number. */
function holds(text: string, value: string): boolean {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9])${escaped}(?![A-Za-z0-9])`).test(text);
}

/**
 * Why a change set would put answers into the harness, or null when it doesn't: a tool whose
 * code holds a value only a train task's expected result has, or instructions, skills or an
 * example that hold such values from more than one train task, which is a lookup table. Values
 * the job's own data or policy holds are not answers, so they never count. A worked example may
 * show one task's values, since it teaches by showing that task.
 */
export function answerTableProblem(
  edits: readonly FileEdit[],
  train: readonly Task[],
  dataTexts: readonly string[],
): string | null {
  const data = dataTexts.join('\n');
  const answers = train.map((task) => ({
    id: task.id,
    values: [...new Set(expectedValues(task.expected).filter(specific))].filter(
      (value) => !holds(data, value),
    ),
  }));
  for (const edit of edits) {
    if (edit.op !== 'write') continue;
    const tasks = answers.filter((task) => task.values.some((value) => holds(edit.content, value)));
    if (tasks.length === 0) continue;
    if (edit.path.startsWith('tools/')) {
      return `${edit.path} holds the expected result of train task ${tasks[0]?.id}. A tool must compute answers from the data, never look them up.`;
    }
    if (tasks.length > 1) {
      return `${edit.path} holds the expected results of ${tasks.length} train tasks (${tasks
        .slice(0, 3)
        .map((task) => task.id)
        .join(', ')}). Teach the procedure, not the answers.`;
    }
  }
  return null;
}
