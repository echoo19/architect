# Comparisons: Assay desk, first field run

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at `v0.8.0` (`ab7fcff9`), with two in-memory patches listed under Method. The student in every arm was hosted Glimmer. Splits seed 20261031, mentoring seed 1, locked-test seed 101.

## The result

**No gain shown, and the taught arm was never taught.** On Corvid Hill Discovery, the lab no arm ever saw, the taught Assay desk passed 7 of 48 final-test tasks and bare Glimmer passed 7 of 48: 7 wins, 7 losses, a difference of 0.0 points (95% interval -15.6 to +15.6). Its first refinement round stopped on its Spark budget before it changed anything, so the taught arm ran Spark's one-shot draft harness, unchanged. That draft, measured as its own arm, passed 10 of 48 on Corvid Hill: +6.3 points over bare (-9.8 to +22.0), also no gain shown. Across all 84 final-test tasks, bare passed 14, the draft 18 and the taught arm 14.

This run doesn't show that Spark's refinement rounds work on a screening lab, because none ran. What it does show: the system runs end to end on a field outside education, with a lab sealed from the mentor. Spark's one-shot setup for that field didn't help Glimmer by a margin this test can detect. And the same frozen harness, run twice, disagreed on 12 of 84 tasks.

## What was asked

Assay desk helps a screening lab read its plate-reader exports. A scientist asks it about a plate: a well's percent inhibition, whether the plate passed QC, which compounds are hits, whether replicate wells agree, and what goes in the re-test queue. It works only from the lab's own files and policy and writes only to `retests.csv`. The checker is deterministic and scores numbers, sets and file changes, never wording.

The question: does a harness that Spark builds for Glimmer, then refines on Glimmer's own failed practice attempts, pass more of the final test than Glimmer on a blank harness, on a lab it was never taught on?

The plan was written before any arm ran and kept in the run folder, with dated amendments. It is not in a public registry, so its times are file times.

- **Primary.** Taught minus bare on Corvid Hill (48 tasks), paired task by task: wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). A gain counts only if the interval is above zero; otherwise "no gain shown".
- **Secondary.** The same on the taught labs' test split (36, "seen") and on all 84; draft minus bare and taught minus draft; each skill in each group; what each round changed; latency and spend.
- **Rule.** No rerun or tuning after any locked result. If the runner paused for money, the run would stop there. It never paused.

## Labs and tasks

| Lab | Role | Locked-test tasks |
| --- | --- | --- |
| Fenwick Screening Core, Alder Row Biosciences, Saltmarsh Institute Assay Lab | taught on: Spark studied them, Glimmer practiced on them | 36 ("seen") |
| Corvid Hill Discovery | never seen; sealed in the vault | 48 |

All four labs are generated from seeds (`examples/assay-desk`). None is a real lab. They differ on purpose: each works on its own date, owns two or three of three plate readers with different export formats, puts its controls in different wells, writes values in mixed styles, and writes its policy as a table, as prose or as bullets, with its own numbers. Corvid Hill uses numbers no taught lab uses (hit at 2.5 SD, lowest Z′ 0.45) and is the only lab with all three readers.

**Tasks.** 192 in all, 48 per lab, 8 of each of six skills: normalize, hits, plate QC, replicates, re-test plan and plate report. The taught labs' 144 split into 12 calibration, 60 train, 36 dev and 36 test. Each locked test is 84 tasks. Job `df874d019906`, tasks `251462024680`, checker `a80c60e8370b`, pinned before the run. This was the job's first calibration on Glimmer.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | `fa2eb07584d0` |
| 2 | One-shot draft | Spark writes the harness once, from the job and the confirmed study. The taught arm's starting point; 0.8.0 also runs its locked test, so it is reported as a secondary arm. | `5dc1dede5a08` |
| 3 | Taught (runner arm `targeted`) | Starts from the draft's harness. Each round, Spark reads Glimmer's failed practice attempts and makes one change, kept only if it clears the job's keep rule on dev (+2, no skill down more than 1, patience 4). Two rounds at most. | `5dc1dede5a08`, the draft's, unchanged |

