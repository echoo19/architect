# Comparisons: Sweep desk, first run

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at `field/main` `71ac222e`, unchanged and with no patch; one setting by flag, listed under Method. The student in every arm was hosted Glimmer. Splits seed 20261103, mentoring seed 1, locked-test seed 101, one seed per arm. Run folder: `architect-runs/sweep-1` (PLAN.md written before anything ran, SPEND.md, analysis.json).

## The result

No gain was shown. Taught by Spark, Sweep desk passed **11 of 48** tasks at Fennick Research, the research group it was never taught on. Glimmer on a blank harness passed **15 of 48**. Paired task by task that is **-8.3 points (95% interval -22.5 to +6.2)**: 4 wins and 8 losses. The interval includes zero, so by the registered rule this is neither a gain nor a loss. On all 84 tasks it passed 22 against bare's 31, -10.7 points (-22.1 to +1.0), which comes close to a loss without showing one.

The taught arm never refined anything. Its only refinement round stopped before Spark answered: the engine's leak check refused the mentor call, because the failed practice attempts it would have sent matched 3 locked-test tasks. So the taught arm took the final test on Spark's one-shot draft, unchanged. Its result against the draft (22 against 24 of 84) is the same harness run twice, not an effect of mentoring.

This is hosted Glimmer, one seed, and four generated research groups. The limits are at the end.

## What was asked

Sweep desk reads an ML research group's training runs and answers by the group's own conventions. It finds the best configuration of a sweep, says where training should have stopped, spots runs that diverged, judges whether a change helped, proposes the next runs, and writes the sweep report. The question, registered before anything ran: does a harness that Spark builds for Glimmer, and then refines on Glimmer's own failed practice attempts, pass more of the sealed final test than Glimmer on a blank harness, including a group it was never taught on?

## Groups and tasks

| Group | Role | Locked-test tasks |
| --- | --- | --- |
| Halden Lab, Quill Systems Group, Marlow Learning Group | taught on: Spark studied them, Glimmer practiced on them | 36 ("seen") |
| Fennick Research | never seen; sealed in the vault | 48 |

192 tasks, 48 per group, 8 per skill (best_config, early_stop, diverged, did_it_help, next_runs, sweep_report). From the taught groups: 12 calibration, 60 train, 36 dev and 36 test. Every Fennick task is in the locked test. The keep rule from the job: at least +2 on dev, no skill down more than 1, patience 4, train batch 12. Spark's study of the three taught groups cost $0.115 and never names Fennick.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | `b4181541f7c9` |
| 2 | One-shot draft (secondary) | Spark writes the harness once, from the job and the confirmed study, without seeing Glimmer try anything. | `639e8f46cb02` |
| 3 | Sweep desk (taught) | Starts from the draft's harness. Each round, Spark reads Glimmer's failed practice attempts and makes one change, kept only by the keep rule on dev. Two rounds at most. | `639e8f46cb02` (unchanged) |

Graduates, kept in the run's data folder: taught `grd_mvxje7m1b36408ffaf`, draft `grd_mvxj6s1nb979cb9905`, bare `grd_mvxizkuxb17f80faca`.

## Method

- The comparisons runner of `71ac222e`, run as the plan registered. No in-memory patch: the study's output limit (16,000 tokens) is in the product now.
- One setting by flag: `--spark-cap targeted=1.6`, so that two refinement rounds had room. The draft kept the default $1.
- Headroom: the plan said 1.9 if every arm fit under $15 at 1.9, else the default 1.2. At 1.9 the runner refused to fund the taught arm ($9.27 needed, $8.95 left) before sending anything, so the run used 1.2 (PLAN.md, amendment 2). My arithmetic in the plan had been wrong: the headroom multiplies the printed projections.

## What the draft changed, and why the rounds didn't run

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft | **Four sweep tools and a skill per kind of question.** Spark expected Glimmer to trip on each group's own conventions: metric names, steps against epochs, column names, how a run is scored (mean of the last K against the minimum), divergence factors, early-stop patience, how a paired difference is judged, and next-run budgets and grids. It wrote `analyze_sweep`, `early_stop_check`, `paired_compare` and `plan_next`, which do the arithmetic from the group's policy, plus five skills, retrieval rules and decoding at temperature 0 with up to 30 turns. Predicted +22 to +30. | kept (a draft is kept without a check) | 8/36 to 9/36 |
| Round 1 | None. The engine refused the mentor call before it was sent: *"its payload matched 3 locked test tasks, in train task marlow-next_runs-01 and train task quill-next_runs-08."* | stopped by the leak check | none |
| Round 2 | Not run: the arm stopped after round 1. | | |

The leak check is invariant 1 at work: the mentor never sees the locked test. Two practice tasks of the next_runs kind carry text that matches test tasks closely enough to trip it. That likely points at how Sweep desk's tasks are generated across splits; it is not something a run can fix.

## Money

