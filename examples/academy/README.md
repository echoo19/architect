# Academy: the tutor job

Phil is a tutor for test-prep academies. A student has just got a practice-test question wrong, and a tutor or the student asks Phil what to do. Phil works only from the academy's own files: its topic labels, its question bank, its practice tests, every answer its students gave, the errors and approved hints its explanations use, its lesson videos and its tutoring policy. `docs/FIELD.md` says why the job exists.

The job holds four made-up academies, built from seeds. Three are for training (Copperfield Learning, Thistlewood Learning, Bramble Hill Academy) and one, Juniper Study House, is kept back as the transfer academy: Phil is never trained on it, and it is there to show whether what Phil learned carries over to an academy it has never seen. None of them is an academy of the first field run (Ridgeline, Wrenfield, Lakemont, Harborview), so that run's unseen academy stays unseen. Every person, school and town in the files is invented.

The first field run showed why the academies have to differ the way real exports differ: a helper Phil wrote fit the generated academies' regularities (one section per test, answers compared as text, one date for every academy, labels written one way, one policy layout) and broke on a real academy's export (`docs/comparisons/phil-1-real-academy-misses.md`). Each academy now differs in those ways too.

## How the academies differ

Each academy is built from its own seed, so no two of them look alike:

- **Its date.** Each academy's records end on a day of its own, and its requests say what day it is ("It's Thursday, October 22, 2026."). The job's header date, November 16, is the date of none of them, so a procedure that takes the header's date gets every academy wrong.
- **Test layout.** `module`: each section's two modules numbered 1 to 6, and a request names the question as "question 5 of Reading and Writing module 1 on Bluebook Practice 5". `full`: tests.csv lists the whole test with section "Full", and each section is numbered on its own within a module, so every place in tests.csv holds a Reading and Writing question and a Math question; the request still names the section, as staff would. `continuous`: one number through the whole test, 1 to 24, and a request names only the number ("question 12 on Practice Test 3"). The section of a question is always in questions.csv and attempts.csv.
- **Grid-ins.** About two in five linear-equation questions are grid-ins: no choices, and a fraction for an answer, keyed in lowest terms (`5/2`). A student who gets one right may enter it another way (`2.5`, `10/4`, `.75` for `3/4`). The academy's own `result` is the mark, and every policy says so.
- **Labels.** The same twelve topics (six math, six grammar and usage) are labeled three ways: `Rule 5A - Subjects and Verbs`, `Grammar: subjects and verbs` or `W-GRA-06 Subjects and Verbs`, with the topic's name picked from a few wordings and numbered in a shuffled order. topics.csv, errors.csv and hints.csv write each label one way; questions.csv and attempts.csv are exports that write some labels with a stray double space, in other capitals or with other punctuation (`rule 4b - verb tense`, `Rule 6B: Rectangles`, `Rule  5B - Function Notation`), each academy two of those three ways. With spaces, capitals and punctuation set aside, every label reads back to exactly one topic.
- **Ids.** Questions, students, staff, tests, errors, hints, videos, assignments and notes each get one of three id formats (`Q-0101`, `RW128`, `QB-30532`; `Practice Test 5`, `Bluebook Practice 3`, `Mock Exam E`), numbered in a shuffled order so an id says nothing about its topic.
- **Wording.** Each academy's bank words its questions one of two ways.
- **The policy.** Written one of three ways: prose with the numbers in a table at the end (`table`), prose alone with the numbers in its sentences, some in words (`prose`), or a short list of rules (`bullets`). Every policy has the same kinds of rule, with its own numbers: how many practice questions to assign (2 to 5), the difficulty band, the history window (5 to 10 attempts), when to escalate (2 wrong answers in 7 days, 3 in 14, 3 in 21 or 4 in 30), whether retakes count in history, and which approved hint comes first: the one written for the student's error, or the topic's general hint.

