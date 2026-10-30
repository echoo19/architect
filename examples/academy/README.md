# Academy: the tutor job

Phil is a tutor for test-prep academies. A student has just got a practice-test question wrong, and a tutor or the student asks Phil what to do. Phil works only from the academy's own files: its topic labels, its question bank, its practice tests, every answer its students gave, the errors and approved hints its explanations use, its lesson videos and its tutoring policy. `docs/FIELD.md` says why the job exists.

The job holds four made-up academies, built from seeds. Three are for training (Wrenfield Prep, Copperfield Learning, Oakhollow Academy) and one, Northgate Prep, is kept back as the transfer academy: Phil is never trained on it, and it is there to show whether what Phil learned carries over to an academy it has never seen. Every person, school and town in the files is invented.

## How the academies differ

Each academy is built from its own seed, so no two of them look alike:

- **Topic labels.** The same twelve topics (six math, six grammar and usage) are labeled three ways: `Rule 5A - Subjects and Verbs`, `Grammar: subjects and verbs` or `W-GRA-06 Subjects and Verbs`, with the topic's name picked from a few wordings and numbered in a shuffled order. Video folders follow the labels.
- **Ids.** Questions, students, staff, tests, errors, hints, videos, assignments and notes each get one of three id formats (`Q-0101`, `RW128`, `QB-30532`; `Practice Test 5`, `Bluebook Practice 3`, `Mock Exam E`), numbered in a shuffled order so an id says nothing about its topic.
- **Wording.** Each academy's bank words its questions one of two ways.
- **Policy numbers.** How many practice questions to assign (2 to 5), the difficulty band, the history window (5 to 10 attempts), how many wrong answers in it call for a staff note, whether retakes count in history, and which approved hint comes first: the one written for the student's error, or the topic's general hint.

| Academy | Role | Practice | Band | Window | Note at | Counts | First hint |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wrenfield Prep | train | 2 | 35-60 | 5 | 3 wrong | every attempt | for the error |
| Copperfield Learning | train | 5 | 40-70 | 6 | 3 wrong | first attempts | general |
| Oakhollow Academy | train | 4 | 30-55 | 5 | 3 wrong | first attempts | for the error |
| Northgate Prep | transfer | 3 | 45-80 | 8 | 3 wrong | every attempt | for the error |

Northgate's practice count and band are ones no train academy uses.

## Files

Every academy has the same twelve files in `job/orgs/<id>/data/`. The tables use a simple schema, so a real academy's anonymized export can be written into the same columns.

| File | Columns | Rows |
| --- | --- | --- |
| policy.md | the tutoring policy, with its numbers in a table at the end | |
| students.csv | student_id, name, grade, target_score, test_date, tutor_id | 16 |
| staff.csv | staff_id, name, role | 4 |
| topics.csv | topic, section, video_folder | 12 |
| errors.csv | error_id, topic, name | 43 |
| hints.csv | hint_id, topic, error_id, text | 43 to 50 |
| questions.csv | question_id, section, topic, difficulty_pct, stem, choice_a, choice_b, choice_c, choice_d, correct | 216 |
| tests.csv | test_id, test_name, program, section, module, number, question_id | 120 |
| attempts.csv | student_id, test_id, taken_on, section, module, number, question_id, topic, selected, correct, result | 1,272 to 1,440 |
| videos.csv | video_id, title, folder, description, minutes | 28 to 32 |
| assignments.csv | assignment_id, student_id, question_id, assigned_on, assigned_by | 10 to 12 |
| staff_notes.csv | note_id, student_id, staff_id, written_on, topic, note | 3 |

`difficulty_pct` is the percent of students who get a question right, so a higher number is an easier question. `result` is `right` or `wrong`. Each practice test has two Reading and Writing modules and two Math modules of six questions, one per topic of the section. Students sit two to five tests between September and mid-November, and about a third retake one. The agent may write only to `assignments.csv` and `staff_notes.csv`.

**Questions.** Math questions are generated with exact answers: linear equations, percent discounts, systems of two equations, ratios, evaluating a function, and rectangles from their perimeter. Each wrong choice comes from a named error put through the question's own numbers, such as "Stopped before dividing by the coefficient" or "Forgot to halve the perimeter". Grammar questions are written from rules (subject-verb agreement, pronouns, comparisons, verb tense, sentence boundaries, transitions), and each wrong choice is the right phrase turned wrong by a named error, such as agreeing with the nearer noun or joining two sentences with only a comma. `errors.csv` lists each topic's errors by name, with ids of the academy's own. Which error made which choice is kept with the task, not in the files: the checker knows it, and Phil has to work it out.

**Hints.** Phil never writes his own hints. `hints.csv` is a reviewed catalog: one general hint per topic, and hints written for particular errors. About one error in four has no hint written yet, so the policy's fallback to the general hint comes up.

