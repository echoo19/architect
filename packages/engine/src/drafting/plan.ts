import type { DraftRecord, Job, JsonValue, SplitCounts, Task, TaskPlan } from '@architect/shared';

/** Examples of each type the Define screen shows. */
export const EXAMPLES_PER_TYPE = 3;

const SHOWN_ITEMS = 8;
const ANSWER_WIDTH = 140;

/** A value in plain words: text as it is, a list joined by commas, an object as `name: value`. */
function plainValue(value: JsonValue): string {
  if (value === null) return 'nothing';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    const shown = value.slice(0, SHOWN_ITEMS).map(plainValue).join(', ');
    return value.length > SHOWN_ITEMS ? `${shown} and ${value.length - SHOWN_ITEMS} more` : shown;
  }
  return Object.entries(value)
    .map(([name, inner]) => `${name}: ${plainValue(inner)}`)
    .join(', ');
}

function shortened(text: string): string {
  return text.length > ANSWER_WIDTH ? `${text.slice(0, ANSWER_WIDTH - 3)}...` : text;
}

/** The expected answer of a task in plain words, or nothing when the task has no short form. */
export function answerText(task: Task): string | undefined {
  const { expected } = task;
  switch (expected.kind) {
    case 'answer':
      return shortened(plainValue(expected.value));
    case 'facts':
      return shortened(
        expected.facts.map((fact) => `${fact.path}: ${plainValue(fact.value)}`).join(', '),
      );
    case 'end_state': {
      const summary = task.meta?.['summary'];
      return typeof summary === 'string' ? shortened(summary) : undefined;
    }
  }
}

/** The request without the line that says how to write the answer. */
export function requestText(task: Task): string {
  const asked = task.meta?.['request'];
  if (typeof asked === 'string' && asked.trim() !== '') return asked.trim();
  return task.prompt
    .split('\n')
    .filter((line) => !/^End with:/i.test(line.trim()))
    .join('\n')
    .trim();
}

export interface PlanInput {
  job: Job;
  draft: DraftRecord | null;
  /** The sets the person and the teacher may see. The final test is only counted. */
  visible: { calibration: readonly Task[]; train: readonly Task[]; dev: readonly Task[] };
  /** Sealed final-test tasks by type. */
  sealed: Readonly<Record<string, number>>;
}

/**
 * What a job's tasks are, for the Define screen. Examples come from the practice tasks first and
 * the starting ones next, so none is from the check tasks or the final test.
 */
export function buildTaskPlan({ job, draft, visible, sealed }: PlanInput): TaskPlan {
  const rules = new Map((draft?.types ?? []).map((type) => [type.id, type.rule]));
  const ofType = (tasks: readonly Task[], id: string) => tasks.filter((task) => task.type === id);
  const types = job.taskTypes.map((type): TaskPlan['types'][number] => {
    const rule = rules.get(type.id);
    const counts: SplitCounts = {
      calibration: ofType(visible.calibration, type.id).length,
      train: ofType(visible.train, type.id).length,
      dev: ofType(visible.dev, type.id).length,
      test: sealed[type.id] ?? 0,
    };
    const seen = new Set<string>();
    const examples = [...ofType(visible.train, type.id), ...ofType(visible.calibration, type.id)]
      .filter((task) => {
        const request = requestText(task);
        if (seen.has(request)) return false;
        seen.add(request);
        return true;
      })
      .slice(0, EXAMPLES_PER_TYPE)
      .map((task) => {
        const answer = answerText(task);
        return { request: requestText(task), ...(answer === undefined ? {} : { answer }) };
      });
    return {
      id: type.id,
      label: type.label,
      ...(type.description === undefined ? {} : { description: type.description }),
      ...(rule === undefined ? {} : { rule }),
      counts,
      examples,
    };
  });
  const total = (name: keyof SplitCounts): number =>
    types.reduce((sum, type) => sum + type.counts[name], 0);
  return {
    source: draft?.source ?? 'included',
    counts: {
      calibration: total('calibration'),
      train: total('train'),
      dev: total('dev'),
      test: total('test'),
    },
    types,
    unresolved: draft?.unresolved ?? [],
    notes: draft?.notes ?? [],
  };
}
