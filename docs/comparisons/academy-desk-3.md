# Comparisons: Academy desk, third field run

Written on Oct 31, 2026 from the run's stored records. Code: a pinned checkout of Architect at `13ee093c`, with the in-memory patches listed under Limitations. The student in every measured arm was hosted Glimmer. Splits seed 20261116, mentoring seed 1, locked-test seed 101.

## What was asked

Academy desk is a staff-facing operations specialist for a test-prep academy. When a student misses a practice question, staff ask it what happened and what to do. It works from the academy's own files: topic labels, question bank, practice tests, student answers, hints, videos and tutoring policy. It diagnoses the miss, reads the student's history on the topic, sets follow-up practice in the academy's records and flags the student for staff when the policy calls for it. It writes only to `assignments.csv` and `staff_notes.csv`. The checker is deterministic and scores facts and file changes, never wording.

The question: does a harness that Spark builds for Glimmer, then refines on Glimmer's own failed practice attempts, pass more tasks than Glimmer on a blank harness? That includes academies the harness was never taught on, one of them real.

The plan was written before any arm ran and kept in the run folder, with dated amendments. It is not in a public registry, so its times are file times. The last amendment, written before calibration, fixed the code, the arms, the caps and the commands.

- **Primary.** Academy desk minus bare on each unseen organization on its own, paired task by task: Juniper Study House (48 tasks) and the Real academy (30). Wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). A gain counts only if the interval is above zero; otherwise "no gain shown".
- **Secondary.** The same on the taught academies' test split (48, "seen"), each skill in each group, what each round changed, latency and spend.
- **Rule.** No rerun or tuning after any locked result. If the runner paused for money, the run would stop there and be reported. It never paused.

## Organizations and tasks

| Organization | Kind | Role | Locked-test tasks |
| --- | --- | --- | --- |
| Copperfield Learning, Thistlewood Learning, Bramble Hill Academy | generated (`examples/academy`) | taught on: Spark studied them, Glimmer practiced on them | 48 ("seen") |
| Juniper Study House | generated | never seen; sealed in the vault | 48 |
| Real academy | real, anonymized | never seen; sealed in the vault | 30 |

The generated academies differ on purpose. Each one states its own date in every request, uses one of three test layouts, writes grid-in answers its own way, labels topics with stray spaces and punctuation, and writes its policy as a table, as prose or as bullets.

The Real academy is a second anonymized snapshot of a real tutoring academy: 40 graded practice-test attempts from Sep 19 to Oct 2, 2026, by 17 students on 22 practice tests, 2,232 answers in all, with students renamed and tests renumbered. It has no question text, error list or hint catalog. So only three skills were checked there: diagnose (topic and right answer), history and assign, 10 tasks each, built from its records alone as of Oct 2, 2026. Its `policy.md` was drafted for these tests from its records and flag rules. The academy did not write it.

**Tasks.** 222 in all: 48 for each generated academy (8 of each of six skills) and 30 for the Real academy. The taught academies' 144 tasks split into 12 calibration, 48 train, 36 dev and 48 test. Each locked test is 126 tasks. Job `66f5ccc40812`, tasks `04dd77d73a23`, checker `e5e22d2f0d28`, all pinned before the run.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | `79cdd027657f` |
| 2 | One-shot draft (not measured) | Spark writes the harness once, from the job and the confirmed study. This arm is only Academy desk's starting point: its development ran, but its locked test was held and never run. | `e55b3701236e` |
| 3 | Academy desk | Starts from the draft's harness. Each round, Spark reads Glimmer's failed practice attempts and makes one change. The change is kept only if it clears the job's keep rule on dev (+2, no skill down more than the rule allows, patience 4). Two rounds at most. | `38c5250c3d6b` |

Before any arm ran, Spark read the three taught academies' files and wrote a study brief (1 call, $0.11). It was confirmed through the runner's own step, with a script passing its token in place of the person. A text search found no mention of Juniper or the Real academy in it. The bare arm does not get the brief.

