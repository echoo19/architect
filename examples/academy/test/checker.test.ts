import vm from 'node:vm';
import type { CheckResult, JsonValue, Task } from '@architect/shared';
import { describe, expect, it } from 'vitest';
import type { CsvRow } from '../src/lib/csv';
import { eligibleQuestions, readPolicy } from '../src/reference/rules';
import { solveTask } from './attempts';
import { job, orgOf, paramsOf } from './helpers';

/**
 * The checker passes the ground truth and any other choice the policy allows, and fails the
 * common mistakes with a reason that starts with what is wrong.
 */

const diagnoses = job.tasksOfType('diagnose');
const hints = job.tasksOfType('hint');
const assigns = job.tasksOfType('assign');
const turns = job.tasksOfType('after_wrong');

const asked = (task: Task, answer: JsonValue) => job.check(task, job.contextWith(task, {}, answer));

function failsWith(result: CheckResult, start: string) {
  expect(result.pass, result.reason).toBe(false);
  expect(result.reason.startsWith(start), result.reason).toBe(true);
}

/** The reference's end state for a task: its answer and the rows it appended. */
function reference(task: Task) {
  const { tools, answer } = solveTask(task);
  return {
    answer: answer as Record<string, JsonValue>,
    assignments: [...tools.appendedTo('assignments.csv')],
    notes: [...tools.appendedTo('staff_notes.csv')],
  };
}

function endState(
  task: Task,
  answer: JsonValue,
  assignments: readonly CsvRow[],
  notes: readonly CsvRow[] = [],
) {
  return job.check(
    task,
    job.withAppended(task, { 'assignments.csv': assignments, 'staff_notes.csv': notes }, answer),
  );
}

describe('the checker sandbox', () => {
  it('has no clock and no randomness, and defines the four validators', () => {
    const sandbox = job.checkerSandbox();
    expect(vm.runInContext('typeof Date', sandbox)).toBe('undefined');
    expect(vm.runInContext('typeof Math.random', sandbox)).toBe('undefined');
    expect(vm.runInContext('Object.keys(validators).sort().join()', sandbox)).toBe(
      'diagnosis,hint_chosen,practice_assigned,tutoring_turn',
    );
  });
});

describe('diagnosis', () => {
  const truth = (task: Task) => {
    const p = paramsOf(task);
    return { topic: p.topic!, correct: p.correct!, error: (p.errors as string[])[0]! };
  };

  it('passes the ground truth for every diagnose task, whatever its capitals', () => {
    for (const task of diagnoses) {
      expect(asked(task, truth(task)), task.id).toMatchObject({ pass: true });
      const t = truth(task);
      const shouted = { ...t, topic: String(t.topic).toUpperCase(), error: ` ${String(t.error)} ` };
      expect(asked(task, shouted), task.id).toMatchObject({ pass: true });
    }
  });

  it('fails another error of the same topic, a wrong choice and a wrong topic', () => {
    const task = diagnoses[0]!;
    const t = truth(task);
    const other = job
      .table(orgOf(task), 'errors.csv')
      .find((row) => row.topic === t.topic && row.error_id !== t.error)!.error_id!;
    failsWith(asked(task, { ...t, error: other }), 'error is');
    failsWith(asked(task, { ...t, correct: t.correct === 'A' ? 'B' : 'A' }), 'correct is');
    failsWith(asked(task, { ...t, topic: 'Comparisons' }), 'topic is');
    failsWith(asked(task, { topic: t.topic, correct: t.correct }), 'error is missing');
  });

  it('accepts any error of a listed set, for a choice two errors produce', () => {
    const task = diagnoses[0]!;
    const t = truth(task);
    const other = job
      .table(orgOf(task), 'errors.csv')
      .find((row) => row.topic === t.topic && row.error_id !== t.error)!.error_id!;
    const ambiguous: Task = {
      ...task,
      expected: {
        kind: 'end_state',
        validator: 'diagnosis',
        params: { ...paramsOf(task), errors: [t.error, other] },
      },
    };
    expect(asked(ambiguous, { ...t, error: other })).toMatchObject({ pass: true });
  });

  it('fails an attempt that wrote to a table', () => {
    const task = diagnoses[0]!;
    const row = job.table(orgOf(task), 'staff_notes.csv')[0]!;
    failsWith(
      job.check(task, job.withAppended(task, { 'staff_notes.csv': [row] }, truth(task))),
      'staff_notes.csv changed',
    );
  });
});