Before any arm ran, Spark read the three taught labs' files and wrote a study brief (1 call, $0.06). It was confirmed through the runner's own step, with a script passing its token in place of the person. A text search found no mention of Corvid Hill in it. The bare arm does not get the brief.

Models: student `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback; mentor `muse-spark-1.3` on Meta's API. Every arm froze before any locked test opened. The runner released all three tests together at 05:54:54 UTC on Nov 1.

Calibration, to price an attempt: the bare student passed 2 of the 12 calibration tasks (plate QC 0/3, replicates 2/3, re-test plan 0/3, plate report 0/3) at $0.0084 an attempt.

## Method, and what changed before the results

- **Two in-memory patches**, applied as the runner loaded the engine; the checkout's files were not changed. First, the study's output limit went from 8,000 to 16,000 tokens: at 8,000, Spark's first study of these labs was cut off and failed. Second, the taught arm's Spark cap went from $5 to $0.55: unpatched, the runner funds that arm only with $5 of Spark left after the draft's $1, which a $2 or $3 Spark cap can't give. Both are being fixed in the product separately.
- **The caps were raised once, before any result.** The run began under $7 of student spend and $2 of Spark, at 1 round. The owner then added credit and asked for the strongest honest run: $15 and $3, at 2 rounds. No locked test had been released (the runner's release barrier was empty and the stopped arms had no test attempts), so the first run was stopped five minutes in. A confirmed plan pins its rounds and caps, so the run moved to a new output folder. Calibration was reused from the first folder; Spark's study was made again ($0.06) and confirmed with its new token.
- **Settings in the final run:** `--student-usd 14 --spark-usd 2.5 --rounds 2 --headroom 1.9`, which keeps the whole run under $15 and $3 with what the first folder had spent. The higher headroom was there so a harness that calls more tools wouldn't be paused for money. It never came close.

## What the draft and the rounds changed

Dev is the 36 dev tasks of the taught labs.

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft | **An exact-calculation harness driven by the policy.** Spark replaced the blank harness with one skill per task type and a procedure, a helper tool (`assay.js`) and two worked examples, at temperature 0 with high reasoning. | kept (a draft is kept without a check) | 4/36 to 9/36 |
| Round 1 | Spark's first call proposed "Trim and case-fold compound ids in assay" (train 3/12 before it). The round's next call needed up to $0.32, and the arm had $0.23 left, so the round stopped before the change was measured. | stopped, nothing kept | none |
| Round 2 | not run: the arm's Spark budget was spent | - | - |

**Why the cap ran out.** The arm that starts from the draft has the draft's Spark spend ($0.19) taken off its own cap, so the $0.55 cap left $0.36 for the rounds. The first call cost $0.13. Spark's gate admits a call only if its worst case, the whole input plus the full output limit, fits what is left. That was a sizing mistake in the plan, made before any result: the third academy run set the same cap at $1.35 for this reason.

The taught arm's first dev measurement of the unchanged draft harness was 11/36, where the draft's own run measured 9/36. The keep rule picked the draft's dev result, so it leans upward and is not claimed.

## Money

- **Hosted student: $3.75 at most**, by the runner's request journals, calibration included, of the $15 cap. The stopped first run: $0.58 settled plus at most $0.06 for 6 requests cut off when it was stopped. The final run: $3.11, all 2,596 requests settled, none cut off. OpenRouter's credits endpoint can't separate this run, because other runs were billing the same key at the same time.
- **Spark: $0.64 recorded**, of the $3 cap. Final run: study $0.06, draft $0.19, taught arm's one call $0.13. The stopped first run: study $0.07, draft $0.20. Add the cut-off first study, whose cost the engine didn't record: at most about $0.10, counted at $0.20.
- **Compute: $0.** No training job ran and no local model was loaded.

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $0.64 ($0.47 of it the locked test) | 120 |
| One-shot draft | $0.19 | $1.25 ($0.70 of it the locked test) | 156 |
| Taught | $0.13 | $1.22 ($0.81 of it the locked test) | 132 |

## Locked test, hosted Glimmer

The settings each arm ran with. The harness sets them, so each row compares a whole configuration.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 64 | high | 25 | 8,192 |
| Taught | 0 | 1 | 64 | high | 25 | 8,192 |

### Per arm and group

Tasks passed out of the total, with a 95% Wilson interval in brackets.

| Arm | Seen (36) | Corvid Hill (48) | All (84) |
| --- | --- | --- | --- |
| Bare | 7, 19.4% (9.8 to 35.0) | 7, 14.6% (7.2 to 27.2) | 14, 16.7% (10.2 to 26.1) |
| One-shot draft | 8, 22.2% (11.7 to 38.1) | 10, 20.8% (11.7 to 34.3) | 18, 21.4% (14.0 to 31.3) |
| Taught | 7, 19.4% (9.8 to 35.0) | 7, 14.6% (7.2 to 27.2) | 14, 16.7% (10.2 to 26.1) |

Bare and the taught arm have the same totals, but not on the same tasks: they disagree on 26 of the 84.

### Per skill and group

| Skill | Group | Bare | One-shot draft | Taught |
| --- | --- | --- | --- | --- |
| Normalize | Seen | 1/6 | 3/6 | 0/6 |
| | Corvid Hill | 1/8 | 3/8 | 3/8 |
| Hits | Seen | 1/6 | 1/6 | 2/6 |
| | Corvid Hill | 1/8 | 2/8 | 0/8 |
| Plate QC | Seen | 2/6 | 1/6 | 2/6 |
| | Corvid Hill | 4/8 | 2/8 | 2/8 |
| Replicates | Seen | 1/6 | 0/6 | 0/6 |
| | Corvid Hill | 1/8 | 2/8 | 2/8 |
| Re-test plan | Seen | 1/6 | 2/6 | 2/6 |
| | Corvid Hill | 0/8 | 0/8 | 0/8 |
| Plate report | Seen | 1/6 | 1/6 | 1/6 |
| | Corvid Hill | 0/8 | 1/8 | 0/8 |

### Paired results

Task by task under seed 101. A win is a task the first arm passed and the second failed; a loss is the reverse. The difference is the first arm's pass rate minus the second's, in percentage points, with a Newcombe 95% interval. The bold row is the primary comparison.

| Pair | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | Gain shown | Wins/losses by skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Taught vs bare** | Corvid Hill | 48 | 7 / 7 | 0 / 34 | 0.0 (-15.6 to +15.6) | no | normalize 3/1, replicates 2/1, QC 2/4, hits 0/1 |
| Taught vs bare | Seen | 36 | 6 / 6 | 1 / 23 | 0.0 (-18.9 to +18.9) | no | hits 2/1, QC 2/2, re-test plan 1/0, plate report 1/1, normalize 0/1, replicates 0/1 |
| Taught vs bare | All | 84 | 13 / 13 | 1 / 57 | 0.0 (-12.0 to +12.0) | no | |
| Draft vs bare | Corvid Hill | 48 | 9 / 6 | 1 / 32 | +6.3 (-9.8 to +22.0) | no | normalize 3/1, hits 2/1, QC 2/4, replicates 1/0, plate report 1/0 |
| Draft vs bare | Seen | 36 | 7 / 6 | 1 / 22 | +2.8 (-16.8 to +22.1) | no | normalize 2/0, re-test plan 2/1, hits 1/1, plate report 1/1, QC 1/2, replicates 0/1 |
| Draft vs bare | All | 84 | 16 / 12 | 2 / 54 | +4.8 (-7.6 to +17.0) | no | |
| Taught vs draft (same harness) | All | 84 | 4 / 8 | 10 / 62 | -4.8 (-13.4 to +3.8) | no | normalize 0/3, hits 1/2, QC 1/0, re-test plan 1/1, replicates 1/1, plate report 0/1 |

### Latency

Median seconds per attempt, with the 95th percentile of all 84 in brackets: bare 2.5 (77.6), draft 16.7 (128.5), taught 17.8 (115.6). Bare often answered at once, without reading a file. Of the failed attempts, the turn limit ended 11 of bare's 70, 7 of the draft's 66 and 10 of the taught arm's 70; one of bare's and one of the draft's ended in an error; the rest gave a wrong answer.

## What the numbers support

- **Corvid Hill: no gain shown.** The taught arm and bare each passed 7 of 48, with 7 wins and 7 losses. The interval, -15.6 to +15.6, is wide enough to hide a real gain or loss of about 15 points.
- **The draft didn't show a gain either.** It led bare by 3 tasks on Corvid Hill and 4 overall. It was better at normalize (6 of 14 against 2 of 14) and worse at plate QC (3 of 14 against 6 of 14). Neither interval clears zero.
- **Every arm is far from the job's 90% target.** The best, the draft, passed 21% of the final test. No arm passed a single Corvid Hill re-test plan, and only the draft passed one Corvid Hill plate report: the tasks that write to `retests.csv` are the hardest here.
- **The same harness doesn't give the same result twice.** The taught arm ran the draft's harness byte for byte (same hash) at temperature 0, under the same seed. It still passed 4 tasks the draft failed and failed 8 the draft passed. That variation is as large as the draft's lead over bare. So a single seed can't separate these arms.

These results are for hosted Glimmer under one seed. They don't describe the local 2-bit build.

## Limitations

- **The taught arm made no change.** Its first round stopped on its Spark cap before Spark's change was measured, and the second never ran. The primary comparison therefore measures Spark's one-shot draft against bare, a second time, and not refinement rounds. The cause was the plan's cap ($0.55, of which the draft's $0.19 was taken first), set before any result. The tests had been released when this was found, so by the run's rule it was not restarted.
- **One seed per arm.** Every number is one run under locked-test seed 101. The same harness run twice moved by 12 tasks out of 84.
- **The patches.** Two in-memory patches (the study's output limit, the taught arm's Spark cap), described under Method. Both are being fixed in the product.
- **A restart before any result.** The run began under lower caps and was stopped five minutes in, with no locked test released, when the caps were raised. Its records stay in the run folder and are used for nothing here. The final run reused its calibration and made Spark's study again, so the brief every arm started from is the second one.
- **An unrecorded Spark call.** The cut-off first study's cost was lost when it failed. It is estimated at most about $0.10 and counted at $0.20.
- **Generated labs only.** Corvid Hill is unseen, but it comes from the same generator as the taught labs. This run says nothing about a real screening lab.
- **Hosted, not local.** Every number is hosted Glimmer through DeepInfra. Each graduate is set to run the `muse-glimmer:30b-iq2` build locally, and that build was not measured.
- **Unequal settings and budgets.** Bare runs at temperature 1 with 16 turns and low reasoning, the draft and taught arm at temperature 0 with 25 turns and high reasoning. They used about twice bare's student spend.
- **A scripted study confirmation.** A script passed the study's token in place of a person.
- **No look at the failures.** I opened no locked-test task, trace or Corvid Hill file. The causes of the misses are unknown beyond the counts, skills and stop reasons above.
- **Dev leans upward.** The keep rule picked the dev results. Only the locked test is claimed.

## Records

Run folder `architect-runs/assay-1`: `PLAN.md` (the registration and its amendments, each written before the result it could affect), `run.sh`, `plan.sh`, the logs, `SPEND.md`, `FROZEN.md`, `analysis.json`, and the runner's own `cmp-2/report.md`. The taught agent is graduate `grd_mvxf15ff9903be0d43`, version 1, in `assay-1/agent-data`, a copy of the run's data folder that the app or CLI can open (`ARCHITECT_USER_DATA`). The draft's graduate, `grd_mvxeounob7d293e110`, holds the same harness with the draft's change in its lineage.
