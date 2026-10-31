# Comparisons: Academy desk, first field run

Written on Oct 30, 2026 from the run's stored records, at commit `86d29f05` with the patches listed under Limitations. The student in every arm was hosted Glimmer. Splits seed 20261116, mentoring seed 1, locked test seed 101.

## What was asked

Academy desk is an operations agent for the staff of a test-prep academy. A student has just missed a practice question and staff ask Academy desk what to do. Academy desk answers from the academy's own files: its topic labels, question bank, practice tests, student answers, hints, videos and tutoring policy. The checker is deterministic and scores facts and file changes, never wording.

The question for this run: does a harness that Spark builds for Glimmer, and then refines on Glimmer's own failed practice attempts, pass more tasks than Glimmer on a blank harness? This includes academies the harness was never taught on, one of them a real academy.

The plan was written before any arm ran and kept in the run folder. It is not in a public registry, so its times are file times. One amendment was made after the calibration and the study and before the first arm started: the number of rounds, the headroom on the budget projection, and a change that asks Spark's replies unstreamed (see Limitations). The plan text dates the amendment "about 09:50"; the file was last saved at 09:48 local and the first arm started at 09:48:50, so that time is approximate.

- **Primary.** Academy desk minus bare on each unseen organization on its own, paired task by task: Harborview Prep (48 tasks) and the Real academy (24 tasks). Wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). A gain counts only if the interval is above zero. Otherwise the report says no gain shown.
- **Secondary.** The same on the seen academies' test split (48 tasks), the draft against bare, Academy desk against the draft, each skill in each group, latency, spend, and what each round changed.
- **Rule.** No rerun or tuning after any locked result. A result with no gain is reported as it is.
- **Seeds.** Locked-test seeds 101 and 102 were declared. Seed 102 was meant for a decoding repeat that was not run, so every result here is under seed 101.

## Organizations