describe('hint_chosen', () => {
  it('passes the hint the policy calls for, and fails any other hint of the topic', () => {
    for (const task of hints) {
      const { topic, hint_ids } = paramsOf(task) as { topic: string; hint_ids: string[] };
      expect(asked(task, { topic, hint_id: hint_ids[0]! }), task.id).toMatchObject({ pass: true });
      const other = job
        .table(orgOf(task), 'hints.csv')
        .find((row) => row.topic === topic && !hint_ids.includes(row.hint_id!));
      if (other) failsWith(asked(task, { topic, hint_id: String(other.hint_id) }), 'hint_id is');
    }
  });

  it("wants the general hint first where the policy says so, and the error's hint where it says that", () => {
    const rules = new Set(
      hints.map((task) => readPolicy(job.file(`orgs/${orgOf(task)}/data/policy.md`)).hintRule),
    );
    expect(rules).toEqual(new Set(['general', 'targeted']));
    for (const task of hints) {
      const policy = readPolicy(job.file(`orgs/${orgOf(task)}/data/policy.md`));
      const { hint_ids } = paramsOf(task) as { hint_ids: string[] };
      const rows = job
        .table(orgOf(task), 'hints.csv')
        .filter((row) => hint_ids.includes(row.hint_id!));
      if (policy.hintRule === 'general') {
        expect(
          rows.every((row) => row.error_id === null),
          task.id,
        ).toBe(true);
      }
    }
  });
});

describe('practice_assigned', () => {
  it('passes the reference rows, and any other questions the policy allows', () => {
    for (const task of assigns) {
      const { answer, assignments } = reference(task);
      expect(endState(task, answer, assignments), task.id).toMatchObject({ pass: true });
      const org = orgOf(task);
      const p = paramsOf(task) as { student_id: string; topic: string; expected_count: number };
      const policy = readPolicy(job.file(`orgs/${org}/data/policy.md`));
      const data = job.data(org);
      const eligible = eligibleQuestions(
        data.codeRows('questions.csv').filter((row) => row.topic === p.topic),
        new Set(
          data
            .codeRows('attempts.csv')
            .filter((row) => row.student_id === p.student_id)
            .map((row) => row.question_id!),
        ),
        new Set(
          data
            .codeRows('assignments.csv')
            .filter((row) => row.student_id === p.student_id)
            .map((row) => row.question_id!),
        ),
        policy,
      );
      const others = [...eligible].reverse().slice(0, p.expected_count);
      const swapped = assignments.map((row, i) => ({ ...row, question_id: others[i]! }));
      expect(endState(task, answer, swapped), task.id).toMatchObject({ pass: true });
    }
  });

  const task = assigns.find((t) => Number(paramsOf(t).expected_count) >= 2)!;
  const org = orgOf(task);
  const p = paramsOf(task) as {
    student_id: string;
    topic: string;
    band_low: number;
    band_high: number;
  };
  const { answer, assignments } = reference(task);
  const swap = (questionId: string | null | undefined): CsvRow[] => {
    if (!questionId) throw new Error('No question for this mistake');
    return [{ ...assignments[0]!, question_id: questionId }, ...assignments.slice(1)];
  };

  it('fails a question the student already attempted', () => {
    const attempted = job
      .table(org, 'attempts.csv')
      .find((row) => row.student_id === p.student_id && row.topic === p.topic)!;
    failsWith(
      endState(task, answer, swap(attempted.question_id)),
      `question_id ${attempted.question_id} was already attempted`,
    );
  });

  it('fails a question outside the band and one of another topic', () => {
    const questions = job.table(org, 'questions.csv');
    const hard = questions.find(
      (q) => q.topic === p.topic && Number(q.difficulty_pct) < p.band_low,
    );
    const result = endState(task, answer, swap(hard?.question_id));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/^question_id \S+ (has difficulty_pct|was already attempted)/);
    failsWith(
      endState(task, answer, swap(questions.find((q) => q.topic !== p.topic)?.question_id)),
      'question_id',
    );
  });

  it('fails the same question twice, a row too few, and a wrong count in the ANSWER', () => {
    const twice = [
      assignments[0]!,
      { ...assignments[1]!, question_id: assignments[0]!.question_id ?? null },
      ...assignments.slice(2),
    ];
    failsWith(endState(task, answer, twice), 'question_id');
    failsWith(endState(task, answer, assignments.slice(1)), 'assignments.csv gained');
    failsWith(endState(task, { assigned: 99 }, assignments), 'assigned in the ANSWER');
  });

  it('fails a staff note the task did not ask for, and a changed existing row', () => {
    const note = job.table(org, 'staff_notes.csv')[0]!;
    failsWith(endState(task, answer, assignments, [note]), 'staff_notes.csv changed');
    const before = job.table(org, 'assignments.csv');
    const edited = [
      { ...before[0]!, assigned_on: '2026-11-16' },
      ...before.slice(1),
      ...assignments,
    ];
    failsWith(
      job.check(task, job.contextWith(task, { 'assignments.csv': edited }, answer)),
      'assignments.csv: an existing row',
    );
  });

  it('fails old rows put in another order, even with the right new rows after them', () => {
    const before = job.table(org, 'assignments.csv');
    expect(before.length).toBeGreaterThan(1);
    const swapped = [before[1]!, before[0]!, ...before.slice(2), ...assignments];
    failsWith(
      job.check(task, job.contextWith(task, { 'assignments.csv': swapped }, answer)),
      'assignments.csv: an existing row',
    );
  });
});

