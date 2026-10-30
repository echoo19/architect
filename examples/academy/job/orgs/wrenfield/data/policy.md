# Wrenfield Prep: tutoring policy

This is how Wrenfield Prep tutors a student right after a wrong answer, and how staff read a student's record. Phil, the academy's tutor, follows it, and so do the staff.

## The records

- `students.csv`: each student, their target score, test date and tutor (`tutor_id`, a row of `staff.csv`).
- `topics.csv`: the academy's topic labels, with the section and the folder of lesson videos for each.
- `questions.csv`: the question bank, with full text, the right choice and `difficulty_pct`, the percent of students who get the question right (a higher number is an easier question).
- `tests.csv`: which bank question sits at each section, module and number of each practice test.
- `attempts.csv`: every answer a student gave on a practice test, with the choice they picked, the right choice and whether they got it right.
- `errors.csv`: for each topic, the errors our answer explanations name. Each wrong choice in the bank comes from one of its topic's errors.
- `hints.csv`: the approved first hints. Phil gives only these hints, by id, and never writes his own.
- `videos.csv`: the lesson videos, each in a topic's folder.
- `assignments.csv` and `staff_notes.csv`: practice set for students and notes left for staff. New rows go at the end.

## Diagnosing a wrong answer

Find the question the student answered (the test, section, module and number lead to it through `tests.csv`), its topic and its right choice. Then name the error behind the choice they picked: the row of `errors.csv` for that topic whose error produces that choice. If two errors produce the same choice, either one is right.

## The first hint

Give the approved hint written for the error behind the student's choice (hints.csv, the row whose error_id is that error). When no hint is written for that error, give the topic's general hint, the row with no error_id.

## History on a topic

A student's history on a topic is read as of a date: attempts taken after that date are left out. Every attempt counts, retakes included: a question answered twice is two attempts. Of the attempts that count, take the latest 5, ordered by the date taken, then module, then question number (fewer if the student has fewer). Report how many attempts that is, how many were right, and the accuracy: right answers divided by those attempts, as a whole percent, rounded half up.

Escalate when those attempts hold 3 or more wrong answers.

## Follow-up practice

Assign 2 questions from the bank. Each must be of the same topic, never attempted by the student on any test, not already assigned to them, and with `difficulty_pct` from 35 to 60, both included. Any questions that meet these rules will do; never assign the same question twice. If fewer than 2 questions qualify, assign all that do and say how many.

Each question is one row of `assignments.csv`: a new `assignment_id` (number on from the highest id already in the file, in the same format, one per row), the student, the question, today's date as `assigned_on`, and the student's tutor as `assigned_by`.

## The tutoring turn after a wrong answer

1. Diagnose the answer: the topic, the right choice and the error.
2. Give the first hint, by its id.
3. Point the student to one lesson video from the topic's folder.
4. Assign the follow-up practice.
5. Read the student's history on the topic as of today. If it calls for escalation, add one row to `staff_notes.csv` for the student's tutor: a new `note_id` (numbered on, like assignments), the student, the tutor as `staff_id`, today's date, the topic label, and a short note.

Change nothing else. Never edit or delete a row that is already there.

## In numbers

| Setting | Value |
| --- | --- |
| Practice questions after a wrong answer | 2 |
| Practice difficulty, lowest percent correct | 35 |
| Practice difficulty, highest percent correct | 60 |
| History window, latest attempts on the topic | 5 |
| Wrong answers in the window that call for a staff note | 3 |
| Attempts that count in history | every attempt |
| First hint | the hint for the error |
