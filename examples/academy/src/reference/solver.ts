import type { JsonValue } from '@architect/shared';
import type { AssignRequest, HistoryRequest, SolveRequest, WrongAnswer } from '../tasks/records';
import {
  eligibleQuestions,
  errorsBehind,
  firstHints,
  nextIds,
  readPolicy,
  topicHistory,
  workQuestion,
} from './rules';
import type { Policy } from './rules';
import { cell } from './tools';
import type { AgentTools, CodeRow, Tables } from './tools';

/**
 * Reference solutions that use only the agent's built-in tools, the way a careful agent works:
 * read policy.md, send code to `run` that fetches exactly the rows the request needs, apply the
 * policy to them, and append any rows the request asks for. Nothing about an academy is known in
 * advance: labels, ids, numbers, hints and videos all come from the files of the academy the
 * tools are bound to.
 */

const READ = `const read = (name) => csv.parse(files.read('data/' + name));`;
const text = (value: string | number): string => JSON.stringify(String(value));

/** Reads the policy, the first call of every request that needs it. */
function policyOf(tools: AgentTools): Policy {
  tools.readAll('policy.md');
  return readPolicy(tools.fileText('policy.md'));
}

interface Located {
  student: CodeRow;
  question: CodeRow;
  errors: CodeRow[];
  hints: CodeRow[];
}

/** One run: the student, the question they answered, and its topic's errors and hints. */
function locate(tools: AgentTools, w: WrongAnswer): Located {
  const code = [
    READ,
    `const student = read('students.csv').find((row) => row.name === ${text(w.student)});`,
    `const slot = read('tests.csv').find((row) => row.test_name === ${text(w.test_name)} && row.section === ${text(w.section)} && row.module === ${text(w.module)} && row.number === ${text(w.number)});`,
    "const question = read('questions.csv').find((row) => row.question_id === slot.question_id);",
    '({',
    '  student,',
    '  question,',
    "  errors: read('errors.csv').filter((row) => row.topic === question.topic),",
    "  hints: read('hints.csv').filter((row) => row.topic === question.topic),",
    '})',
  ].join('\n');
  const found = tools.run(code, (t) => {
    const slot = t.one(
      'tests.csv',
      (row) =>
        row.test_name === w.test_name &&
        row.section === w.section &&
        row.module === String(w.module) &&
        row.number === String(w.number),
    );
    const question = t.one('questions.csv', (row) => row.question_id === slot.question_id);
    return {
      student: t.one('students.csv', (row) => row.name === w.student),
      question,
      errors: t.where('errors.csv', (row) => row.topic === question.topic),
      hints: t.where('hints.csv', (row) => row.topic === question.topic),
    };
  });
  return found as unknown as Located;
}

export function diagnose(tools: AgentTools, w: WrongAnswer): JsonValue {
  policyOf(tools);
  const { question, errors } = locate(tools, w);
  return {
    topic: cell(question, 'topic'),
    correct: cell(question, 'correct'),
    error: errorsBehind(question, w.chosen, errors)[0]!,
  };
}

/**
 * Diagnose from the records alone, for an academy whose files have no question text or errors:
 * the attempt the student made carries the topic and the right choice.
 */
export function diagnoseRecord(tools: AgentTools, w: WrongAnswer): JsonValue {
  const code = [
    READ,
    `const student = read('students.csv').find((row) => row.name === ${text(w.student)});`,
    `const test = read('tests.csv').find((row) => row.test_name === ${text(w.test_name)});`,
    `read('attempts.csv').filter((row) => row.student_id === student.student_id && row.test_id === test.test_id && row.section === ${text(w.section)} && row.module === ${text(w.module)} && row.number === ${text(w.number)} && row.selected === ${text(w.chosen)})`,
  ].join('\n');
  const [attempt] = tools.run(code, (t) => {
    const student = t.one('students.csv', (row) => row.name === w.student);
    const test = t.where('tests.csv', (row) => row.test_name === w.test_name)[0]!;
    return t.where(
      'attempts.csv',
      (row) =>
        row.student_id === student.student_id &&
        row.test_id === test.test_id &&
        row.section === w.section &&
        row.module === String(w.module) &&
        row.number === String(w.number) &&
        row.selected === w.chosen,
    );
  });
  return { topic: cell(attempt!, 'topic'), correct: cell(attempt!, 'correct') };
}

export function hint(tools: AgentTools, w: WrongAnswer): JsonValue {
  const policy = policyOf(tools);
  const { question, errors, hints } = locate(tools, w);
  const errorIds = errorsBehind(question, w.chosen, errors);
  return { topic: cell(question, 'topic'), hint_id: firstHints(hints, errorIds, policy)[0]! };
}

/** A math question given in the request: no files needed. */
export function solve(request: SolveRequest): JsonValue {
  const { answer, step } = workQuestion(request.stem);
  const index = request.choices.findIndex((choice) => Number(choice) === answer);
  return { choice: 'ABCD'[index]!, answer, step };
}

interface StudentRecord {
  student: CodeRow;
  attempts: CodeRow[];
}

