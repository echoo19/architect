import type { PolicyNumbers, PolicyStyle } from './style';

/**
 * An academy's policy.md. Every academy has the same kinds of rule, with its own numbers, written
 * one of three ways: prose with the numbers in a table at the end, prose alone, or a short list
 * of rules. The reference reads the numbers back from any of them (`readPolicy` in
 * src/reference/rules.ts).
 */

/** The rows of the table at the end of a `table` policy. A real academy's policy uses them too. */
export const POLICY_SETTINGS = {
  practiceCount: 'Practice questions after a wrong answer',
  bandLow: 'Practice difficulty, lowest percent correct',
  bandHigh: 'Practice difficulty, highest percent correct',
  window: 'History window, latest attempts on the topic',
  escalateWrong: 'Wrong answers that call for a staff note',
  escalateDays: 'Days those wrong answers are counted over',
  counts: 'Attempts that count in history',
  hintRule: 'First hint',
} as const;

export const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'];

export function policyDocument(name: string, policy: PolicyNumbers, style: PolicyStyle): string {
  const write = { table: tablePolicy, prose: prosePolicy, bullets: bulletPolicy }[style];
  return `${write(name, policy).join('\n')}\n`;
}

const RECORDS = [
  '- `students.csv`: each student, their target score, test date and tutor (`tutor_id`, a row of `staff.csv`).',
  "- `topics.csv`: the academy's topic labels, with the section and the folder of lesson videos for each.",
  '- `questions.csv`: the question bank, with full text, the right choice and `difficulty_pct`, the percent of students who get the question right (a higher number is an easier question).',
  '- `tests.csv`: which bank question sits where in each practice test.',
  '- `attempts.csv`: every answer a student gave on a practice test, with what they picked, the right answer and whether they got it right.',
  "- `errors.csv`: for each topic, the errors our answer explanations name. Each wrong choice in the bank comes from one of its topic's errors.",
  '- `hints.csv`: the approved first hints. The Academy desk gives only these hints, by id, and never writes its own.',
  "- `videos.csv`: the lesson videos, each in a topic's folder.",
  '- `assignments.csv` and `staff_notes.csv`: practice set for students and notes left for staff. New rows go at the end.',
];

const RESULT_RULE =
  "`result` in attempts.csv is the academy's own mark, and it is final. A grid-in answer can be entered more than one way (1/8, 0.125 and .125 are the same answer), so `selected` and `correct` can differ on a right answer: count right and wrong from `result`, never by comparing the two.";