| Academy              | Role     | Date   | Tests      | Policy  | Labels            | Practice | Band  | Window | Staff note at      | Counts         | First hint    |
| -------------------- | -------- | ------ | ---------- | ------- | ----------------- | -------- | ----- | ------ | ------------------ | -------------- | ------------- |
| Copperfield Learning | train    | Nov 4  | full       | prose   | spaces, case      | 5        | 45-80 | 6      | 4 wrong in 30 days | first attempts | for the error |
| Thistlewood Learning | train    | Oct 13 | continuous | bullets | case, spaces      | 2        | 30-60 | 6      | 2 wrong in 7 days  | every attempt  | general       |
| Bramble Hill Academy | train    | Nov 12 | module     | table   | case, punctuation | 4        | 45-80 | 5      | 3 wrong in 21 days | first attempts | general       |
| Juniper Study House  | transfer | Oct 22 | full       | bullets | punctuation, case | 3        | 45-75 | 6      | 3 wrong in 14 days | first attempts | for the error |

The train academies use every test layout and every policy style. Juniper's practice count, band and escalation rule are ones no train academy uses. An academy that assigns more practice at a time keeps a bigger bank (12 questions per topic plus 3 for each practice question), so running out of questions to assign stays an occasional case.

## Files

Every academy has the same twelve files in `job/orgs/<id>/data/`. The tables use a simple schema, so a real academy's anonymized export can be written into the same columns.

| File            | Columns                                                                                               | Rows           |
| --------------- | ----------------------------------------------------------------------------------------------------- | -------------- |
| policy.md       | the tutoring policy, in the academy's own style                                                       |                |
| students.csv    | student_id, name, grade, target_score, test_date, tutor_id                                            | 16             |
| staff.csv       | staff_id, name, role                                                                                  | 4              |
| topics.csv      | topic, section, video_folder                                                                          | 12             |
| errors.csv      | error_id, topic, name                                                                                 | 43             |
| hints.csv       | hint_id, topic, error_id, text                                                                        | 42 to 46       |
| questions.csv   | question_id, section, topic, difficulty_pct, stem, choice_a, choice_b, choice_c, choice_d, correct    | 216 to 324     |
| tests.csv       | test_id, test_name, program, section, module, number, question_id                                     | 120            |
| attempts.csv    | student_id, test_id, taken_on, section, module, number, question_id, topic, selected, correct, result | 1,488 to 1,704 |
| videos.csv      | video_id, title, folder, description, minutes                                                         | 28 to 32       |
| assignments.csv | assignment_id, student_id, question_id, assigned_on, assigned_by                                      | 10 to 13       |
| staff_notes.csv | note_id, student_id, staff_id, written_on, topic, note                                                | 3              |

A person's own academy fits when it holds the required files with these columns. `staff.csv`, `topics.csv`, `errors.csv`, `hints.csv`, `videos.csv` and `staff_notes.csv` are marked optional in `job.json` and may be absent.

`difficulty_pct` is the percent of students who get a question right, so a higher number is an easier question. `result` is `right` or `wrong`, and it is the academy's own mark: on a grid-in, `selected` and `correct` can differ on a right answer. A grid-in's choices are empty and its `correct` is the key (`5/2`). Each practice test has two Reading and Writing modules and two Math modules of six questions, one per topic of the section. Students sit two to five tests over the 77 days before the academy's date, the latest in its last two weeks, and about a third retake one. The agent may write only to `assignments.csv` and `staff_notes.csv`.

**Written another way.** In about a fifth of the rows of questions.csv and attempts.csv a value is written another way: a topic label, or a right grid-in answer. The first five rows of each are plain, which covers the sample rows a mentor is shown, and the other forms are spread through the rest. Every one reads back to one value: a label to exactly one row of topics.csv, an entry to the key's number.

