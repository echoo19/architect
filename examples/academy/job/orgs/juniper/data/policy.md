# Tutoring rules, Juniper Study House

For Phil and all tutors. Records first, then the rules.

## Records

- `students.csv`: each student, their target score, test date and tutor (`tutor_id`, a row of `staff.csv`).
- `topics.csv`: the academy's topic labels, with the section and the folder of lesson videos for each.
- `questions.csv`: the question bank, with full text, the right choice and `difficulty_pct`, the percent of students who get the question right (a higher number is an easier question).
- `tests.csv`: which bank question sits where in each practice test.
- `attempts.csv`: every answer a student gave on a practice test, with what they picked, the right answer and whether they got it right.
- `errors.csv`: for each topic, the errors our answer explanations name. Each wrong choice in the bank comes from one of its topic's errors.
- `hints.csv`: the approved first hints. Phil gives only these hints, by id, and never writes his own.
- `videos.csv`: the lesson videos, each in a topic's folder.
- `assignments.csv` and `staff_notes.csv`: practice set for students and notes left for staff. New rows go at the end.
- Right or wrong is whatever `result` in attempts.csv says. A grid-in answer may be a fraction or a decimal (1/8, 0.125 or .125), so `selected` and `correct` can differ on a right answer.

## Rules

- Diagnosis: the question, its topic, its right choice, and the error (errors.csv, same topic) that produces the student's choice. Two errors giving the same choice: either is right.
- First hint: the approved hint for that error; if the error has none yet, the topic's general hint (no error_id).
- Practice count: 3 questions per wrong answer.
- Practice difficulty: difficulty_pct 45-75, ends included.
- Practice questions: same topic, never attempted by the student, not already assigned to them, no repeats. Too few qualify: assign all of them and say how many.
- New assignment rows: the next assignment_id after the highest (same format, A-0001 when the file is empty), the student, the question, assigned_on = the date of the request, assigned_by = the student's tutor.
- History: as of the request's date (later answers left out); first answers only (a retake's answers don't count); the latest 6 answers on the topic by date, module, number; report attempts, right answers and accuracy (whole percent, half up).
- Escalation: 3+ wrong answers among the counted answers in the 14 days ending on the as-of date, that date included.
- After a wrong answer: diagnose, first hint, one video from the topic's folder, practice, then the history check; when escalation is due, one row in staff_notes.csv for the tutor (next note_id, student, tutor as staff_id, date of the request, topic, short note).
- Never edit or delete an existing row, and write nothing else.