function tablePolicy(name: string, policy: PolicyNumbers): string[] {
  const counts =
    policy.counts === 'first'
      ? "Only a student's first attempt at each question counts. When a student retakes a test, the retake's answers do not count toward history."
      : 'Every attempt counts, retakes included: a question answered twice is two attempts.';
  const hint =
    policy.hintRule === 'targeted'
      ? "Give the approved hint written for the error behind the student's choice (hints.csv, the row whose error_id is that error). When no hint is written for that error, give the topic's general hint, the row with no error_id."
      : "Always give the topic's general hint first, the row in hints.csv with no error_id, whatever the student chose. Hints written for a particular error are for the second try.";
  const settings: [string, string][] = [
    [POLICY_SETTINGS.practiceCount, String(policy.practiceCount)],
    [POLICY_SETTINGS.bandLow, String(policy.bandLow)],
    [POLICY_SETTINGS.bandHigh, String(policy.bandHigh)],
    [POLICY_SETTINGS.window, String(policy.window)],
    [POLICY_SETTINGS.escalateWrong, String(policy.escalateWrong)],
    [POLICY_SETTINGS.escalateDays, String(policy.escalateDays)],
    [POLICY_SETTINGS.counts, policy.counts === 'first' ? 'first attempts only' : 'every attempt'],
    [
      POLICY_SETTINGS.hintRule,
      policy.hintRule === 'targeted' ? 'the hint for the error' : 'the general hint',
    ],
  ];
  return [
    `# ${name}: tutoring policy`,
    '',
    `This is how ${name} tutors a student right after a wrong answer, and how staff read a student's record. The Academy desk, the academy's staff-facing agent, follows it, and so do the staff.`,
    '',
    '## The records',
    '',
    ...RECORDS,
    '',
    RESULT_RULE,
    '',
    '## Diagnosing a wrong answer',
    '',
    'Find the question the student answered, its topic and its right choice. Then name the error behind the choice they picked: the row of `errors.csv` for that topic whose error produces that choice. If two errors produce the same choice, either one is right.',
    '',
    '## The first hint',
    '',
    hint,
    '',
    '## History on a topic',
    '',
    `A student's history on a topic is read as of a date: the one the request names, or else the day the request is made. Attempts taken after that date are left out. ${counts} Of the attempts that count, take the latest ${policy.window}, ordered by the date taken, then module, then question number (fewer if the student has fewer). Report how many attempts that is, how many were right, and the accuracy: right answers divided by those attempts, as a whole percent, rounded half up.`,
    '',
    `Escalation looks at time, not at the window: escalate when the attempts that count, taken in the ${policy.escalateDays} days ending on that date (the date itself and the ${policy.escalateDays - 1} before it), hold ${policy.escalateWrong} or more wrong answers.`,
    '',
    '## Follow-up practice',
    '',
    `Assign ${policy.practiceCount} questions from the bank. Each must be of the same topic, never attempted by the student on any test, not already assigned to them, and with \`difficulty_pct\` from ${policy.bandLow} to ${policy.bandHigh}, both included. Any questions that meet these rules will do; never assign the same question twice. If fewer than ${policy.practiceCount} questions qualify, assign all that do and say how many.`,
    '',
    "Each question is one row of `assignments.csv`: a new `assignment_id` (number on from the highest id already in the file, in the same format, one per row; A-0001 if the file has none yet), the student, the question, the day the request is made as `assigned_on`, and the student's tutor as `assigned_by`.",
    '',
    '## The tutoring turn after a wrong answer',
    '',
    '1. Diagnose the answer: the topic, the right choice and the error.',
    '2. Give the first hint, by its id.',
    "3. Point the student to one lesson video from the topic's folder.",
    '4. Assign the follow-up practice.',
    "5. Read the student's history on the topic as of the day of the request. If it calls for escalation, add one row to `staff_notes.csv` for the student's tutor: a new `note_id` (numbered on, like assignments), the student, the tutor as `staff_id`, that day's date, the topic label, and a short note.",
    '',
    'Change nothing else. Never edit or delete a row that is already there.',
    '',
    '## In numbers',
    '',
    '| Setting | Value |',
    '| --- | --- |',
    ...settings.map(([setting, value]) => `| ${setting} | ${value} |`),
  ];
}