/** One run: a student and their attempts on a topic. */
function studentRecord(tools: AgentTools, name: string, topic: string): StudentRecord {
  const code = [
    READ,
    `const student = read('students.csv').find((row) => row.name === ${text(name)});`,
    '({',
    '  student,',
    `  attempts: read('attempts.csv').filter((row) => row.student_id === student.student_id && row.topic === ${text(topic)}),`,
    '})',
  ].join('\n');
  return tools.run(code, (t) => {
    const student = t.one('students.csv', (row) => row.name === name);
    return {
      student,
      attempts: t.where(
        'attempts.csv',
        (row) => row.student_id === student.student_id && row.topic === topic,
      ),
    };
  }) as unknown as StudentRecord;
}

export function history(tools: AgentTools, request: HistoryRequest): JsonValue {
  const policy = policyOf(tools);
  const { attempts } = studentRecord(tools, request.student, request.topic);
  return {
    as_of: request.as_of,
    window: policy.window,
    ...topicHistory(attempts, policy, request.as_of),
  };
}

interface Practice {
  attempted: string[];
  assignments: CodeRow[];
  questions: CodeRow[];
}

/**
 * One run: what assigning practice needs besides the student. Every question the student
 * attempted, every assignment (for the next id and for what they already have), and the
 * topic's questions with their difficulty.
 */
function practiceRecords(tools: AgentTools, student: CodeRow, topic: string): Practice {
  const id = cell(student, 'student_id');
  const code = [
    READ,
    '({',
    `  attempted: read('attempts.csv').filter((row) => row.student_id === ${text(id)}).map((row) => row.question_id),`,
    "  assignments: read('assignments.csv'),",
    `  questions: read('questions.csv').filter((row) => row.topic === ${text(topic)}).map((row) => ({ question_id: row.question_id, difficulty_pct: row.difficulty_pct })),`,
    '})',
  ].join('\n');
  return tools.run(code, (t: Tables) => ({
    attempted: t
      .where('attempts.csv', (row) => row.student_id === id)
      .map((row) => cell(row, 'question_id')),
    assignments: t.where('assignments.csv', () => true),
    questions: t
      .where('questions.csv', (row) => row.topic === topic)
      .map((row) => ({
        question_id: cell(row, 'question_id'),
        difficulty_pct: cell(row, 'difficulty_pct'),
      })),
  })) as unknown as Practice;
}

/** Appends the practice rows and returns how many it assigned. */
function assignPractice(
  tools: AgentTools,
  policy: Policy,
  student: CodeRow,
  topic: string,
): number {
  const { attempted, assignments, questions } = practiceRecords(tools, student, topic);
  const id = cell(student, 'student_id');
  const assigned = assignments
    .filter((row) => row.student_id === id)
    .map((row) => cell(row, 'question_id'));
  const eligible = eligibleQuestions(questions, new Set(attempted), new Set(assigned), policy);
  const chosen = eligible.slice(0, policy.practiceCount);
  if (chosen.length === 0) return 0;
  const ids = nextIds(
    assignments.map((row) => cell(row, 'assignment_id')),
    chosen.length,
  );
  tools.append(
    'assignments.csv',
    chosen.map((question, i) => ({
      assignment_id: ids[i]!,
      student_id: id,
      question_id: question,
      assigned_on: tools.today,
      assigned_by: cell(student, 'tutor_id'),
    })),
  );
  return chosen.length;
}

export function assign(tools: AgentTools, request: AssignRequest): JsonValue {
  const policy = policyOf(tools);
  const { student } = studentRecord(tools, request.student, request.topic);
  return { assigned: assignPractice(tools, policy, student, request.topic) };
}

export function afterWrong(tools: AgentTools, w: WrongAnswer): JsonValue {
  const policy = policyOf(tools);
  const { student, question, errors, hints } = locate(tools, w);
  const topic = cell(question, 'topic');
  const errorIds = errorsBehind(question, w.chosen, errors);
  const code = [
    READ,
    `const topic = read('topics.csv').find((row) => row.topic === ${text(topic)});`,
    '({',
    "  videos: read('videos.csv').filter((row) => row.folder === topic.video_folder),",
    `  attempts: read('attempts.csv').filter((row) => row.student_id === ${text(cell(student, 'student_id'))} && row.topic === topic.topic),`,
    "  notes: read('staff_notes.csv').map((row) => row.note_id),",
    '})',
  ].join('\n');
  const found = tools.run(code, (t) => {
    const row = t.one('topics.csv', (r) => r.topic === topic);
    return {
      videos: t.where('videos.csv', (r) => r.folder === row.video_folder),
      attempts: t.where(
        'attempts.csv',
        (r) => r.student_id === student.student_id && r.topic === topic,
      ),
      notes: t.where('staff_notes.csv', () => true).map((r) => cell(r, 'note_id')),
    };
  }) as unknown as { videos: CodeRow[]; attempts: CodeRow[]; notes: string[] };
  const assigned = assignPractice(tools, policy, student, topic);
  const { escalate } = topicHistory(found.attempts, policy, tools.today);
  if (escalate) {
    tools.append('staff_notes.csv', [
      {
        note_id: nextIds(found.notes, 1)[0]!,
        student_id: cell(student, 'student_id'),
        staff_id: cell(student, 'tutor_id'),
        written_on: tools.today,
        topic,
        note: `Missed ${topic} again; the recent record calls for a review in the next session.`,
      },
    ]);
  }
  return {
    topic,
    correct: cell(question, 'correct'),
    error: errorIds[0]!,
    hint_id: firstHints(hints, errorIds, policy)[0]!,
    video_id: cell(found.videos[0]!, 'video_id'),
    assigned,
    staff_note: escalate,
  };
}