describe('tutoring_turn', () => {
  const escalating = turns.find((t) => paramsOf(t).escalate === true)!;
  const calm = turns.find((t) => paramsOf(t).escalate === false)!;

  it('fails a turn that leaves no note when the history calls for one', () => {
    const { answer, assignments } = reference(escalating);
    failsWith(endState(escalating, answer, assignments, []), 'staff_notes.csv gained 0');
    failsWith(endState(escalating, { ...answer, staff_note: false }, assignments), 'staff_note');
  });

  it('fails old notes put in another order, even with the right new note after them', () => {
    const { answer, assignments, notes } = reference(escalating);
    const before = job.table(orgOf(escalating), 'staff_notes.csv');
    expect(before.length).toBeGreaterThan(1);
    const swapped = [before[1]!, before[0]!, ...before.slice(2), ...notes];
    const context = job.withAppended(escalating, { 'assignments.csv': assignments }, answer);
    failsWith(
      job.check(escalating, {
        ...context,
        readTable: (name) => (name === 'staff_notes.csv' ? swapped : context.readTable(name)),
      }),
      'staff_notes.csv: an existing row',
    );
  });

  it('fails a note the history does not call for', () => {
    const { answer, assignments, notes } = reference(calm);
    expect(notes).toEqual([]);
    const note = {
      note_id: 'X',
      student_id: String(paramsOf(calm).student_id),
      staff_id: String(paramsOf(calm).assigned_by),
      written_on: '2026-11-16',
      topic: String(paramsOf(calm).topic),
      note: 'Please review.',
    };
    failsWith(endState(calm, answer, assignments, [note]), 'staff_notes.csv gained a note');
  });

  it('fails a video from another folder and a hint the policy does not call for', () => {
    const { answer, assignments, notes } = reference(escalating);
    const folder = String(paramsOf(escalating).folder);
    const other = job.table(orgOf(escalating), 'videos.csv').find((v) => v.folder !== folder)!;
    failsWith(
      endState(escalating, { ...answer, video_id: String(other.video_id) }, assignments, notes),
      `video_id "${other.video_id}" is in the folder`,
    );
    failsWith(
      endState(escalating, { ...answer, hint_id: 'nope' }, assignments, notes),
      'hint_id is',
    );
  });
});
