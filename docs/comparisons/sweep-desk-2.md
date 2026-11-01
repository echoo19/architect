# Comparisons: Sweep desk, second run

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at `field/main` `3b29a8e4`, unchanged and with no patch; one setting by flag, listed under Method. The student in every arm was hosted Glimmer. Splits seed 20261103, mentoring seed 1, locked-test seed 101, one seed per arm. Run folder: `architect-runs/sweep-2` (PLAN.md written before anything ran, SPEND.md, analysis.json).

## Why there is a second run

The first run ([sweep-desk-1.md](sweep-desk-1.md)) never measured mentoring. The engine's leak check refused the taught arm's only mentor call, because two of the practice tasks it would have shown Spark, `marlow-next_runs-01` and `quill-next_runs-08`, matched locked-test tasks. The cause was in Sweep desk's task generator: sweeps shared one learning-rate ladder, so next_runs prompts in different splits read alike. It was fixed on `field/main` (`3b29a8e4`): each sweep has its own ladder, and a split-leak test runs the vault's detector over the generated splits. The tasks and checker changed, so this is a new job version, registered again with the same protocol, and none of the first run's results carry over.

## The result

The registered primary outcome: **no gain was shown** at Fennick Research, the research group neither model saw. Taught by Spark, Sweep desk passed **20 of 48** there; Glimmer on a blank harness passed **15 of 48**. Paired task by task, that is **+10.4 points (95% interval -3.4 to +23.6)**: 8 wins and 3 losses. The interval includes zero.

On all 84 tasks the taught arm passed 37 against bare's 26, **+13.1 points (+1.5 to +24.2)**, a gain by the same rule, on a secondary outcome.

As in the first run, the taught arm took the final test on Spark's one-shot draft unchanged, though this time for another reason. The leak check passed. The first Spark call of its first round read Glimmer's failed practice attempts ($0.43), and the engine refused the next call, which could have cost up to $1.37 against the $0.91 left of the arm's Spark cap. So the gains here are the draft's. The draft alone passed 39 of 84 and **23 of 48 at Fennick, +16.7 points over bare (+2.6 to +29.6)**, a gain on the unseen group, as a secondary arm. The taught arm against the draft (37 against 39) is the same harness run twice.

This is hosted Glimmer, one seed, and four generated research groups. The limits are at the end.

## Groups and tasks

| Group | Role | Locked-test tasks |
| --- | --- | --- |
| Halden Lab, Quill Systems Group, Marlow Learning Group | taught on: Spark studied them, Glimmer practiced on them | 36 ("seen") |
| Fennick Research | never seen; sealed in the vault | 48 |

192 tasks, 48 per group, 8 per skill (best_config, early_stop, diverged, did_it_help, next_runs, sweep_report). From the taught groups: 12 calibration, 60 train, 36 dev and 36 test; every Fennick task is in the locked test. Keep rule: at least +2 on dev, no skill down more than 1, patience 4, train batch 12. Spark's study of the taught groups cost $0.08 and never names Fennick.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | `b4181541f7c9` |
| 2 | One-shot draft (secondary) | Spark writes the harness once, from the job and the confirmed study, without seeing Glimmer try anything. | `bc2d7af15348` |
| 3 | Sweep desk (taught) | Starts from the draft's harness. Each round, Spark reads Glimmer's failed practice attempts and makes one change, kept only by the keep rule on dev. Two rounds at most. | `bc2d7af15348` (unchanged) |

Graduates, kept in the run's data folder: taught `grd_mvxpmxu2ecffc9ddfa`, draft `grd_mvxph2mf43535f82e0`, bare `grd_mvxpaerf3801928ebb`.

## Method

- The comparisons runner of `3b29a8e4`, run as registered, with no in-memory patch.
- One setting by flag, `--spark-cap targeted=1.6`; the draft kept the default $1.
- Headroom 1.9, by the registered rule ($5.70 of base projections × 1.9, plus calibration, at most $15). The shared OpenRouter key had $10.33 of credit left, a little under the worst case. It was written down before the run, and it didn't bind.

## What the draft changed, and why the rounds didn't run

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft | **One sweep tool and a skill per kind of question.** Spark expected Glimmer to carry one group's metric names, scores, divergence and early-stop rules, interval numbers and column names to another, to do arithmetic by hand over thousands of metric rows, and to misparse floats and grids. It wrote one tool, `sweepkit`, that does the computing from the policy's own parameters with column and grid discovery, six skills (one per kind of question), retrieval and guardrail rules, and decoding at temperature 0, medium reasoning, 30 turns. Predicted +14 to +24. | kept (a draft is kept without a check) | 11/36 to 18/36 |
| Round 1 | None kept. 6 of 12 practice attempts passed. Spark's first call read the 6 failures (492,667 tokens in, $0.43). The engine refused the next: *"The next mentor call could cost up to $1.37, more than the $0.91 left in the budget."* | stopped by the Spark cap | none |
| Round 2 | Not run: the arm stopped after round 1. | | |