| Organization | Kind | Role in the run | Locked-test tasks |
| --- | --- | --- | --- |
| Ridgeline Test Prep, Wrenfield Prep, Lakemont Scholars | generated, from seeds in `examples/academy` | taught on: Spark studied them and Glimmer practiced on them | 48 (the three academies' test split, called "seen") |
| Harborview Prep | generated | never seen by Spark or Glimmer; sealed in the vault | 48 |
| Real academy | real, anonymized | never seen; sealed in the vault | 24 |

The generated academies differ in topic labels, id formats, question wording and policy numbers. Harborview uses a practice count, difficulty band and escalation rule that no taught academy uses.

The Real academy is a real tutoring academy's records, anonymized: students and staff renamed, tests and questions renumbered, no emails, phone numbers or free text, dates and the academy's own topic labels kept. The snapshot is the 40 most recent graded practice-test attempts (16 students, 19 practice tests, 1,990 answers) with the question list those tests use (1,197 questions). Its records have no question text, no answer choices, no error list, no hint catalog and no tutor assignments. So only three skills could be checked there: `diagnose` (topic and right answer only), `history` and `assign`. The anonymized records are not published and stay outside the repository. In every table it is called "Real academy".

Its `policy.md` was drafted for this test and was not written by the academy. It awaits the academy's confirmation. The numbers for follow-up practice (5 questions, difficulty 40 to 70) and history (latest 6, 3 wrong answers in 21 days) were carried over from the generated academies. Only the flag rules came from the academy.

**Tasks.** 216 in all: 192 for the generated academies (48 each, 8 of each of six skills) and 24 for the Real academy (8 each of `diagnose`, `history` and `assign`, built from its records alone as of Oct 30, 2026, seed 20261030). The three taught academies' 144 tasks split into 12 calibration, 48 train, 36 dev and 48 test, stratified by skill. Harborview's 48 and the Real academy's 24 are test only. Each arm's locked test is therefore 120 tasks: 48 seen, 48 Harborview, 24 Real academy. Job `2d749c16098e`, tasks `a5cc7dc66da7`, checker `6ab3bda4bad3`, pinned before the run.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark. | `79cdd027657f` |
| 2 | One-shot draft | Spark writes the harness once, from the job and the study, and it is kept without a check. | `8e4b3f3d270b` |
| 3 | Academy desk | Starts from the draft's harness. Each round Spark reads Glimmer's failed practice attempts and makes one change, kept only if it clears the job's keep rule on dev (+2 on dev, no skill losing more than the rule allows, patience 4). Three rounds at most. | `8430022212bd` |

Before any arm, Spark read the three taught academies' files and wrote a study brief. A script standing in for the person's step confirmed it, and it was saved and put beside the draft's and Academy desk's job copies. The bare arm does not get it. The transfer academies were never studied.

Models: student `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback (bf16, as DeepInfra lists it); mentor `muse-spark-1.3` on Meta's API. Every arm froze before any locked test opened, and the runner released the tests only once all three were frozen, at 14:07:32 UTC.

Calibration, to price an attempt: the bare student on the 12 calibration tasks passed 8 (diagnose 3/3, solve 3/3, hint 2/3, history 0/3), at $0.0093 an attempt and a median of 18.2 s.

## What the three rounds changed

Academy desk's three rounds took about 15 minutes and $0.31 of Spark. Dev is the 36 dev tasks of the taught academies. A kept round is confirmed on new seeds over two runs, so its totals are out of 72.

| Round | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| 1 | **Question lookup.** The draft's student read the whole `tests.csv` and `questions.csv` into context to find one question. On large banks that overflowed context and ended with a malformed call and no answer. Spark added a `question_lookup` tool (test, section, module and number to question, topic, errors, hints and videos) and a rule against reading those two files whole. | kept | first run 17/36 to 25/36; confirmed 36/72 to 51/72 (assign 3 to 11, after_wrong 0 to 4, hint 4 to 7, diagnose 7 to 9, history 10 to 8) |
| 2 | **Policy-aware practice pick.** Spark changed `practice_pick` to read the practice count and band from `policy.md` itself, and edited the assign skill and the retrieval rules. | reverted | 24/36 to 23/36, short of the +2 margin (hint 4 to 2, history 3 to 1) |
| 3 | **`policy_lookup` helper.** Spark found that failed attempts died on their first turn with a malformed call while reading `policy.md` by hand to get the numbers. It added a `policy_lookup` tool that returns the practice count, band, history window, escalation threshold and days, the first-attempts-only flag and the hint rule, and told every skill to call it instead. | kept | first run 24/36 to 35/36; confirmed 46/72 to 71/72 (after_wrong 2 to 11, hint 6 to 12, history 6 to 12, diagnose 9 to 12, assign 11 to 12) |

Spark predicted +2 to +6 on dev for rounds 1 and 2 and +2 to +5 for round 3. Dev gains were picked by the keep rule and lean upward. They show what each change did on dev and are not claimed as results.

Round 3's tool finds each number in the policy's table with a fixed pattern for that row. On the taught academies it worked on dev. A replay against the Real academy's drafted policy also returned the right numbers, but that policy was written in the same table layout (see Limitations).

## Money

- **Hosted student: $4.2579** by the attempts record ($4.1459 for the arms and $0.1120 for calibration), of the $12 cap. OpenRouter's credits endpoint shows $4.2566 used. All 5,090 requests were billed by the provider with a known charge.
- **Spark: $0.4347** for the runner (draft $0.1283, Academy desk $0.3063), plus $0.0700 for the study call, so $0.5047 recorded. A first study call failed because Meta's stream came without its usage figures, so the engine refused it as uncountable, although Meta billed it. Its cost, about $0.07, is an estimate at the size of the study call that succeeded. About fifteen small probe calls (about $0.01) are also estimated. With both estimates Spark spent about $0.58 of the $5 cap.
- **Compute: $0.** No training job. No local GPU was used; Ollama's process list was empty before and after every step.

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $1.34 | 156 |
| One-shot draft | $0.13 (51,828 in, 14,952 out) | $1.02 | 192 |
| Academy desk | $0.31 (183,662 in, 35,572 out) | $1.78 | 552 |

Academy desk's cumulative development cost, including the draft it starts from: Spark $0.43, student $1.61. The arms did not have equal budgets.

## Locked test, hosted Glimmer

Settings each arm ran with. The harness sets them, so each row compares a whole configuration.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 64 | medium | 30 | 8,192 |
| Academy desk | 0 | 1 | 64 | medium | 30 | 8,192 |

### Per arm and group

Passed out of tasks, with a 95% Wilson interval in brackets.

| Arm | Seen (48) | Harborview (48) | Real academy (24) | All (120) |
| --- | --- | --- | --- | --- |
| Bare | 21, 43.8% (30.7 to 57.7) | 24, 50.0% (36.4 to 63.6) | 9, 37.5% (21.2 to 57.3) | 54, 45.0% (36.4 to 53.9) |
| One-shot draft | 22, 45.8% (32.6 to 59.7) | 22, 45.8% (32.6 to 59.7) | 11, 45.8% (27.9 to 64.9) | 55, 45.8% (37.2 to 54.7) |
| Academy desk | 44, 91.7% (80.4 to 96.7) | 43, 89.6% (77.8 to 95.5) | 12, 50.0% (31.4 to 68.6) | 99, 82.5% (74.7 to 88.3) |

The job's target is 90%. As observed, Academy desk met it on the seen academies (44 of 48) and was one task short on Harborview (43 of 48, where 44 are needed). The generated report's "Target" column was computed against 48 tasks for every arm and reads "meets" even for bare at 45%. Ignore that column.

### Per skill and group

Passed out of tasks. The Real academy had no tasks for solve, hint and tutoring turn.

| Skill | Group | Bare | One-shot draft | Academy desk |
| --- | --- | --- | --- | --- |
| Diagnose | Seen | 6/9 | 6/9 | 8/9 |
| | Harborview | 6/8 | 8/8 | 6/8 |
| | Real academy | 4/8 | 4/8 | 2/8 |
| Solve | Seen | 6/6 | 6/6 | 6/6 |
| | Harborview | 8/8 | 8/8 | 8/8 |
| Hint | Seen | 2/9 | 3/9 | 9/9 |
| | Harborview | 4/8 | 1/8 | 7/8 |
| History | Seen | 5/6 | 4/6 | 6/6 |
| | Harborview | 5/8 | 2/8 | 8/8 |
| | Real academy | 5/8 | 6/8 | 3/8 |
| Assign | Seen | 2/9 | 3/9 | 8/9 |
| | Harborview | 1/8 | 3/8 | 8/8 |
| | Real academy | 0/8 | 1/8 | 7/8 |
| Tutoring turn | Seen | 0/9 | 0/9 | 7/9 |
| | Harborview | 0/8 | 0/8 | 6/8 |

### Paired results

Scenario by scenario under seed 101. A win is a task the first arm passed and the second failed; a loss is the reverse. The difference is the first arm's pass rate less the second's, in percentage points, with a 95% interval. The two bold rows are the primary comparisons.

| Pair | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | Wins/losses by skill |
| --- | --- | --- | --- | --- | --- | --- |
| **Academy desk vs bare** | Harborview | 48 | 20 / 1 | 23 / 4 | +39.6 (+22.9 to +53.7) | diagnose 1/1, hint 3/0, history 3/0, assign 7/0, tutoring turn 6/0 |
| **Academy desk vs bare** | Real academy | 24 | 9 / 6 | 3 / 6 | +12.5 (-17.9 to +40.2) | diagnose 0/2, history 2/4, assign 7/0 |
| Academy desk vs bare | Seen | 48 | 24 / 1 | 20 / 3 | +47.9 (+30.3 to +61.7) | diagnose 2/0, hint 7/0, history 1/0, assign 7/1, tutoring turn 7/0 |
| Academy desk vs bare | All | 120 | 53 / 8 | 46 / 13 | +37.5 (+25.9 to +47.7) | |
| Draft vs bare | Harborview | 48 | 6 / 8 | 16 / 18 | -4.2 (-19.2 to +11.2) | diagnose 2/0, hint 0/3, history 1/4, assign 3/1 |
| Draft vs bare | Real academy | 24 | 6 / 4 | 5 / 9 | +8.3 (-17.5 to +32.6) | diagnose 2/2, history 3/2, assign 1/0 |
| Draft vs bare | Seen | 48 | 8 / 7 | 14 / 19 | +2.1 (-13.7 to +17.7) | diagnose 2/2, hint 3/2, history 0/1, assign 3/2 |
| Draft vs bare | All | 120 | 20 / 19 | 35 / 46 | +0.8 (-9.4 to +11.0) | |
| Academy desk vs draft | Harborview | 48 | 23 / 2 | 20 / 3 | +43.8 (+25.6 to +58.3) | |
| Academy desk vs draft | Real academy | 24 | 7 / 6 | 5 / 6 | +4.2 (-23.6 to +31.0) | |
| Academy desk vs draft | Seen | 48 | 23 / 1 | 21 / 3 | +45.8 (+28.4 to +59.8) | |

### Latency

Median time per attempt in seconds, with the 95th percentile for all 120 in brackets: bare 15.4 (30.8), draft 3.2 (46.0), Academy desk 9.1 (59.2). By group, bare took 14.5 on seen, 13.9 on Harborview and 21.9 on the Real academy; the draft 1.9, 3.7 and 12.4; Academy desk 8.0, 8.3 and 25.6. The draft's low median goes with many answers sent within about three seconds. On the Real academy its 7 failed assign attempts took 1.2 to 2.6 s each. The stored records do not keep the replies, so what it answered from is not shown.

## What the numbers support

- **Harborview Prep.** Academy desk passed 43 of 48 and bare 24 of 48. The paired difference is +39.6 points with an interval above zero (20 wins, 1 loss). A gain is shown on this one generated academy that Academy desk never saw. The wins come from assign (7), tutoring turn (6), hint (3) and history (3). Solve was 8 of 8 for every arm and diagnose was level (1 win, 1 loss).
- **Real academy.** Academy desk passed 12 of 24 and bare 9 of 24. The difference is +12.5 points with an interval from -17.9 to +40.2, so no gain is shown. By skill, assign went from 0 of 8 to 7 of 8 (7 wins, 0 losses; 6 of bare's 8 attempts ended at the turn limit). History fell from 5 to 3 and diagnose from 4 to 2, which makes 6 tasks that bare passed and Academy desk missed. Eight tasks per skill from 16 students is too few to call any one of these a difference in either direction.
- **Draft.** The one-shot draft showed no gain over bare in any group. On Harborview its hint and history scores were lower (hint 4 to 1, history 5 to 2 of 8), though those intervals include zero too.
- **Academy desk against the draft.** Gains on the seen academies and on Harborview. None shown on the Real academy.

These are results for hosted Glimmer under one seed. They do not describe the local 2-bit build.

## Why Academy desk missed on the Real academy

The stored locked-test records keep pass or fail, the checker's reason and the stop reason. They do not keep the replies or tool calls. So the causes below come from replaying Academy desk's own tools against the Real academy's files, with no model, and from the checker's reasons. This was done after the test, which is now retired, and nothing from it was shown to the mentor.

- **Diagnose (6 of 8 missed, all at the 30-step limit).** The `question_lookup` tool matches a test by its section. In 11 of the 19 practice tests the records list the section as "Full" and number the Reading and Writing and Math questions separately within each module. Seven of the eight diagnose requests name a section on such a test, and the tool answered "test position not found" for all seven. Bare, which has no rule against reading files whole, passed all four Reading and Writing diagnose tasks. Academy desk passed two.
- **History (5 of 8 missed).** One task failed because the history helper marks an answer right only when the picked text equals the key, while the academy marks 11 answers right that were written another way (for example 0.125 for 1/8). Three failed on `as_of`. The agent's header gave Nov 16, the job's single business date, while the Real academy's requests say Oct 30. One failed on the attempt count, and its topic label has two consecutive spaces, which an exact-match topic filter misses if the space is collapsed. The last two causes fit the records and are not confirmed by them.

## Limitations

- **Hosted, not local.** Every number is hosted bf16 Glimmer through DeepInfra. The graduate is set to run `muse-glimmer:30b-iq2` locally, and that build was not measured. Hosted and local rows are never compared.
- **One seed.** One mentoring seed and one locked-test seed. Seed 102 was declared and not run, so there is no repeat of decoding or of the mentoring.
- **Small Real academy.** 24 tasks from one snapshot of 16 students, 8 per skill. The tasks share students and files, so they are not independent.
- **What the Real academy could check.** It had no question text. Only history, assign and the topic and right answer of diagnose could be scored. Hint, solve and the tutoring turn were not tested there.
- **Its policy was drafted for this test** and awaits the academy's confirmation. Its follow-up and history numbers came from the generated academies and sit close to Lakemont's (5 questions, 3 wrong answers in 21 days, window 6). Transfer to its numbers is weaker evidence than Harborview's, which uses numbers no taught academy has. The drafted policy was also written in the table layout the task builder and Academy desk's `policy_lookup` read. An academy's own policy text was not tried.
- **One date for every organization.** The job carries one business date, Nov 16, 2026. The Real academy's tasks were built as of Oct 30, so its requests and the agent's header disagreed. This probably cost history answers (see above).
- **The runner was patched for organization jobs.** The comparisons runner is a copy outside the repo. In the copy, the locked test counts the transfer organizations' tasks (120, not 48) in its projections and credit checks; the confirmed study is carried into each arm's job copy; the bare arm imports the blank harness; each arm's job copy lists the sealed organizations (the first attempt stopped at once with an error before any arm started); and the targeted arm's Spark cap is $3.50, not $5. Spark's calls are asked for unstreamed, because about one Meta stream in three ended without usage figures. The record-based task builder has one change: a wrong answer on a test with a blank module is never picked, because the request cannot name its module. The runner's own tests pass on the copy. The patches are in the run folder.
- **A scripted study.** The study brief was confirmed by a script, not by a person.
- **Dev results lean upward.** The keep rule picked them. Only the locked test is claimed.
- **Spark's cost is partly estimated.** The failed first study call and the probe calls are estimates, about $0.08 together.
- **Harness only.** No weights were trained. The Spark reference, decoding repeat, fixed intervention and adapter arms were not run.
- **Settings differ by arm.** Bare runs at temperature 1 with a 16-turn limit and low reasoning. The draft and Academy desk run at temperature 0 with 30 turns and medium reasoning. The comparison is of whole configurations.