function prosePolicy(name: string, policy: PolicyNumbers): string[] {
  const count = NUMBER_WORDS[policy.practiceCount]!;
  const counts =
    policy.counts === 'first'
      ? "Only a student's first answer to each question counts; the answers from a retake don't."
      : 'Every answer counts, retakes included, so a question answered twice counts twice.';
  const hint =
    policy.hintRule === 'targeted'
      ? "Before they try again, give the student the approved hint written for that error (the row of hints.csv with that error_id). If no hint has been written for it yet, use the topic's general hint, the one with no error_id."
      : "Before they try again, give the student the topic's general hint, the row of hints.csv with no error_id, whatever they chose. A hint written for a particular error is saved for the second try.";
  return [
    `# How we tutor at ${name}`,
    '',
    `When a student misses a question on a practice test, ${name} follows the steps below. The Academy desk and every tutor work the same way, and only from our own records.`,
    '',
    '## Our records',
    '',
    ...RECORDS,
    '',
    RESULT_RULE,
    '',
    '## Right after a wrong answer',
    '',
    'First work out what went wrong: which question it was, its topic, its right choice, and the error in errors.csv (for that topic) that turns the right answer into the one the student chose. When two errors give the same choice, either is fine.',
    '',
    hint,
    '',
    `Then point the student to one lesson video from the topic's folder and set follow-up practice: ${count} questions from the bank on the same topic that the student has never attempted and has not already been given, with difficulty_pct between ${policy.bandLow} and ${policy.bandHigh} (both ends count). Any such questions will do, but never the same one twice. If fewer than ${count} qualify, set all of them and say how many.`,
    '',
    "Each practice question is a new row in assignments.csv: the next assignment_id after the highest one in the file, in the same format (A-0001 if the file is empty); the student; the question; the date of the request as assigned_on; and the student's tutor as assigned_by.",
    '',
    "Last, look at the student's history on the topic as of the date of the request (see below). If it calls for escalation, leave one note in staff_notes.csv for the tutor: the next note_id, the student, the tutor as staff_id, the date of the request, the topic and a short note.",
    '',
    "Change nothing else, and never edit or delete a row that's already there.",
    '',
    "## Reading a student's history",
    '',
    `History is always read as of a date: the date the request gives, or else the day it is made. Answers taken after that date don't count. ${counts} Take the latest ${policy.window} of the answers that count on the topic, ordered by date, then module, then question number, or all of them if there are fewer. Report how many that is, how many were right, and the accuracy as a whole percent (right answers divided by answers, rounded half up).`,
    '',
    `A student needs escalation when the answers that count, taken in the ${policy.escalateDays} days ending on that date (the date and the ${policy.escalateDays - 1} days before it), include ${policy.escalateWrong} or more wrong answers.`,
  ];
}

function bulletPolicy(name: string, policy: PolicyNumbers): string[] {
  const counts =
    policy.counts === 'first'
      ? "first answers only (a retake's answers don't count)"
      : 'every answer counts, retakes included';
  const hint =
    policy.hintRule === 'targeted'
      ? "the approved hint for that error; if the error has none yet, the topic's general hint (no error_id)."
      : "always the topic's general hint (the row with no error_id). Error hints are for a second try.";
  return [
    `# Tutoring rules, ${name}`,
    '',
    'For the Academy desk and all tutors. Records first, then the rules.',
    '',
    '## Records',
    '',
    ...RECORDS,
    `- Right or wrong is whatever \`result\` in attempts.csv says. A grid-in answer may be a fraction or a decimal (1/8, 0.125 or .125), so \`selected\` and \`correct\` can differ on a right answer.`,
    '',
    '## Rules',
    '',
    "- Diagnosis: the question, its topic, its right choice, and the error (errors.csv, same topic) that produces the student's choice. Two errors giving the same choice: either is right.",
    `- First hint: ${hint}`,
    `- Practice count: ${policy.practiceCount} questions per wrong answer.`,
    `- Practice difficulty: difficulty_pct ${policy.bandLow}-${policy.bandHigh}, ends included.`,
    '- Practice questions: same topic, never attempted by the student, not already assigned to them, no repeats. Too few qualify: assign all of them and say how many.',
    "- New assignment rows: the next assignment_id after the highest (same format, A-0001 when the file is empty), the student, the question, assigned_on = the date of the request, assigned_by = the student's tutor.",
    `- History: as of the request's date (later answers left out); ${counts}; the latest ${policy.window} answers on the topic by date, module, number; report attempts, right answers and accuracy (whole percent, half up).`,
    `- Escalation: ${policy.escalateWrong}+ wrong answers among the counted answers in the ${policy.escalateDays} days ending on the as-of date, that date included.`,
    "- After a wrong answer: diagnose, first hint, one video from the topic's folder, practice, then the history check; when escalation is due, one row in staff_notes.csv for the tutor (next note_id, student, tutor as staff_id, date of the request, topic, short note).",
    '- Never edit or delete an existing row, and write nothing else.',
  ];
}
