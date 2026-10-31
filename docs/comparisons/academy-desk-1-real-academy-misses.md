# Academy desk, first field run: why it missed on the Real academy

This is a post-hoc diagnosis of a retired test. It was written after the locked results, to plan the next candidate on a fresh cohort. It does not re-score anything, no arm was rerun, and nothing here goes to the mentor. The 24 Real academy tasks have now been read in detail, so a change shaped by this page has to be measured on tasks and records the author has not looked at.

## What the stored records allow

The locked-test attempts keep pass or fail, the checker's reason (the field that is wrong, and for assign only "Failed."), the stop reason and the latency. They do not keep Academy desk's replies or tool calls, so no trajectory on these 24 tasks exists. Two kinds of evidence are used below.

- **Replayed.** Academy desk's final tools (`question_lookup`, `policy_lookup`, `history_calc`, `practice_pick`, harness version 4) were run offline against the Real academy's files, with the arguments each task implies and a small stand-in for the sandbox's `readTable` and `readText`. No model, no network, no GPU. The output was compared with the task's expected values. A replay shows what the tool returned, which is certain.
- **Inferred.** What the model did with that output. Stored reasons and stop reasons are consistent with it. The replies are not stored, so it is not confirmed.

## What happened

Academy desk on the Real academy: assign 7 of 8, history 3 of 8, diagnose 2 of 8. Bare: 0, 5, 4. Academy desk missed 12 tasks. Bare also missed 6 of them (diagnose 01 to 04, history 01, assign 07). Academy desk lost 6 tasks that bare passed: diagnose 06 and 07, history 02, 03, 04 and 07.

| Task | Bare | Academy desk's reason | Cause | Evidence |
| --- | --- | --- | --- | --- |
| diagnose 01, 02, 03, 04 | also missed (step limit) | step limit, 43 to 60 s | `question_lookup` cannot find the question: Math sits on "Full" tests | replayed |
| diagnose 06, 07 | passed | step limit, 51 and 60 s | same, for Reading and Writing on "Full" tests | replayed |
| history 02 | passed | correct is wrong | answers written another way are counted wrong | replayed |
| history 01, 03, 07 | missed 01, passed 03 and 07 | as_of is wrong | agent's header date is Nov 16, the request says Oct 30 | inferred |
| history 04 | passed | attempts is wrong | topic label with two spaces | inferred |
| assign 07 | also missed | "Failed." (6.3 s) | not diagnosable from the records | none |

## Diagnose: the question lookup assumed one section per test

Six of eight diagnose tasks ended at the 30-step limit (43 to 60 s each). The two that passed took 6 s and 49 s.

`question_lookup` finds a row of `tests.csv` where the test name, section, module and number all equal the request's, then reads that row's question. It was written and measured on dev only against the generated academies, where each practice test has one section and a position is unique.

In the Real academy's `tests.csv` that is false. Of the 19 practice tests, 11 list their section as "Full", and within each module the Reading and Writing questions and the Math questions are numbered separately. Of the 563 positions in those tests, 259 are shared by two questions, one of each section. The section of a question is only in `questions.csv`. The requests name "Math" or "Reading and Writing", which never equals "Full".

Replay: the lookup returned the right question for diagnose 05 (a Reading and Writing-only test) and threw "test position not found" for the other seven, every one on a "Full" test. Four of those are Math requests (01 to 04) and three are Reading and Writing requests (06, 07, 08).

What the model did next is inferred: Academy desk's `AGENTS.md` says "NEVER read all of questions.csv or tests.csv (too big)" and every skill points at `question_lookup`, so after the error the model had no sanctioned route. Six attempts ran out of steps. One of the three Reading and Writing requests on "Full" tests (08) passed, so a route did exist inside 30 steps. Bare, which has no such rule, passed all three of them and the Reading and Writing-only one. It also ran out of steps on all four Math requests, so Math on "Full" tests was hard for both arms.

A route that works without the lookup: `attempts.csv` holds one row per student answer with the test, section, module, number, question id, topic, the pick and the key. A filter on student, test name and position answers a diagnose request from that table alone, and the section there is "Math" or "Reading and Writing".

Also in play: the Real academy's files are far larger than any generated one (1,197 question rows and 1,197 test rows against 216 to 324 and 120). The "too big" rule was reasonable for a generated academy and shut off the fallback on this one.

## History: three separate causes

Academy desk missed 5 of 8. The generated academies' history tasks went 14 of 14 on Harborview and seen combined for Academy desk, so the helper itself is sound on their files.