**Questions.** Math questions are generated with exact answers: linear equations (some of them grid-ins), percent discounts, systems of two equations, ratios, evaluating a function, and rectangles from their perimeter. Each wrong choice comes from a named error put through the question's own numbers, such as "Stopped before dividing by the coefficient" or "Forgot to halve the perimeter". Grammar questions are written from rules (subject-verb agreement, pronouns, comparisons, verb tense, sentence boundaries, transitions), and each wrong choice is the right phrase turned wrong by a named error, such as agreeing with the nearer noun or joining two sentences with only a comma. `errors.csv` lists each topic's errors by name, with ids of the academy's own. Which error made which choice is kept with the task, not in the files: the checker knows it, and Phil has to work it out.

**Hints.** Phil never writes his own hints. `hints.csv` is a reviewed catalog: one general hint per topic, and hints written for particular errors. About one error in four has no hint written yet, so the policy's fallback to the general hint comes up.

## Tasks

192 tasks: 48 per academy, eight of each skill. Ids carry the academy (`lakemont-hint-03`), and families never cross an academy. The tasks of the three train academies (144) split as usual; the transfer academy's 48 are for the locked test only. Each task names its academy in `org`, and its data folder is that academy's.

| Skill         | The request                                                                             | What is checked                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `diagnose`    | "Vito got question 2 of Reading and Writing module 2 on Mock Exam C wrong and chose A." | the topic label, the right choice, and an error id that produces the chosen answer (`diagnosis`)                                         |
| `solve`       | a math question written out in the request, from outside the bank                       | the right choice, the answer and the key intermediate value (facts)                                                                      |
| `hint`        | a first hint before the student tries again                                             | the topic and a hint id the policy allows for that wrong answer (`hint_chosen`)                                                          |
| `history`     | how a student is doing on a topic, as of the request's day or a month before            | as_of, window, attempts, right answers, accuracy and whether escalation is due (facts)                                                   |
| `assign`      | set a student's follow-up practice on a topic                                           | the rows added to assignments.csv and the count in the ANSWER (`practice_assigned`)                                                      |
| `after_wrong` | the whole tutoring turn                                                                 | diagnosis, hint, a video from the topic's folder, the practice, and a staff note exactly when the policy calls for one (`tutoring_turn`) |

Half the requests read as a tutor writing, half as the student. Each starts with the academy's date, names a question the way its tests number it, and ends with the ANSWER line it wants. `diagnose`, `hint` and the tutoring turn ask only about questions with choices, since a grid-in has no choices for an error to make.

`diagnose` names the error the wrong choice was built from. It says nothing about what the student was actually thinking. When two errors give the same choice, either one passes; three diagnose tasks are like that (`copperfield-diagnose-01` and `-02`, `bramble-diagnose-01`).

`history` follows the policy: attempts after the cutoff date are left out, retakes count or not as the academy says, and the latest attempts up to the window are taken in order of date, module and question number, whatever label each row writes. Right answers are the ones `result` marks right. Accuracy is right answers over those attempts, rounded half up. Escalation looks at time instead: the wrong answers among the attempts that count, taken in the policy's number of days up to the cutoff. Three of the eight per academy ask about an earlier date, and at every academy one asks about a window that holds a grid-in answer entered another way than the key.

`assign` accepts any questions that follow the rules: the same topic, never attempted by the student, not already assigned to them, inside the band, no question twice, the policy's count, ids numbered on from the file, the academy's date as `assigned_on`, and nothing else written. When fewer questions qualify than the policy asks for, all of them are assigned and the ANSWER says how many; seven tasks across the job are like that.

The first tutoring turn at every academy is the same kind of wrong answer: a subject-verb question where the student picked the verb that agrees with the nearer noun. The policies make the right turn differ. At Thistlewood (`thistlewood-after_wrong-01`) Phil assigns 2 questions and leaves no note. At Copperfield (`copperfield-after_wrong-01`) he assigns 5 and leaves a note for the tutor.

## Checker

`src/checker.js`, copied into the job folder, holds the four validators. It reads no clock and no randomness. It reads the tables of the task's academy (questions, attempts, assignments, videos), so it checks the practice rows against the records themselves. It takes the policy's numbers, the date, the right choice, the errors behind the choice and the allowed hint ids from the task. A topic label passes however its spaces, capitals and punctuation are written, and a grid-in answer however its number is written (`1/8`, `0.125`, `.125`). A failure's reason starts with the field or table that is wrong.