The cap is the arm's registered $1.60 less the draft's $0.26 that it builds on. Reading six full failed attempts of Sweep desk (whole training-run logs) cost a third of what was left, and the engine holds each next call to its worst case before it is sent, as it should. The caps weren't raised. A run that is to measure Spark's rounds on Sweep desk needs a larger taught-arm cap, set before it runs.

## Money

Both caps held, and every arm stayed inside its funded share. Hosted Glimmer **$3.55** of $15 by the request journal (3,286 requests, all billed by the provider, none cut off). Spark **$0.77** of $3: the study $0.08, the draft $0.26, the taught arm's one call $0.43.

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $1.46 ($1.03 of it the locked test) | 120 |
| One-shot draft | $0.26 | $1.21 ($0.54 of it the locked test) | 156 |
| Sweep desk | $0.43 | $0.79 ($0.51 of it the locked test) | 132 |

Calibration (12 attempts, 3 passed) cost $0.10.

## Locked test, hosted Glimmer

Hosted Glimmer on OpenRouter, pinned to DeepInfra with no fallback. One seed (101).

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 64 | medium | 30 | 8,192 |
| Sweep desk | 0 | 1 | 64 | medium | 30 | 8,192 |

### Per arm and group

Passes, the pass rate and its 95% Wilson interval.

| Arm | Seen (36) | Fennick Research (48) | All (84) |
| --- | --- | --- | --- |
| Bare | 11, 30.6% (18.0 to 46.9) | 15, 31.3% (19.9 to 45.3) | 26, 31.0% (22.1 to 41.5) |
| One-shot draft | 16, 44.4% (29.5 to 60.4) | 23, 47.9% (34.5 to 61.7) | 39, 46.4% (36.2 to 57.0) |
| Sweep desk | 17, 47.2% (32.0 to 63.0) | 20, 41.7% (28.8 to 55.7) | 37, 44.0% (33.9 to 54.7) |

### Paired differences

The first arm's pass rate less the second's, in points, with Newcombe's 95% interval for paired proportions (method 10).

| Pair | Group | Wins / losses | Difference (95% interval) | Shown |
| --- | --- | --- | --- | --- |
| Sweep desk vs bare | Fennick (primary) | 8 / 3 | +10.4 (-3.4 to +23.6) | no gain, no loss |
| Sweep desk vs bare | Seen | 10 / 4 | +16.7 (-3.8 to +35.2) | no gain, no loss |
| Sweep desk vs bare | All | 18 / 7 | +13.1 (+1.5 to +24.2) | gain |
| Draft vs bare | Fennick | 10 / 2 | +16.7 (+2.6 to +29.6) | gain |
| Draft vs bare | Seen | 9 / 4 | +13.9 (-5.9 to +32.2) | no gain, no loss |
| Draft vs bare | All | 19 / 6 | +15.5 (+3.9 to +26.4) | gain |
| Sweep desk vs draft | All | 5 / 7 | -2.4 (-10.6 to +5.9) | same harness, run twice |

### Per skill and group

Passes of tasks in each cell (seen: 6 a skill; Fennick: 8 a skill).

| Skill | Bare, seen | Draft, seen | Taught, seen | Bare, Fennick | Draft, Fennick | Taught, Fennick |
| --- | --- | --- | --- | --- | --- | --- |
| best_config | 1 | 3 | 3 | 0 | 4 | 5 |
| early_stop | 6 | 4 | 4 | 8 | 6 | 6 |
| diverged | 4 | 4 | 4 | 7 | 8 | 6 |
| did_it_help | 0 | 3 | 3 | 0 | 4 | 2 |
| next_runs | 0 | 2 | 3 | 0 | 1 | 1 |
| sweep_report | 0 | 0 | 0 | 0 | 0 | 0 |

The draft's tool turned the skills bare could hardly do into ones it often does: best_config 1 of 14 to 7 of 14, did_it_help 0 of 14 to 7 of 14. It gave a little back on early stopping, where bare was already perfect at Fennick. No arm passed a sweep report anywhere.

### How the failures ended

| Arm | Failed tasks | Stopped at the turn limit | Answered wrong |
| --- | --- | --- | --- |
| Bare | 58 | 33 | 25 |
| One-shot draft | 45 | 3 | 42 |
| Sweep desk | 47 | 3 | 44 |

Bare ran out of its 16 turns on 33 tasks. With the draft's tool, the arms almost always answered (3 out of turns each), and their failures are wrong answers. Median time per task: bare 19.3 s, draft 11.7 s, taught 13.1 s.

## Limits

- One seed per arm, hosted Glimmer only; nothing here describes the local build the graduates are set to run on.
- The mentoring rounds this run was registered to measure didn't run: the taught arm's Spark cap stopped them after one call. The taught arm is the draft's harness.
- The bare arm's decoding differs (temperature 1, 16 turns, low reasoning); that is how the arms are defined, and some of the draft's gain may come from its 30 turns, as the turn-limit counts suggest.
- Four generated research groups. Fennick is synthetic.
- Dev gains picked by the keep rule lean upward and are not claimed.

## What came next

This run's taught job exported cleanly, which sweep-1's couldn't: its 6 checker-passed practice attempts went to a QLoRA job on an A100 (`architect-runs/qlora-2`). Its report is written separately.