**Correct answers compared as text (history 02, replayed).** `history_calc` counts an answer right when `selected` equals `correct` as strings. The academy marks its own `result` column, and 11 of the 1,990 answers are marked right although the picked text differs from the key, because the number is written another way (0.125 for 1/8, 9.333 for 28/3). One of them sits in this task's window of 6. The helper returns 4 right (67%), the expected value is 5 (83%), and the checker said "correct is wrong". The draft arm shares the same helper and missed the same task for the same reason. The reference solver reads `result`. The window and attempt counts were right, so only `correct` and `accuracy_pct` were off.

**The agent's date (history 01, 03 and 07, inferred).** The job has one business date, Nov 16, 2026, and the engine prints it as "Today is Monday, 2026-11-16" in the system prompt. The generated academies' requests agree with it. The Real academy's requests were built as of Oct 30 and say "It's Friday, October 30, 2026". The history skill (inherited from the draft) says "as_of is today in header unless request says another as-of date". The checker's reason on these three is as_of, which it tests first.

Replay of the helper with as_of 2026-10-30 gives the expected answer on all three. With 2026-11-16 the as_of field is wrong and, for 01 and 03, so is escalation (the 21-day window ending Nov 16 holds no wrong answers, the one ending Oct 30 holds 3). So the helper is not at fault. The model's own as_of is, and the only place a Nov 16 date exists is the header. The draft made the same mistake on history 03 and bare on history 06, so it is not unique to Academy desk's harness. Three misses for Academy desk against one each for the others is too few to say Academy desk is worse at it.

One counter-point: the checker tests `assigned_on`, and 7 of Academy desk's 8 assign tasks passed, so on those the written date was Oct 30, the request's date. The model did not always follow the header. The two skills read different instructions, so this does not settle history.

**A topic label with two spaces (history 04, inferred).** Two of the academy's 38 topic labels contain two consecutive spaces. This task asks about one of them. `history_calc` filters with exact equality on `topic`. Replay: with the exact label it returns the expected 4 of 4; with the spaces collapsed to one it finds 0 rows. The checker's reason is attempts, with as_of correct. That fits a label passed with the space collapsed, and so a count of 0, or a fallback to some other count. It also fits other mistakes. The records hold 4 attempts on the topic, all of them counted, so a different count more likely comes from the match than from the date or the window.

## Assign: 7 of 8, one miss

Replay of `practice_pick` on all eight tasks returns the expected number of picks (1, 2, 5, 5, 5, 5, 5, 5), the expected next ids (A-0001 onward, from a header-only `assignments.csv`) and a null tutor, which matches the expected empty `assigned_by`. The tool is right on this academy, and it is what took assign from 0 of 8 to 7 of 8. The miss on assign 07 took 6.3 s against 13 to 33 s for the seven passes, and the stored reason is only "Failed.". That is too little to say more. Possibly the rows were not appended or were written with a wrong field. It is listed here as unexplained.

## What did not go wrong

- `policy_lookup` read the Real academy's policy correctly (5 questions, band 40 to 70, window 6, 3 wrong answers in 21 days, first attempts only, hint rule "error"). This is not evidence that it reads a policy written by an academy. The Real academy's policy was drafted for this test in the table layout the tool's patterns match, with the number rows worded as the generated academies word theirs. The "hint rule" came out as "error" only because the row says "none" and has no "general". Nothing here needs a hint, so it did no harm.
- The checker's expected values for the history and assign tasks match the reference solver (every Real academy task was solved by the reference with the agent's own tools before the run).
- Students' missing tutor ids did not break the assign tool or the checker.

## For the next candidate

Each of these is a change to the harness the mentor writes or to the run setup. Each needs a measurement on a fresh Real academy snapshot and fresh tasks, not on these 24.

1. A lookup from a request to a question must not assume that test, section, module and number identify one row. Join on `question_id` and check the section in `questions.csv`, or answer from the student's own row in `attempts.csv`. A tool that throws should leave the skill a named fallback, and the rule against reading whole files should depend on size.
2. Count right and wrong from the academy's `result` column, not by comparing text.
3. Take `as_of` and `assigned_on` from the date the request states. For setup: make the business date a property of each organization, or build the Real academy's tasks as of the job's date. Both give the same header and request.
4. Compare topic labels with spaces collapsed on both sides.
5. Try `policy_lookup`-style tools on a policy the academy wrote, in its own layout, before reading anything into 7 of 8 on assign.
6. Keep the Real academy's size in the dev tasks so a rule written for 120-row files meets a 1,200-row file before the locked test. The mentor never sees the Real academy, so this means a generated academy with a large bank and "Full"-style tests, not the academy's records.
