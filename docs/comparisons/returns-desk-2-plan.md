# Comparison 2: the plan, written before it ran

Written on Oct 28, 2026, in the evening (Eastern time), after reading the results of comparison 1 and before anything about the business below was generated or measured. The commit that adds this file is the one the comparison runs from.

## Why there is a second comparison

Comparison 1 ran on the returns desk business that ships with Architect (generator seed 20261124). On its 60 final-test tasks, with Glimmer served online (bf16), Glimmer on its own passed 43, Glimmer with Spark's one-shot draft passed 47, Glimmer after Spark's targeted teaching passed 45, and Spark itself passed 60. Against Glimmer on its own, targeted teaching won 11 tasks and lost 9. That run showed no clear gain on the final test.

Its teaching arm was limited to two rounds after the draft and spent $0.17 of its $4.88 Spark allowance. This comparison was designed after seeing those results. It gives teaching the job's own budget, on a business nobody has looked at, and decides in advance what counts as a gain. Comparison 1 stays published as it ran.

## The business

- Generator seed 20261029. It is the only seed drawn for this comparison; no other seed was generated or looked at.
- The tasks are split by the same seed, so the practice, check and final-test tasks are new as well.
- It is made at this commit by `pnpm --filter @architect/example-gear-returns generate --seed 20261029 --out <folder>`. The plan pins the hashes of its job.json, tasks, data and checker, and the report prints them.
- It is another business of the same kind under the same returns policy, made by the same generator. It tests another instance of this job, not other kinds of business.

## The arms

| Arm | What it is |
| --- | --- |
| Glimmer on its own | The blank harness. No teaching. |
| One-shot draft (secondary) | Spark writes the harness once, from the job, without seeing Glimmer fail. It is kept without the keep rule, as in comparison 1. |
| Targeted teaching (primary) | Starts from the draft's harness. Up to 7 rounds in which Spark reads Glimmer's failed attempts and makes one change; the draft's round makes 8 in all, the job's own budget. |

Targeted teaching uses the job's own rules, unchanged from comparison 1:

- A change is kept only if check-task passes rise by at least 2 per run, measured again on new seeds over 2 runs (so +4 of 90), and no kind of task loses more than 1 per run.
- Teaching stops after 4 rounds in a row with no change kept, or when its money runs out.
- Spark has $5 for the draft and the targeted rounds together; the draft's spending comes off the targeted arm's allowance.

Not in this comparison: Spark as a reference (comparison 1 measured it at 60/60), a second final-test seed, the regression check on the service desk job, trained weights, and any run on this computer's GPU. The report marks each one as not run.

## How it runs

- Glimmer is `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra (bf16) with no fallback, with the same sampling and limits as comparison 1. Spark is `muse-spark-1.3` on Meta's API.
- Mentoring seed 1; final-test seed 101.
- Each arm is frozen before any final test opens. The runner holds every final test until all three arms are frozen.
- Caps: $15 for the online Glimmer (each arm's share is its worst-case projection times 1.5), and $6 of Spark in the plan, of which the draft and the targeted arm can spend $5 together.
- Wall clock: the runner's own cap (twice the projection, at least 12 hours). If targeted teaching takes longer than the job's 240 minutes, the report says how long it took.

The command, from `packages/engine`:

```
pnpm exec tsx scripts/comparisons.ts run <folder> --out <output> --arms bare,draft,targeted --rounds 7 --student-usd 15 --spark-usd 6 --headroom 1.5 --local-model muse-glimmer:30b-iq2
```

Every number in the results comes from Glimmer served online. `--local-model` only names the build each frozen agent runs on once it is installed: the 2-bit build that fits a 12 GB graphics card. That build is not measured here, and the report says so.

## What is measured, and what counts as a gain

- **Primary:** targeted teaching against Glimmer on its own, paired task by task on the 60 final-test tasks: tasks won, tasks lost, and the difference in pass rate with a 95% interval for paired proportions (Newcombe's method). It counts as a gain only if that interval is above zero. Otherwise the result is that no gain was shown, which is not the same as showing teaching doesn't help.
- **Secondary:** the draft against Glimmer on its own, targeted teaching against the draft (whether the rounds add anything beyond the draft), answer time (median and 95th percentile), and what each arm cost.

## The agent that ships

The targeted arm's frozen agent becomes Architect's ready-made sample agent, with this business's data and its own results, whatever its score. That choice is made now, before any final test opens. If comparison 2 doesn't finish, comparison 1's one-shot draft agent ships instead, labeled as a one-shot draft.

## What will be published

Both reports go in this folder, whatever they show. A result with no gain is reported as no gain, beside comparison 1.

## Amendment, before any arm ran

Oct 28, 2026, about 20:20 Eastern. The plan step ran the bare student on the 15 calibration tasks, which only prices an attempt, and projected the targeted arm at $8.85 at most. At 1.5 times that, its share is $13.28, and the $15 cap left $12.57 after the other two arms, so the targeted arm was not funded. The online Glimmer cap is raised to $16 (`--student-usd 16`). Nothing else changes, and no arm had started.

## Second amendment: the first run was set aside

Oct 28, 2026, about 20:30 Eastern. The first run (output folder `comparison-2`) started Glimmer on its own and the draft at 20:15. When the targeted arm's turn came at 20:20, attempts had cost $0.0079 each, more than calibration's estimate, because the draft's harness is longer than the blank one. At that price its share came to $17.25, with $12.87 left, so the runner left it out, as it is built to, froze the other two arms and opened their final tests. That broke this plan's rule that all three arms freeze before any final test opens. The run was stopped at 20:21, 84 seconds later. The few final-test results it made won't be looked at or reported, and that folder is set aside.

The comparison runs again from the start in a new folder (`comparison-2b`), on the same business, with the same arms, seeds and rules. The only change is a $25 total cap for the online Glimmer (`--student-usd 25`). The total cap decides whether an arm may start. Each arm's own share stays 1.5 times its projection at the plan's price, and the targeted arm is held to it before every round, so the most the comparison can spend barely changes.
