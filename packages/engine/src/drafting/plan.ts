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

/**
 * How big a task's answer is, for telling tasks of one type apart: the length of a list or a text,
 * the size of a number, the length of the facts asked for. The size is what an example is chosen
 * by, so that three examples show the range of a type instead of three alike.
 */
function sizeOf(task: Task): number {
  const { expected } = task;
  if (expected.kind === 'facts') {
    return expected.facts.reduce((sum, fact) => sum + plainValue(fact.value).length, 0);
  }
  if (expected.kind !== 'answer') return 0;
  const { value } = expected;
  if (Array.isArray(value)) return value.length;
  if (typeof value === 'number') return Math.abs(value);
  if (typeof value === 'string') return value.length;
  if (value !== null && typeof value === 'object') {
    const number = Object.values(value).find((inner) => typeof inner === 'number');
    if (typeof number === 'number') return Math.abs(number);
  }
  return 0;
}

/**
 * Where along the range of sizes `n` examples sit, apart from an empty or zero answer: one in
 * the middle, two near the ends, three at both ends and the middle. Not the very ends, which are
 * the odd cases of a type.
 */
function spreadOf(n: number): number[] {
  return n === 1 ? [0.5] : Array.from({ length: n }, (_, i) => 0.1 + (0.8 * i) / (n - 1));
}

/**
 * Up to `count` tasks that show the variety of a type: one with an empty or zero answer when
 * there is one, and others spread along the range of answer sizes, each of a different size and
 * none repeating a request. Tasks are taken in the order given, so practice comes before
 * starting tasks and a family is not shown twice while another can be.
 */
export function pickExamples(tasks: readonly Task[], count: number = EXAMPLES_PER_TYPE): Task[] {
  const seen = new Set<string>();
  const pool = tasks.filter((task) => {
    const request = requestText(task);
    if (seen.has(request)) return false;
    seen.add(request);
    return true;
  });
  const picked: Task[] = [];
  const families = new Set<string>();
  const take = (task: Task | undefined): void => {
    if (task === undefined || picked.includes(task) || picked.length >= count) return;
    picked.push(task);
    families.add(task.family);
  };
  /** The first task of a size, in the order given, preferring a family not shown yet. */
  const ofSize = (size: number): Task | undefined => {
    const same = pool.filter((task) => sizeOf(task) === size && !picked.includes(task));
    return same.find((task) => !families.has(task.family)) ?? same[0];
  };

  take(pool.find((task) => sizeOf(task) === 0));
  const sizes = [...new Set(pool.map(sizeOf))].filter((size) => size !== 0).sort((a, b) => a - b);
  const wanted = Math.min(count - picked.length, sizes.length);
  for (const fraction of spreadOf(wanted)) {
    const size = sizes[Math.round(fraction * (sizes.length - 1))];
    if (size !== undefined) take(ofSize(size));
  }
  // Anything still missing: sizes not shown yet, then whatever is left, in the order given.
  for (const size of sizes) take(ofSize(size));
  for (const task of pool) take(task);
  return picked;
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
    const examples = pickExamples([
      ...ofType(visible.train, type.id),
      ...ofType(visible.calibration, type.id),
    ]).map((task) => {
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