## Reference solutions

`src/reference/solver.ts` solves every task with the agent's built-in tools only. It reads policy.md, sends code to `run` that fetches the rows the request needs, applies the rules in `src/reference/rules.ts`, and appends any rows. It knows nothing about any one academy: the labels, ids, policy numbers, hints and videos all come from the files of the academy it is bound to. What it knows on its own is the subject (how each kind of question is worked, and how each named error turns a right answer into a wrong one) and how exports differ:

- It finds the question a request names from the student's own row of attempts.csv (that test, that number, and the section and module when the request names them), which works for every layout, and then reads the question from questions.csv.
- It matches topic labels with spaces, capitals and punctuation set aside, and reports the label topics.csv gives.
- It counts right and wrong from `result`.
- It takes the date from the request, never from the header.
- It reads the policy's numbers from its table when it has one, and otherwise from what its sentences or rules say.

Every task fits the agent's 16 turns and 24,000 characters of tool results, the policy included.

## Tests

- The committed folder matches the generator byte for byte, and the same seeds always give the same bytes.
- The four academies differ in labels, folders, error ids and policy numbers, and the three train academies differ in practice count.
- Each academy has its own date: every request states it, every record ends by it, every assignment the checker expects is dated with it, and none is the header's date.
- The train academies use all three test layouts and all three policy styles. A `full` academy's places each hold two questions, a `continuous` academy's numbers are unique in a test, and its requests name no section or module.
- The policy's numbers in policy.md, in every style, read back to the ones the academy was built with, and every policy says `result` is the mark.
- In questions.csv and attempts.csv, 15 to 25 percent of each academy's rows are written another way, none in the first five, and some in every quarter of the rest. Every label reads back to exactly the one topic it was built with, and every grid-in entry reads back to the key's number exactly when `result` says right.
- For every wrong choice of every bank question, the reference finds the error from the question text alone, and it matches the error the choice was built from.
- Every topic has one general hint, and the solve questions are not in the academy's bank.
- The checker passes the ground truth, and any other choice the policy allows, labels written any other way included. It fails the common mistakes for the right reason: another error of the topic, the wrong hint for the policy, an attempted or out-of-band question, a question assigned twice, a row too few, an unasked staff note, a missing one, and a video from another folder.
- The reference solutions fit 16 turns and 24,000 characters. Their calls are replayed through the engine's own tools on each academy's files, the text they get back is compared, and every task passes the engine's checker. Until the engine binds a task to its academy by itself, the tests bind each task's data folder themselves.

## Known gaps

- The job has not been calibrated on the bare student yet.
- `solve` covers math only. A grammar question has no intermediate value to check.
- Escalation is rare in the tutoring turns of the academies with short escalation windows.

## A real academy's records

A real academy's anonymized export goes into the same tables, without question text, errors or hints, in whatever test layout it keeps. `buildRecordTasks(files, { org, seed, asOf })` in `src/tasks/records.ts` builds tasks for such a folder, only for the skills its records support: `history`, `assign`, and `diagnose` limited to the topic and the right choice. Its requests are dated `asOf`, they name a question the way its tests number it, and labels the records write more than one way count as one topic. It writes up to eight of each, in the same shapes and checked by the same validators. The folder needs `policy.md` with its table of numbers, `students.csv`, `questions.csv` (stem and choices may be left out), `tests.csv`, `attempts.csv` and `assignments.csv`; `staff.csv`, `topics.csv` and `staff_notes.csv` are used when they are there. The same files, seed and date always give the same tasks, and the checker treats a table the folder doesn't have as unchanged. `test/fixtures/records/` is a tiny folder like that, and its tasks pass through the engine's tools and checker.

```
pnpm --filter @architect/example-academy record-tasks --data <folder> --org <id> --as-of 2026-11-16 --seed 1 --out tasks.jsonl
```

## Regenerate

```
pnpm --filter @architect/example-academy generate
```
