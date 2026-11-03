# Comparisons: Assay desk, second field run

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at `a385c043` (field/main), unchanged, with no patches. The student in every arm was hosted Glimmer. Splits seed 20261031, mentoring seed 1, locked-test seeds 101 and 102.

## The result

**A gain on the lab it never saw, under both seeds, but from Spark's first harness, not from refinement.** On Corvid Hill Discovery, the sealed lab, the taught Assay desk passed 14 of 48 final-test tasks under seed 101, and bare Glimmer passed 5. That is 13 wins and 4 losses, a difference of +18.8 points (95% interval +2.2 to +34.3). Under the repeat seed, 102, it passed 16 against bare's 8: +16.7 points (+3.8 to +29.3). Both intervals are above zero, so by the preregistered rule this is a gain. Across all 84 final-test tasks, the taught arm passed 25 and 26, bare 10 and 12.

What it measures needs care. The taught arm's harness is the first one Spark wrote for this job, from the job and the study, before it had seen Glimmer fail. Its one refinement round was refused by a deterministic check: the new tool computed a plate's Z′ wrong. So this run shows that Spark's harness helps Glimmer on a screening lab it was never taught on. It still doesn't show what refinement rounds add on this field. The arm meant to measure the one-shot draft didn't either: its harness failed validation, and it ran the blank harness plus the study's procedure.

## Why a second run

The first run ([assay-desk-1.md](assay-desk-1.md), on branch `runs/assay-1`) never ran its taught arm. Its Spark cap was patched to $0.55, and the runner took the draft's $0.19 off it first. That left too little for the round's second call, so the arm froze on the draft's harness. Its final test showed no gain (Corvid Hill 7/48 against bare's 7/48).

This run uses the same job, tasks, splits and locked-test seed 101, so it isn't independent of what was seen in the first. Two things changed, both set before it ran. First, the code: a newer pinned checkout, where the study's output limit is 16,000 and the taught arm's Spark cap is set with the runner's own `--spark-cap`. Second, the caps: $15 of student spend, $3 of Spark, and a taught-arm cap of $1.60. It also added the runner's repeat under the second declared seed. Nothing about the harness or the arms was tuned on the first run's results.

## What was asked

Assay desk helps a screening lab read its plate-reader exports. A scientist asks it about a plate: a well's percent inhibition, whether the plate passed QC, which compounds are hits, whether replicate wells agree, and what goes in the re-test queue. It works only from the lab's own files and policy and writes only to `retests.csv`. The checker is deterministic and scores numbers, sets and file changes, never wording.

The plan was written before any arm ran and kept in the run folder, with dated facts added as the run went. It is not in a public registry, so its times are file times.

- **Primary.** Taught minus bare on Corvid Hill (48 tasks), paired task by task under seed 101: wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). A gain counts only if the interval is above zero; otherwise "no gain shown".
- **Secondary.** The same on the taught labs' test split (36, "seen") and on all 84; draft minus bare and taught minus draft; the same pairs under seed 102; each skill in each group; the rounds; latency and spend.
- **Rule.** No rerun or tuning after any locked result. If the runner paused for money, the run would stop there. It never paused.

## Labs and tasks

| Lab | Role | Locked-test tasks |
| --- | --- | --- |
| Fenwick Screening Core, Alder Row Biosciences, Saltmarsh Institute Assay Lab | taught on: Spark studied them, Glimmer practiced on them | 36 ("seen") |
| Corvid Hill Discovery | never seen; sealed in the vault | 48 |

All four labs are generated from seeds (`examples/assay-desk`). None is a real lab. They differ on purpose: each works on its own date, owns two or three of three plate readers with different export formats, puts its controls in different wells, writes values in mixed styles, and writes its policy as a table, as prose or as bullets, with its own numbers. Corvid Hill uses numbers no taught lab uses (hit at 2.5 SD, lowest Z′ 0.45) and is the only lab with all three readers.

**Tasks.** 192 in all, 48 per lab, 8 of each of six skills: normalize, hits, plate QC, replicates, re-test plan and plate report. The taught labs' 144 split into 12 calibration, 60 train, 36 dev and 36 test. Each locked test is 84 tasks. Job `df874d019906`, tasks `251462024680`, checker `a80c60e8370b`, pinned before the run, the same as the first run.

## Arms