## Tasks

192 tasks: 48 per academy, eight of each skill. Ids carry the academy (`oakhollow-hint-03`), and families never cross an academy. The tasks of the three train academies (144) split as usual; the transfer academy's 48 are for the locked test only. Each task names its academy in `org`, and its data folder is that academy's.

| Skill | The request | What is checked |
| --- | --- | --- |
| `diagnose` | "Vito got question 2 of Reading and Writing module 2 wrong and chose A." | the topic label, the right choice, and an error id that produces the chosen answer (`diagnosis`) |
| `solve` | a math question written out in the request, from outside the bank | the right choice, the answer and the key intermediate value (facts) |
| `hint` | a first hint before the student tries again | the topic and a hint id the policy allows for that wrong answer (`hint_chosen`) |
| `history` | how a student is doing on a topic, as of today or as of October 15 | as_of, window, attempts, right answers, accuracy and whether escalation is due (facts) |
| `assign` | set a student's follow-up practice on a topic | the rows added to assignments.csv and the count in the ANSWER (`practice_assigned`) |
| `after_wrong` | the whole tutoring turn | diagnosis, hint, a video from the topic's folder, the practice, and a staff note exactly when the policy calls for one (`tutoring_turn`) |

Half the requests read as a tutor writing, half as the student. Each ends with the ANSWER line it wants.

`diagnose` names the error the wrong choice was built from. It says nothing about what the student was actually thinking. When two errors give the same choice, either one passes.

`history` follows the policy: attempts after the cutoff date are left out, retakes count or not as the academy says, and the latest attempts up to the window are taken in order of date, module and question number. Accuracy is right answers over those attempts, rounded half up. Three of the eight per academy ask about an earlier date, and about half call for escalation.

`assign` accepts any questions that follow the rules: the same topic, never attempted by the student, not already assigned to them, inside the band, no question twice, the policy's count, ids numbered on from the file, and nothing else written. When fewer questions qualify than the policy asks for, all of them are assigned and the ANSWER says how many; two `assign` tasks per academy are like that.

The first tutoring turn at every academy is the same kind of wrong answer: a subject-verb question where the student picked the verb that agrees with the nearer noun. The policies make the right turn differ. At Wrenfield (`wrenfield-after_wrong-01`) Phil assigns 2 questions and leaves a staff note. At Oakhollow (`oakhollow-after_wrong-01`) he assigns 4 and leaves none.

## Checker

`src/checker.js`, copied into the job folder, holds the four validators. It reads no clock and no randomness. It reads the tables of the task's academy (questions, attempts, assignments, videos), so it checks the practice rows against the records themselves. It takes the policy's numbers, the right choice, the errors behind the choice and the allowed hint ids from the task. A failure's reason starts with the field or table that is wrong.

## Reference solutions

`src/reference/solver.ts` solves every task with the agent's built-in tools only. It reads policy.md, sends code to `run` that fetches the rows the request needs, applies the rules in `src/reference/rules.ts`, and appends any rows. It knows nothing about any one academy: the labels, ids, policy numbers, hints and videos all come from the files of the academy it is bound to. What it knows on its own is the subject: how each kind of question is worked, and how each named error turns a right answer into a wrong one. It reads the policy's numbers from the table at the end of policy.md. A tutoring turn takes at most 6 tool calls and 13,000 characters of tool results, the policy included.

## Tests

- The committed folder matches the generator byte for byte, and the same seeds always give the same bytes.
- The four academies differ in labels, folders, error ids and policy numbers, and the three train academies differ in practice count.
- The policy's numbers in policy.md read back to the ones the academy was built with.
- For every wrong choice of every bank question, the reference finds the error from the question text alone, and it matches the error the choice was built from.
- Every topic has one general hint, and the solve questions are not in the academy's bank.
- The checker passes the ground truth, and any other choice the policy allows. It fails the common mistakes for the right reason: another error of the topic, the wrong hint for the policy, an attempted or out-of-band question, a question assigned twice, a row too few, an unasked staff note, a missing one, and a video from another folder.
- The reference solutions fit 16 turns and 24,000 characters. Their calls are replayed through the engine's own tools on each academy's files, the text they get back is compared, and every task passes the engine's checker. Until the engine binds a task to its academy by itself, the tests bind each task's data folder themselves.

## Known gaps

- The job has not been calibrated on the bare student yet.
- None of the committed tasks happens to have a wrong choice that two errors produce. The checker accepts a set, and a test covers it.
- `solve` covers math only. A grammar question has no intermediate value to check.
- The real academy, CP, will be written into the same tables from its export. The export has no question text, so on CP only `history`, `assign` and the topic and right choice of `diagnose` apply.

## Regenerate

```
pnpm --filter @architect/example-academy generate
```
