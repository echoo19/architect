# Bramble Hill Academy: tutoring policy

This is how Bramble Hill Academy tutors a student right after a wrong answer, and how staff read a student's record. The Tutor, the academy's tutor, follows it, and so do the staff.

## The records

- `students.csv`: each student, their target score, test date and tutor (`tutor_id`, a row of `staff.csv`).
- `topics.csv`: the academy's topic labels, with the section and the folder of lesson videos for each.
- `questions.csv`: the question bank, with full text, the right choice and `difficulty_pct`, the percent of students who get the question right (a higher number is an easier question).
- `tests.csv`: which bank question sits where in each practice test.
- `attempts.csv`: every answer a student gave on a practice test, with what they picked, the right answer and whether they got it right.
- `errors.csv`: for each topic, the errors our answer explanations name. Each wrong choice in the bank comes from one of its topic's errors.
- `hints.csv`: the approved first hints. The Tutor gives only these hints, by id, and never writes its own.
- `videos.csv`: the lesson videos, each in a topic's folder.
- `assignments.csv` and `staff_notes.csv`: practice set for students and notes left for staff. New rows go at the end.

`result` in attempts.csv is the academy's own mark, and it is final. A grid-in answer can be entered more than one way (1/8, 0.125 and .125 are the same answer), so `selected` and `correct` can differ on a right answer: count right and wrong from `result`, never by comparing the two.

## Diagnosing a wrong answer

Find the question the student answered, its topic and its right choice. Then name the error behind the choice they picked: the row of `errors.csv` for that topic whose error produces that choice. If two errors produce the same choice, either one is right.

## The first hint

Always give the topic's general hint first, the row in hints.csv with no error_id, whatever the student chose. Hints written for a particular error are for the second try.

## History on a topic

A student's history on a topic is read as of a date: the one the request names, or else the day the request is made. Attempts taken after that date are left out. Only a student's first attempt at each question counts. When a student retakes a test, the retake's answers do not count toward history. Of the attempts that count, take the latest 5, ordered by the date taken, then module, then question number (fewer if the student has fewer). Report how many attempts that is, how many were right, and the accuracy: right answers divided by those attempts, as a whole percent, rounded half up.

Escalation looks at time, not at the window: escalate when the attempts that count, taken in the 21 days ending on that date (the date itself and the 20 before it), hold 3 or more wrong answers.

## Follow-up practice

Assign 4 questions from the bank. Each must be of the same topic, never attempted by the student on any test, not already assigned to them, and with `difficulty_pct` from 45 to 80, both included. Any questions that meet these rules will do; never assign the same question twice. If fewer than 4 questions qualify, assign all that do and say how many.

Each question is one row of `assignments.csv`: a new `assignment_id` (number on from the highest id already in the file, in the same format, one per row; A-0001 if the file has none yet), the student, the question, the day the request is made as `assigned_on`, and the student's tutor as `assigned_by`.

## The tutoring turn after a wrong answer

1. Diagnose the answer: the topic, the right choice and the error.
2. Give the first hint, by its id.
3. Point the student to one lesson video from the topic's folder.
4. Assign the follow-up practice.
5. Read the student's history on the topic as of the day of the request. If it calls for escalation, add one row to `staff_notes.csv` for the student's tutor: a new `note_id` (numbered on, like assignments), the student, the tutor as `staff_id`, that day's date, the topic label, and a short note.

Change nothing else. Never edit or delete a row that is already there.

## In numbers

| Setting | Value |
| --- | --- |
| Practice questions after a wrong answer | 4 |
| Practice difficulty, lowest percent correct | 45 |
| Practice difficulty, highest percent correct | 80 |
| History window, latest attempts on the topic | 5 |
| Wrong answers that call for a staff note | 3 |
| Days those wrong answers are counted over | 21 |
| Attempts that count in history | first attempts only |
| First hint | the general hint |