Both caps held. Hosted Glimmer **$6.14** of $15 by the request journal ($6.08 billed over 4,664 requests, plus $0.06 over 3 requests that failed partway, counted at their worst). Spark **$0.32** of $3 (the study $0.115 and the draft $0.205; the taught arm's refused call cost nothing).

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $1.43 ($1.03 of it the locked test) | 120 |
| One-shot draft | $0.21 | $2.36 ($1.49 of it the locked test) | 156 |
| Sweep desk | $0.00 | $2.15 ($1.59 of it the locked test) | 132 |

Calibration (12 attempts, 3 passed) cost $0.14. The runner's report shows the draft's student spend at $2.36 of a $2.11 funded share; the run-wide cap held, and whether an arm's share is meant to stop it is left to check in the runner's code.

## Locked test, hosted Glimmer

Hosted Glimmer on OpenRouter, pinned to DeepInfra with no fallback. One seed (101).

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 32 | high | 30 | 8,192 |
| Sweep desk | 0 | 1 | 32 | high | 30 | 8,192 |

### Per arm and group

Passes, the pass rate and its 95% Wilson interval.

| Arm | Seen (36) | Fennick Research (48) | All (84) |
| --- | --- | --- | --- |
| Bare | 16, 44.4% (29.5 to 60.4) | 15, 31.3% (19.9 to 45.3) | 31, 36.9% (27.4 to 47.6) |
| One-shot draft | 11, 30.6% (18.0 to 46.9) | 13, 27.1% (16.6 to 41.0) | 24, 28.6% (20.0 to 39.0) |
| Sweep desk | 11, 30.6% (18.0 to 46.9) | 11, 22.9% (13.3 to 36.5) | 22, 26.2% (18.0 to 36.5) |

### Paired differences

The first arm's pass rate less the second's, in points, with Newcombe's 95% interval for paired proportions (method 10).

| Pair | Group | Wins / losses | Difference (95% interval) | Shown |
| --- | --- | --- | --- | --- |
| Sweep desk vs bare | Fennick (primary) | 4 / 8 | -8.3 (-22.5 to +6.2) | no gain, no loss |
| Sweep desk vs bare | Seen | 4 / 9 | -13.9 (-32.2 to +5.9) | no gain, no loss |
| Sweep desk vs bare | All | 8 / 17 | -10.7 (-22.1 to +1.0) | no gain, no loss |
| Draft vs bare | Fennick | 4 / 6 | -4.2 (-17.4 to +9.3) | no gain, no loss |
| Draft vs bare | All | 6 / 13 | -8.3 (-18.4 to +2.0) | no gain, no loss |
| Sweep desk vs draft | All | 4 / 6 | -2.4 (-10.2 to +5.4) | same harness, run twice |

### Per skill and group

Passes of tasks in each cell (seen: 6 a skill; Fennick: 8 a skill).

| Skill | Bare, seen | Draft, seen | Taught, seen | Bare, Fennick | Draft, Fennick | Taught, Fennick |
| --- | --- | --- | --- | --- | --- | --- |
| best_config | 1 | 1 | 3 | 1 | 2 | 1 |
| early_stop | 6 | 4 | 3 | 8 | 5 | 5 |
| diverged | 5 | 5 | 3 | 5 | 6 | 4 |
| did_it_help | 1 | 0 | 0 | 1 | 0 | 1 |
| next_runs | 3 | 1 | 2 | 0 | 0 | 0 |
| sweep_report | 0 | 0 | 0 | 0 | 0 | 0 |

No arm passed a sweep report anywhere. The draft's tools didn't help where bare was already strong (early stopping), and its gains on best_config were small and not consistent across the two runs of the same harness.

### How the failures ended

| Arm | Failed tasks | Stopped at the turn limit | Answered wrong | Error |
| --- | --- | --- | --- | --- |
| Bare | 53 | 29 | 24 | 0 |
| One-shot draft | 60 | 22 | 37 | 1 |
| Sweep desk | 62 | 30 | 31 | 1 |

About half the failures in every arm ran out of turns before answering. Median time per task: bare 22.8 s, draft 22.1 s, taught 25.4 s. The 95th percentile was about 93 s for the draft and the taught arm, against 46 s for bare, since the draft's harness has twice the turns and calls tools more.

## Limits

- One seed per arm, hosted Glimmer only; nothing here describes the local build the graduates are set to run on.
- The taught arm is the draft's harness: the mentoring this run was meant to measure didn't happen, because the leak check stopped it. This run says nothing about what Spark's refinement rounds do on Sweep desk.
- The registered comparison mixes in the bare arm's different decoding (temperature 1, 16 turns, low reasoning). That is how the arms are defined, not a fault, but bare's higher score may owe something to it.
- Four generated research groups. Fennick is synthetic.
- Dev gains picked by the keep rule lean upward and are not claimed; the draft's dev went 8/36 to 9/36 against a prediction of +22 to +30.

## What it means for the next run

The leak check did its job, and it stopped the experiment. Before Sweep desk is taught again, its task generator needs to keep next_runs prompts in the train split apart from those in the test split, so that a practice attempt can be shown to the mentor. The same matching attempts also keep Sweep desk's demonstrations from being exported for fine-tuning (`docs/comparisons/qlora-1.md` is not written yet for this reason; see `architect-runs/qlora-1/PLAN.md`).
