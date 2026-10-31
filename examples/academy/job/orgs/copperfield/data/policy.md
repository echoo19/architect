# How we tutor at Copperfield Learning

When a student misses a question on a practice test, Copperfield Learning follows the steps below. The Tutor and every tutor work the same way, and only from our own records.

## Our records

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

## Right after a wrong answer

First work out what went wrong: which question it was, its topic, its right choice, and the error in errors.csv (for that topic) that turns the right answer into the one the student chose. When two errors give the same choice, either is fine.

Before they try again, give the student the approved hint written for that error (the row of hints.csv with that error_id). If no hint has been written for it yet, use the topic's general hint, the one with no error_id.

Then point the student to one lesson video from the topic's folder and set follow-up practice: five questions from the bank on the same topic that the student has never attempted and has not already been given, with difficulty_pct between 45 and 80 (both ends count). Any such questions will do, but never the same one twice. If fewer than five qualify, set all of them and say how many.

Each practice question is a new row in assignments.csv: the next assignment_id after the highest one in the file, in the same format (A-0001 if the file is empty); the student; the question; the date of the request as assigned_on; and the student's tutor as assigned_by.

Last, look at the student's history on the topic as of the date of the request (see below). If it calls for escalation, leave one note in staff_notes.csv for the tutor: the next note_id, the student, the tutor as staff_id, the date of the request, the topic and a short note.

Change nothing else, and never edit or delete a row that's already there.

## Reading a student's history

History is always read as of a date: the date the request gives, or else the day it is made. Answers taken after that date don't count. Only a student's first answer to each question counts; the answers from a retake don't. Take the latest 6 of the answers that count on the topic, ordered by date, then module, then question number, or all of them if there are fewer. Report how many that is, how many were right, and the accuracy as a whole percent (right answers divided by answers, rounded half up).

A student needs escalation when the answers that count, taken in the 30 days ending on that date (the date and the 29 days before it), include 4 or more wrong answers.