Models: student `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback; mentor `muse-spark-1.3` on Meta's API, unstreamed. Every arm froze before any locked test opened. The runner released bare's and Academy desk's tests together at 01:25:55 UTC on Oct 31.

Calibration, to price an attempt: the bare student passed 7 of the 12 calibration tasks (diagnose 2/3, solve 3/3, hint 0/3, history 2/3) at $0.0080 an attempt.

## What the draft and the two rounds changed

Dev is the 36 dev tasks of the taught academies. A kept round is confirmed on new seeds over two runs, so its totals are out of 72.

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft | **A policy-first harness with helpers.** Spark replaced the blank harness with one skill per task type, each reading `policy.md` first. It added three helper tools (`history_calc`, `practice_find`, `next_id`), retrieval rules and low-temperature decoding. Predicted +18 to +28. | kept (a draft is kept without a check) | 11/36 to 14/36 |
| Round 1 | **Tool-call order and the ANSWER line.** Most failed train attempts stopped after one turn with a malformed batch of read calls and no answer. Spark rewrote the main rules and four skills to make calls in order, in valid form, and to always end with the answer. Predicted +2 to +6. | kept | first run 13/36 to 18/36; confirmed 25/72 to 34/72 |
| Round 2 | **One tool call per turn.** The malformed first-turn batch was still the main failure. Spark changed the rules to allow exactly one call per turn and edited the tutoring-turn and history skills. Predicted +2 to +5. | kept | first run 17/36 to 20/36; confirmed 34/72 to 41/72 |

Counterexample-guided repair was switched off, as registered, so no round searched for counterexamples or showed any. The keep rule picked these dev gains, so they lean upward. They show what each change did on dev and are not claimed as results.

## Money

- **Hosted student: $7.35** by OpenRouter's credits endpoint (usage went from 25.4242 to 32.7713), calibration included, of the $9 cap. The runner's journal shows $7.35 settled, plus at most $0.03 for 2 requests cut off when the runner process died (see Limitations). The attempts record holds $7.28: calibration $0.10, bare $1.70, draft $0.54, Academy desk $4.94.
- **Spark: $0.44** recorded, of the $3 cap: study $0.11, draft $0.14 (50,266 tokens in, 17,346 out), Academy desk's two rounds $0.19 (116,520 in, 17,002 out). Every call was recorded.
- **Compute: $0.** No training job ran and no local GPU was used. Ollama's process list was empty at every check.

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $1.70 ($1.36 of it the locked test) | 162 |
| One-shot draft | $0.14 | $0.54 | 72 |
| Academy desk | $0.19 | $4.94 ($1.68 of it the locked test) | 474 |

Academy desk's development cost, including the draft it starts from: Spark $0.33, student $3.80. The arms did not have equal budgets.

## Locked test, hosted Glimmer

The settings each arm ran with. The harness sets them, so each row compares a whole configuration.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| Academy desk | 0 | 1 | 1 | high | 30 | 8,192 |

### Per arm and group

Tasks passed out of the total, with a 95% Wilson interval in brackets.

| Arm | Seen (48) | Juniper (48) | Real academy (30) | All (126) |
| --- | --- | --- | --- | --- |
| Bare | 15, 31.3% (19.9 to 45.3) | 15, 31.3% (19.9 to 45.3) | 13, 43.3% (27.4 to 60.8) | 43, 34.1% (26.4 to 42.8) |
| Academy desk | 24, 50.0% (36.4 to 63.6) | 31, 64.6% (50.4 to 76.6) | 3, 10.0% (3.5 to 25.6) | 58, 46.0% (37.6 to 54.7) |

### Per skill and group

The Real academy had no solve, hint or tutoring-turn tasks.

| Skill | Group | Bare | Academy desk |
| --- | --- | --- | --- |
| Diagnose | Seen | 5/9 | 6/9 |
| | Juniper | 4/8 | 4/8 |
| | Real academy | 6/10 | 3/10 |
| Solve | Seen | 6/6 | 6/6 |
| | Juniper | 8/8 | 8/8 |
| Hint | Seen | 2/9 | 7/9 |
| | Juniper | 3/8 | 7/8 |
| History | Seen | 1/6 | 1/6 |
| | Juniper | 0/8 | 5/8 |
| | Real academy | 7/10 | 0/10 |
| Assign | Seen | 1/9 | 4/9 |
| | Juniper | 0/8 | 6/8 |
| | Real academy | 0/10 | 0/10 |
| Tutoring turn | Seen | 0/9 | 0/9 |
| | Juniper | 0/8 | 1/8 |

### Paired results

Task by task under seed 101. A win is a task Academy desk passed and bare failed; a loss is the reverse. The difference is Academy desk's pass rate minus bare's, in percentage points, with a Newcombe 95% interval. The two bold rows are the primary comparisons.

| Pair | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | Gain shown | Wins/losses by skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Academy desk vs bare** | Juniper | 48 | 18 / 2 | 13 / 15 | +33.3 (+16.2 to +47.5) | yes | assign 6/0, history 5/0, hint 4/0, diagnose 2/2, tutoring turn 1/0 |
| **Academy desk vs bare** | Real academy | 30 | 0 / 10 | 3 / 17 | -33.3 (-50.3 to -14.2) | no: worse, interval below zero | history 0/7, diagnose 0/3 |
| Academy desk vs bare | Seen | 48 | 13 / 4 | 11 / 20 | +18.8 (+2.0 to +33.9) | yes | hint 5/0, assign 4/1, diagnose 3/2, history 1/1 |
| Academy desk vs bare | All | 126 | 31 / 16 | 27 / 52 | +11.9 (+1.3 to +22.1) | yes | |

### Latency

Median seconds per attempt, with the 95th percentile of all 126 in brackets: bare 27.5 (85.6), Academy desk 25.5 (226.2). By group, bare took 34.6 on seen, 25.0 on Juniper and 25.9 on the Real academy. Academy desk took 24.2, 22.4 and 29.3. Academy desk's long tail is mostly the Real academy's history attempts: all of them ran to the 30-step limit, at 153 to 677 seconds each.

## What the numbers support

- **Juniper Study House: a gain.** Academy desk passed 31 of 48, bare 15. The paired difference is +33.3 points with an interval above zero (18 wins, 2 losses), coming from assign, history and hint. Solve was 8 of 8 for both. The tutoring turn stayed near zero for both (bare 0, Academy desk 1 of 8).
- **Real academy: no gain, and Academy desk did worse.** It passed 3 of 30, bare 13. The difference is -33.3 points, and the interval (-50.3 to -14.2) lies below zero, so this is a loss, not just a missing gain. Academy desk lost 7 history and 3 diagnose tasks to bare and won none. Assign was 0 of 10 for both arms, probably because no arm could pass it (see the next section).
- **Seen academies:** +18.8 points, with the interval just above zero.
- By the preregistered rule, the primary result is split: a gain on the unseen generated academy and a loss on the real one. The first run pointed the same way, but this time the Real academy result is clearly negative.

These results are for hosted Glimmer under one seed. They do not describe the local 2-bit build.

## Why Academy desk missed on the Real academy

The locked-test records keep pass or fail, the stop reason and latency, but not the replies or tool calls. So the causes below come from two offline checks with no model: replaying Academy desk's own tools on the Real academy's files, and checking its routing rules against the wording of the requests. Both were done after the test, and nothing from them was shown to the mentor. The details are in the run folder's `MISSES.md`.

- **Diagnose: no skill loaded.** The harness loads its diagnose skill on phrases like "what topic" or "right choice". The Real academy's requests ask "Which topic was that, and what was the right answer?", so none of the 10 matched, while every generated academy's diagnose request did. Five of the seven misses answered within two seconds, which fits answering without a lookup.
- **History: the tool was right, but the agent never answered.** Given the inputs the Real academy's policy states, the history tool returns the expected result on all 10 tasks. Yet every one of Academy desk's attempts hit the 30-step limit. The skill tells the agent to read a "window days" value from the policy, and the tool requires it, but the Real academy's policy has no such row. The skill also spells out the taught academies' own rules by name. An agent limited to one call per turn, looking for a number that isn't there, runs out of steps. That fits the records, but the records can't confirm it.
- **Assign: probably impossible to pass.** The Real academy's `assignments.csv` is empty. Its drafted policy says to number new rows "in the same format" as the existing ids, and doesn't say what to use when there are none. The taught academies' policies say "A-0001", and the checker expects `A-0001` onward. Academy desk's practice tool picked the right number of questions on all 10 tasks. Both arms scored 0.

## Limitations

- **The second run's halt.** This run replaces the second run, which stopped twice. First its OpenRouter workspace budget ran out. Then the runner dropped the main arm for money and released the bare and draft locked tests in the same second. Two attempts per arm were recorded before it was stopped, and nobody opened them. The same 126 tasks are reused here. Since decision 081 the runner pauses in that case instead of dropping the arm.
- **The fingerprint bug.** In the second run the vault's leak gate refused every Spark call on this job. The mentor sees sample rows of the taught academies' files, and some locked-test answers repeat one of those rows. The fingerprint did not leave the taught data out, so it treated those rows as leaks. As a result, the second run's draft call was refused, and its "one-shot draft" arm was really a blank harness with only the study's procedure added. Decision 082 fixed this at `13ee093c`. In an offline check before this run, a freshly sealed copy refused 0 of the 86 parts of the draft's payload and still recognized every locked-test task's own prompt. Here the draft call passed the gate.
- **Patches.** These were applied in memory as the runner loaded the engine; the checkout's files were not changed. As in the second run, the study's output limit went from 8,000 to 16,000 tokens, the targeted arm's Spark cap from $5 to $1.35, and counterexample-guided repair (decision 078) was switched off. The draft's locked test was also taken out of its projection and skipped by the pre-release check and the release, so it never ran. That is why the runner ended `incomplete`, as planned.
- **The runner process died once.** About 15 minutes into the locked tests, the agent session that had started the runner ended, and the runner ended with it. Every arm had already frozen and no result had been read. It was resumed with the same command. Recorded attempts were not repeated, and the two cut-off requests are counted at their worst.
- **Arm caps overrun on the locked test.** The runner's report shows bare at $1.70 against its $1.56 projected cap, and Academy desk at $4.94 against $4.56. The $9 cap for the whole run held.
- **No traces.** Locked-test traces are not kept, so the causes of the misses above are inferred, not observed.
- **The Real academy's assign tasks were unpassable in this run.** All 10 asked for new rows in an empty `assignments.csv` while the files stated no id format, and the checker expected `A-0001` onward, so no arm could pass them. The builder was fixed afterwards: when the file has no ids and the policy states no first id, the checker accepts any non-blank, distinct ids not already in the file. The committed tasks and generated academies are unchanged. This run's numbers stand as measured, with those 10 tasks counted as failed for both arms.
- **The Real academy's tasks.** 30 tasks from one snapshot of 17 students, 10 per skill, sharing students and files. Its policy was drafted for these tests and awaits the academy's confirmation. It has no days row, and it leaves out the rule for numbering ids in an empty file, which probably makes its 10 assign tasks impossible for every arm.
- **Hosted, not local; one seed.** Every number is hosted Glimmer through DeepInfra under locked-test seed 101. Each graduate is set to run the `muse-glimmer:30b-iq2` build locally, and that build was not measured.
- **No draft result.** The draft has no locked result, so this run can't say how much of Academy desk's gain came from the draft and how much from the rounds.
- **Unequal settings and budgets.** Bare runs at temperature 1 with 16 turns and low reasoning; Academy desk at temperature 0 with 30 turns and high reasoning. Academy desk used about three times bare's student spend.
- **A scripted study confirmation.** A script passed the study's token in place of a person.
- **Dev leans upward.** The keep rule picked the dev results. Only the locked test is claimed.