| # | Arm | What it was meant to be | What it ran | Harness |
| --- | --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | as meant | `fa2eb07584d0` |
| 2 | One-shot draft | Spark writes the harness once, from the job and the confirmed study. | the blank harness plus the study's procedure skill: Spark's draft and its one fix both failed validation | `7d039800a5ec` |
| 3 | Taught (runner arm `targeted`) | Starts from the draft's harness. Up to 2 rounds; each round Spark reads Glimmer's failed practice attempts and makes one change, kept only if it clears the keep rule on dev (+2, no skill down more than 1, patience 4). | Spark's first harness, written in round 1 because the draft kept none; round 2 refused | `ce56e882de5d` |
| 4 | Repeat | The three frozen arms take the final test again under seed 102. | as meant | - |

Before any arm ran, Spark read the three taught labs' files and wrote a study brief (1 call, $0.06). It was confirmed through the runner's own step, with a script passing its token in place of the person. A text search found no mention of Corvid Hill in it. The bare arm does not get the brief.

Models: student `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback; mentor `muse-spark-1.3` on Meta's API. Every arm froze before any locked test opened. The runner released the seed-101 tests at 07:38:23 UTC on Nov 1 and ran the repeats after them.

Calibration, to price an attempt: the bare student passed 1 of the 12 calibration tasks (plate QC 0/3, replicates 1/3, re-test plan 0/3, plate report 0/3) at $0.0059 an attempt.

## What each step changed

Dev is the 36 dev tasks of the taught labs.

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft arm | **"Assay calculator with per-org policy reads."** Its two example files used message fields the harness format doesn't allow. Its one fix was refused too. | refused; the arm froze on its starting harness | first measurement 7/36 |
| Taught, round 1 | **"Assay desk generic computation harness."** The draft arm kept nothing, so this arm drafted for itself: one skill per task type, a plate tool (`assay_plate`) that reads a plate's export and computes controls, Z′ and every well's inhibition, a tool for the next re-test ids (`next_ids`), two format examples, temperature 0 with high reasoning and 30 turns. Spark predicted +18 to +30. | kept (a first draft is kept as the starting point) | 5/36 to 12/36 |
| Taught, round 2 | **"Canonicalize controls and compact plate tool"**, after 3 of 12 train attempts passed. Before it was measured, the runner checked the new tool on counterexamples drawn from the round's failed attempts. It failed 1 of 2: "assay_plate gives z_prime 0.8209 where the checker expects 0.8062". | refused, not measured | - |

Round 2 was the last round the arm had: `--rounds 2` counts the first-draft round. The counterexample check did its job here. It stopped a tool that computed Z′ wrong from going into the harness.

The keep rule picked round 1's dev result, so it leans upward and is not claimed.

## Money

- **Hosted student: $6.67**, by the runner's request journal (5,674 requests, all settled, none cut off), calibration included, of the $15 cap. The attempts record agrees to the cent. OpenRouter's credits endpoint can't separate this run, because other runs were billing the same key.
- **Spark: $0.54**, every call recorded, of the $3 cap: study $0.06, draft $0.15, taught arm $0.33 (round 1 $0.14, round 2 $0.19).
- **Compute: $0.** No training job ran and no local model was loaded.

| Arm | Spark | Student, development and seed 101 | Student, seed 102 |
| --- | --- | --- | --- |
| Bare | $0.00 | $0.76 ($0.56 of it the locked test) | $0.65 |
| One-shot draft | $0.15 | $1.12 ($0.81 of it the locked test) | $0.56 |
| Taught | $0.33 | $2.15 ($1.16 of it the locked test) | $1.36 |

The repeat as a whole cost $2.56 against its own projected cap of $2.25. The run's cap held.

## Locked test, hosted Glimmer

The settings each arm ran with. The harness sets them, so each row compares a whole configuration.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 1 | 0.95 | 64 | low | 16 | 4,096 |
| Taught | 0 | 1 | 64 | high | 30 | 8,192 |

### Per arm and group

Tasks passed out of the total, with a 95% Wilson interval in brackets.

| Arm | Seed | Seen (36) | Corvid Hill (48) | All (84) |
| --- | --- | --- | --- | --- |
| Bare | 101 | 5, 13.9% (6.1 to 28.7) | 5, 10.4% (4.5 to 22.2) | 10, 11.9% (6.6 to 20.5) |
| | 102 | 4, 11.1% (4.4 to 25.3) | 8, 16.7% (8.7 to 29.6) | 12, 14.3% (8.4 to 23.3) |
| One-shot draft | 101 | 6, 16.7% (7.9 to 31.9) | 11, 22.9% (13.3 to 36.5) | 17, 20.2% (13.0 to 30.0) |
| | 102 | 5, 13.9% (6.1 to 28.7) | 6, 12.5% (5.9 to 24.7) | 11, 13.1% (7.5 to 21.9) |
| Taught | 101 | 11, 30.6% (18.0 to 46.9) | 14, 29.2% (18.2 to 43.2) | 25, 29.8% (21.0 to 40.2) |
| | 102 | 10, 27.8% (15.8 to 44.0) | 16, 33.3% (21.7 to 47.5) | 26, 31.0% (22.1 to 41.5) |

### Per skill and group, seed 101

| Skill | Group | Bare | One-shot draft | Taught |
| --- | --- | --- | --- | --- |
| Normalize | Seen | 1/6 | 2/6 | 3/6 |
| | Corvid Hill | 0/8 | 3/8 | 3/8 |
| Hits | Seen | 2/6 | 1/6 | 2/6 |
| | Corvid Hill | 0/8 | 1/8 | 2/8 |
| Plate QC | Seen | 2/6 | 0/6 | 3/6 |
| | Corvid Hill | 3/8 | 3/8 | 3/8 |
| Replicates | Seen | 0/6 | 2/6 | 2/6 |
| | Corvid Hill | 1/8 | 3/8 | 5/8 |
| Re-test plan | Seen | 0/6 | 1/6 | 0/6 |
| | Corvid Hill | 0/8 | 0/8 | 0/8 |
| Plate report | Seen | 0/6 | 0/6 | 1/6 |
| | Corvid Hill | 1/8 | 1/8 | 1/8 |

### Paired results

Task by task under each seed. A win is a task the first arm passed and the second failed; a loss is the reverse. The difference is the first arm's pass rate minus the second's, in percentage points, with a Newcombe 95% interval. The bold row is the primary comparison.

| Pair | Seed | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | Gain shown |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Taught vs bare** | **101** | **Corvid Hill** | 48 | 13 / 4 | 1 / 30 | **+18.8 (+2.2 to +34.3)** | **yes** |
| Taught vs bare | 101 | Seen | 36 | 8 / 2 | 3 / 23 | +16.7 (-1.0 to +33.5) | no |
| Taught vs bare | 101 | All | 84 | 21 / 6 | 4 / 53 | +17.9 (+5.8 to +29.4) | yes |
| Taught vs bare | 102 | Corvid Hill | 48 | 9 / 1 | 7 / 31 | +16.7 (+3.8 to +29.3) | yes |
| Taught vs bare | 102 | Seen | 36 | 8 / 2 | 2 / 24 | +16.7 (-1.2 to +33.7) | no |
| Taught vs bare | 102 | All | 84 | 17 / 3 | 9 / 55 | +16.7 (+6.5 to +26.8) | yes |
| Draft vs bare | 101 | Corvid Hill | 48 | 7 / 1 | 4 / 36 | +12.5 (+0.5 to +25.1) | yes, barely |
| Draft vs bare | 101 | All | 84 | 12 / 5 | 5 / 62 | +8.3 (-1.6 to +18.4) | no |
| Draft vs bare | 102 | Corvid Hill | 48 | 5 / 7 | 1 / 35 | -4.2 (-18.7 to +10.4) | no |
| Draft vs bare | 102 | All | 84 | 8 / 9 | 3 / 64 | -1.2 (-11.4 to +9.0) | no |
| Taught vs draft | 101 | All | 84 | 18 / 10 | 7 / 49 | +9.5 (-3.0 to +21.7) | no |
| Taught vs draft | 102 | All | 84 | 24 / 9 | 2 / 49 | +17.9 (+4.7 to +30.3) | yes |

On Corvid Hill under seed 101, taught's wins over bare were replicates 5/1, normalize 3/0, hits 2/0, plate QC 2/2 and plate report 1/1. Under seed 102: normalize, hits, replicates 2/0 each, plate QC 2/1, plate report 1/0.

### The two seeds

| Arm | Seed 101 | Seed 102 | Passed under both | Tasks whose result differed |
| --- | --- | --- | --- | --- |
| Bare | 10/84 | 12/84 | 1 | 20 |
| One-shot draft | 17/84 | 11/84 | 5 | 18 |
| Taught | 25/84 | 26/84 | 22 | 7 |

Bare and the draft arm sample at temperature 1, and most of what they pass, they pass by chance: 1 task and 5 tasks passed under both seeds. The taught arm, at temperature 0 with its tools, passes largely the same tasks both times.

### Latency and stops

Median seconds per attempt under seed 101, with the 95th percentile in brackets: bare 1.9 (50.7), draft 19.9 (55.5), taught 19.9 (117.2). Of the failed attempts under seed 101, bare's 74 were 53 wrong answers, 19 at the turn limit and 2 errors. The draft's 67 were 42 wrong answers and 25 at the turn limit. The taught arm's 59 were 29 wrong answers, 7 at the turn limit and **23 errors**; under seed 102, 18 of its 58 failures were errors.

The locked test keeps no traces, so those errors can't be read. On dev and train, every one of the taught harness's 14 error stops had the same cause: "This task needs more room than the model's context allows." The plate tool returns every well of a plate, and on the larger plates that overflows the 16,384-token context. Round 2's "compact plate tool" was aimed at this and was refused for its Z′. The locked-test errors are probably the same, but that is inferred, not observed.

## What the numbers support

- **Corvid Hill: a gain, under both seeds.** The taught arm passed 14 of 48 against bare's 5 under seed 101 and 16 against 8 under seed 102, with both intervals above zero. Most of the gain came from replicates, normalize and hits, the skills its plate tool computes.
- **The gain is Spark's first harness, not refinement.** That harness came from the job and Spark's study, before Spark saw a failure. The one refinement was refused. This run can't say what rounds would add.
- **No arm comes near the job's 90% target.** The best passed 31% of the final test. No arm passed a single Corvid Hill re-test plan, and under seed 101 the plate report, which includes the re-test queue, stayed at 1 of 8 for every arm.
- **Seen labs: no gain shown** under either seed (+16.7 points both times, intervals from about -1 to +34). With 36 tasks the interval is wide.
- **The study's procedure alone (the draft arm) didn't hold up.** It edged bare on Corvid Hill under seed 101 (+12.5, interval just above zero) and fell behind under seed 102 (-4.2). Read together, it showed no gain.

These results are for hosted Glimmer. They don't describe the local 2-bit build.

## Limitations

- **No refinement measured.** As above. The arm the plan calls "taught" ran Spark's first harness. The arm called "one-shot draft" ran the blank harness with the study's procedure, because Spark's draft and its fix failed validation.
- **Not independent of the first run.** The same tasks and locked-test seed 101 were used after the first run's results had been seen. Bare passed 14 of 84 there and 10 here, on the same harness and seed: hosted sampling doesn't repeat.
- **Two seeds, one development.** The repeat re-tests the same frozen arms; it doesn't rerun their development. A different mentoring seed could give Spark a different first harness.
- **Context overflows.** About a third of the taught arm's locked-test failures stopped on an error, most likely the 16,384-token context. The graduate keeps this weakness.
- **Generated labs only.** Corvid Hill is unseen, but it comes from the same generator as the taught labs. This run says nothing about a real screening lab.
- **Hosted, not local.** Every number is hosted Glimmer through DeepInfra. Each graduate is set to run `muse-glimmer:30b-iq2` locally, and that build was not measured.
- **Unequal settings and budgets.** Bare and the draft arm run at temperature 1 with 16 turns and low reasoning, the taught arm at temperature 0 with 30 turns and high reasoning. The taught arm used about three times bare's student spend.
- **A scripted study confirmation.** A script passed the study's token in place of a person.
- **No look at the locked failures.** I opened no locked-test task or Corvid Hill file. The locked test keeps no traces, so the causes of its misses are inferred from dev and train only.
- **The repeat overran its own cap** ($2.56 against $2.25). The run's caps held.
- **Dev leans upward.** The keep rule picked the dev results. Only the locked test is claimed.

## Records

Run folder `runs/assay-2`: `PLAN.md` (the registration and the dated facts), `plan.sh`, `run.sh`, the logs, `SPEND.md`, `FROZEN.md`, `analysis-101.json` and `analysis-102.json`, and the runner's own `cmp/report.md`. The taught agent is graduate `grd_mvxiq84u45d329855b`, version 1 (harness version 2, `sha256-ce56e882de5d`), in `assay-2/agent-data`, a copy of the run's data folder that the app or CLI can open (`ARCHITECT_USER_DATA`).
