# Comparisons: Inventory desk, first run

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at tag `v0.8.0` (`ab7fcff9`), with one in-memory patch and one setting, both listed under Method. The student in every arm was hosted Glimmer. Splits seed 20261101, mentoring seed 1, locked-test seed 101, one seed per arm.

## The result

Taught by Spark, Inventory desk passed **27 of 32** tasks at Corvid Hill Discovery, the screening lab it was never taught on. Glimmer on a blank harness passed **4 of 32**. Paired task by task, that is **+71.9 points (95% interval +48.4 to +84.0)**: 24 wins and 1 loss. The interval is far above zero, so by the registered rule this is a gain. On the taught labs' test split it passed 21 of 24 against bare's 3, +75.0 points (+45.9 to +87.8).

Most of that gain came from Spark's one-shot draft, not from the refinement rounds. The draft alone passed 28 of 32 at Corvid Hill. The taught arm adds two lines to it, and at Corvid Hill it does no better than the draft: 27 against 28, -3.1 points (-20.9 to +14.7).

This is hosted Glimmer, one seed, and four generated labs. The limits are at the end.

## What was asked

Inventory desk runs a screening lab's compound store. A scientist asks how much of a compound is usable, which lot a re-test should come from, to allocate stock for a list of compounds the Assay desk sent for re-testing, and to put holds on that stock. It works only from the lab's own files (`inventory.csv`, `reservations.csv`, `policy.md`) and writes only to `reservations.csv`. The labs differ on purpose. Each has its own date, volume unit, date format, lot and location names, and policy style, and its own numbers: stock per re-test, days a lot must have left, which lot to draw first, whether lots may be combined, the most holds per compound, and its reason codes. The checker is deterministic. It checks volumes, lots, locations, reason codes and the rows added to `reservations.csv`, never wording.

The question: does a harness that Spark builds for Glimmer, then refines on Glimmer's own failed practice attempts, pass more tasks than Glimmer on a blank harness? Does that hold at a lab it never saw?

The plan was written before anything ran and kept in the run folder (`architect-runs/inventory-1/PLAN.md`), with two dated amendments, both written before any arm started. It is not in a public registry, so its times are file times.

- **Primary.** Taught minus bare at Corvid Hill (32 tasks), paired task by task: wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). A gain counts only if the interval is above zero.
- **Secondary.** The same on the taught labs' test split (24, "seen") and on all 56. The draft against bare and the taught arm against the draft. Each skill in each group, what each round changed, latency and spend.
- **Rule.** No rerun or tuning after any locked result. If the runner paused for money, the run would stop there. It never paused.

## Labs and tasks

| Lab | Role | Locked-test tasks |
| --- | --- | --- |
| Fenwick Screening Core, Alder Row Biosciences, Saltmarsh Institute Assay Lab | taught on: Spark studied them, Glimmer practiced on them | 24 ("seen": 7, 9 and 8) |
| Corvid Hill Discovery | never seen; sealed in the vault | 32 |

All four labs are generated (`examples/inventory-desk`). They are the Assay desk's labs, and every re-test list comes from the Assay desk's own expected answers. Corvid Hill uses numbers no taught lab uses: 12 µL a re-test, 21 days, the lot with the most free volume first, no combining, at most 5 holds. No taught lab draws the largest lot first without combining lots.

**Tasks.** 128 in all, 32 per lab, 8 for each of four skills (`usable`, `pick_lot`, `allocate`, `reserve`). The taught labs' 96 split into 8 calibration, 40 train, 24 dev and 24 test. The locked test is 56 tasks. Job `b541d8788c3b`, tasks `90a6433f04c8`, checker `8094591b9a42`, all pinned before the run. The job is a byte copy of the example at `v0.8.0`, which is unchanged on `field/main`.

## Arms

| # | Arm | What it is | Harness |
| --- | --- | --- | --- |
| 1 | Bare | Glimmer on the blank harness. No Spark, no study. | `2c1791cc4a84` |
| 2 | One-shot draft (secondary) | Spark writes the harness once, from the job and the confirmed study, without seeing Glimmer try anything. | `2691a6ecb44c` |
| 3 | Inventory desk (taught) | Starts from the draft's harness. Each round, Spark reads Glimmer's failed practice attempts and makes one change. A change is kept only if it clears the job's keep rule on dev: at least +2, no skill down more than 1, patience 4. Two rounds at most. | `27b46e7cbde4` |

The plan first named only bare and the taught arm. But 0.8.0's runner funds the taught arm only when the draft arm runs too, and 0.8.0 runs the draft's locked test as well, so the draft was added as a secondary arm before anything else ran (amendment 2). That also lets the gain be split between the draft and the rounds.

Before any arm ran, Spark read the three taught labs' files and wrote a study brief (1 call, $0.05). It was confirmed through the runner's own step, with a script passing its token in place of a person. A text search found no mention of Corvid Hill in it. The bare arm does not get the brief.

Models: student `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback; mentor `muse-spark-1.3` on Meta's API, unstreamed. Every arm froze before any locked test opened. The runner released all three tests together at 05:48:43 UTC on Nov 1.

Calibration, to price an attempt: the bare student passed 2 of the 8 calibration tasks at $0.0029 an attempt.

## Method: what was changed from 0.8.0

- **The study's output limit, 8,000 to 16,000 tokens.** In 0.8.0 the study of this job is cut off at 8,000 output tokens: the reply ran out mid-JSON, its repair call did too, and the plan step stopped. The Assay desk run on the same checkout hit the same error at the same moment. The limit was raised to 16,000 with an in-memory patch as the runner loaded the engine. It is the same change the third academy run made, and it is the only patch. With it, the study took one call and 11,346 tokens out. The cut-off study's cost was lost with the failed call (see Money). The limit is being fixed in the product separately.
- **The taught arm's own Spark cap, $5 to $1.70.** The runner funds the taught arm only when its whole Spark cap fits what is left of the run's, and its default of $5 is more than this run's Spark budget. The comparisons script has no flag for this cap; the app's experiments set it per arm. One number in the runner's default settings was set before the script read it. No file changed, and the plan records the value.
- Everything else is 0.8.0 as it ships: the draft's locked test runs, and counterexample-guided repair is on. No counterexamples were recorded in this run.

## What the draft and the two rounds changed

Dev is the 24 dev tasks of the taught labs. A kept round is confirmed on new seeds over two runs, so its totals are out of 48.

| Step | Change | Result | Dev, before to after |
| --- | --- | --- | --- |
| Draft | **A policy-driven stock planner.** Spark found Glimmer failing at hand arithmetic: free volume across mixed units, expiry cutoffs in three date formats, which lot comes first, single or combined draws, hold limits and row formats. It wrote one tool, `plan_stock`, that does the math from policy numbers the agent passes in (per-test volume, days, order, combine, limit, reason codes, unit and date form), plus one skill per task type that reads `policy.md` first, two worked examples, and low-temperature decoding. The tool holds no lab's numbers or codes. Predicted +14 to +20. | kept (a draft is kept without a check) | 8/24 to 22/24 |
| Round 1 | **Tool calls only.** The one failed train attempt (of 12) wrote raw XML in place of a tool call on its first turn and never answered. Spark added a line telling the agent to call tools only as tool calls. Predicted 0 to +2. | reverted: short of +2 | 20/24 to 21/24 |
| Round 2 | **The same slip, guarded in the reserve skill too.** The same failure on a new batch. Spark added the line again in the main rules and told the reserve skill to start with a real read of `policy.md` and to retry once after a tool error. Predicted 0 to +2. | kept | first run 17/24 to 21/24; confirmed 34/48 to 40/48 |

So the frozen Inventory desk is the draft plus those two lines. The keep rule picked the dev gains, so they lean upward. They show what each change did on dev and are not claimed as results.

## Money

- **Hosted student: $1.38** by the runner's request journal (1,863 requests, all settled at what the provider billed, none cut off), calibration included. The caps were $15 here, raised from $7 before anything but the calibration and study had run (amendment 2). The OpenRouter key was shared with the Assay desk run going on at the same time, so the credits endpoint shows both runs and isn't used here.
- **Spark: $0.34 recorded** (study $0.05, draft $0.16, the taught arm's two rounds $0.14), plus the cut-off study's unrecorded cost, at most about $0.18 (counted as $0.20 against the cap). About $0.54 at most, of the $3 cap.
- **Compute: $0.** No training job ran, and no arm used the local GPU.

| Arm | Spark | Student | Attempts |
| --- | --- | --- | --- |
| Bare | $0.00 | $0.22 ($0.16 of it the locked test) | 80 |
| One-shot draft | $0.16 | $0.33 ($0.18 of it the locked test) | 104 |
| Inventory desk | $0.14 | $0.80 ($0.22 of it the locked test) | 248 |

Inventory desk's development cost, including the draft it starts from: Spark $0.29, student $0.74. The arms did not have equal budgets.

## Locked test, hosted Glimmer

The settings each arm ran with. The harness sets them, so each row compares a whole configuration.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 64 | high | 30 | 8,192 |
| Inventory desk | 0 | 1 | 64 | high | 30 | 8,192 |

### Per arm and group

Tasks passed out of the total, with a 95% Wilson interval in brackets.

| Arm | Seen (24) | Corvid Hill (32) | All (56) |
| --- | --- | --- | --- |
| Bare | 3, 12.5% (4.3 to 31.0) | 4, 12.5% (5.0 to 28.1) | 7, 12.5% (6.2 to 23.6) |
| One-shot draft | 14, 58.3% (38.8 to 75.5) | 28, 87.5% (71.9 to 95.0) | 42, 75.0% (62.3 to 84.5) |
| Inventory desk | 21, 87.5% (69.0 to 95.7) | 27, 84.4% (68.2 to 93.1) | 48, 85.7% (74.3 to 92.6) |

The job's target is 90% on the taught labs. Inventory desk's 21 of 24 falls one short of the 22 that would meet it as observed.

### Per skill and group

| Skill | Group | Bare | Draft | Inventory desk |
| --- | --- | --- | --- | --- |
| Usable | Seen | 1/6 | 5/6 | 5/6 |
| | Corvid Hill | 3/8 | 8/8 | 5/8 |
| Pick a lot | Seen | 2/6 | 3/6 | 5/6 |
| | Corvid Hill | 0/8 | 8/8 | 8/8 |
| Allocate | Seen | 0/6 | 5/6 | 6/6 |
| | Corvid Hill | 0/8 | 6/8 | 7/8 |
| Reserve | Seen | 0/6 | 1/6 | 5/6 |
| | Corvid Hill | 1/8 | 6/8 | 7/8 |

### Paired results

Task by task under seed 101. A win is a task the first arm passed and the second failed; a loss is the reverse. The difference is the first arm's pass rate minus the second's, in percentage points, with a Newcombe 95% interval. The bold row is the primary comparison.

| Pair | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | Gain shown | Wins/losses by skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Inventory desk vs bare** | **Corvid Hill** | 32 | 24 / 1 | 3 / 4 | **+71.9 (+48.4 to +84.0)** | yes | pick a lot 8/0, allocate 7/0, reserve 6/0, usable 3/1 |
| Inventory desk vs bare | Seen | 24 | 19 / 1 | 2 / 2 | +75.0 (+45.9 to +87.8) | yes | allocate 6/0, reserve 5/0, usable 5/1, pick a lot 3/0 |
| Inventory desk vs bare | All | 56 | 43 / 2 | 5 / 6 | +73.2 (+56.1 to +83.2) | yes | |
| Draft vs bare | Corvid Hill | 32 | 24 / 0 | 4 / 4 | +75.0 (+53.0 to +85.6) | yes | pick a lot 8/0, allocate 6/0, usable 5/0, reserve 5/0 |
| Draft vs bare | Seen | 24 | 12 / 1 | 2 / 9 | +45.8 (+19.0 to +64.9) | yes | allocate 5/0, usable 4/0, pick a lot 2/1, reserve 1/0 |
| Inventory desk vs draft | Corvid Hill | 32 | 3 / 4 | 24 / 1 | -3.1 (-20.9 to +14.7) | no | reserve 2/1, allocate 1/0, usable 0/3 |
| Inventory desk vs draft | Seen | 24 | 10 / 3 | 11 / 0 | +29.2 (+0.2 to +52.6) | yes, barely | reserve 5/1, pick a lot 3/1, allocate 1/0, usable 1/1 |
| Inventory desk vs draft | All | 56 | 13 / 7 | 35 / 1 | +10.7 (-5.0 to +25.8) | no | |

### Latency and how attempts ended

Median seconds per attempt, with the 95th percentile of all 56 in brackets: bare 9.2 (108.7), draft 17.3 (81.1), Inventory desk 10.3 (37.8). At Corvid Hill the medians were bare 4.1, draft 24.1 and Inventory desk 9.4.

Every one of Inventory desk's 8 misses and the draft's 14 ended with an answer that the checker failed. None ran out of steps or stopped on an error. Bare's 49 misses were 29 wrong answers, 16 stopped on an error and 4 at the 16-step limit. Every request in the journal settled and was billed, so the 16 errors were Glimmer's own: a reply cut off at a limit, not a provider failure. The records keep no trace to say which limit.

## What the numbers support

- **Corvid Hill: a gain.** Inventory desk passed 27 of 32, bare 4. The paired difference is +71.9 points with an interval well above zero (24 wins, 1 loss), across all four skills. Bare passed no pick-a-lot or allocate task there.
- **Seen labs: a gain** of the same size, +75.0 points.
- **The draft carries the gain.** The one-shot draft alone was +75.0 points over bare at Corvid Hill. The rounds added two lines about tool-call format. At Corvid Hill the taught arm and the draft are level within noise (3 wins, 4 losses). On the seen labs the taught arm is ahead by +29.2 points, with an interval that clears zero by 0.2 points.
- **Some of that is run-to-run noise.** Both arms run at temperature 0 with the same usable skill and the same tool, yet at Corvid Hill the draft passed all 8 usable tasks and Inventory desk 5. The change between them is about tool-call format, which shouldn't move usable answers that much. So differences of a few tasks between these two arms shouldn't be read as the rounds' effect, in either direction.
- **Why the draft transfers.** Its tool takes every lab-specific number as an input the agent reads from that lab's `policy.md`, and it holds none of the taught labs' numbers or codes. Corvid Hill's numbers differ from every taught lab's, and its draw order with no combining matches none of them, and the arm still passed every pick-a-lot task there.

These results are for hosted Glimmer under one seed. They don't describe the local 2-bit build.

## For the team with Assay desk

The frozen Inventory desk is graduate **`grd_mvxet7nj59cab32f6c`** (agent version 1, harness version 3, `sha256-27b46e7cbde4`), named "Inventory desk" (`inventory-desk` in the CLI). It is kept in the run's data folder, `architect-runs/inventory-1/cmp/data`, at `graduates/grd_mvxet7nj59cab32f6c/versions/v0001`. The CLI opens it with `ARCHITECT_USER_DATA` set to that folder. `architect verify` passed there: harness version 3, its one tool loaded, its folders bound, and `muse-glimmer:30b-iq2` on Ollama, the build it was made for. Its allocate and reserve skills were 13 of 14 and 12 of 14 on the locked test. Those are the two skills that take the Assay desk's re-test lists.

## Limitations

- **One seed, small groups.** Every number is one run of each arm under locked-test seed 101. Corvid Hill has 32 tasks, 8 per skill, and the seen split 24. The intervals are wide, and a difference of a few tasks between the draft and the taught arm is within what reruns could move.
- **Generated labs only.** All four labs come from one generator. Corvid Hill has its own numbers, words and order rule, but the same kinds of rule as the taught labs. A lab whose files someone else wrote, or whose policy has a kind of rule the taught labs lack, wasn't tested. In the academy runs, a real academy is exactly where the taught agent failed.
- **Hosted, not local.** Every number is hosted Glimmer through DeepInfra. Each graduate is set to run `muse-glimmer:30b-iq2` locally, and that build took no locked test.
- **Whole configurations are compared.** Bare runs at temperature 1, low reasoning, 16 turns and 4,096 tokens a turn; the draft and Inventory desk at temperature 0, high reasoning, 30 turns and 8,192 tokens. The harness sets these, and some of the gain over bare may come from them alone. Inventory desk used about 3.6 times bare's student spend.
- **One patch and one setting** (Method): the study's output limit was raised to 16,000 tokens, and the taught arm's Spark cap was set to $1.70. Without the first, 0.8.0 can't study this job; without the second, its runner won't fund the taught arm under this run's caps.
- **The cut-off study's cost is not recorded.** The engine lost the record when the call failed. It is estimated at about $0.18 at most from the call's size and counted as $0.20.
- **The arms changed before anything ran.** The draft became a third measured arm, and the caps went from $7 and $2 to $15 and $3, the latter at the owner's word. Both were written down before any arm started. Neither depended on a result.
- **No traces.** Locked-test traces are not kept, so the misses aren't diagnosed beyond how each attempt ended.
- **A scripted study confirmation.** A script passed the study's token in place of a person.
- **The local GPU was used once, after the measurements.** `architect verify` ran one local answer on the 2-bit build (33 seconds, loading included) to check that the graduate loads. Nothing measured here comes from it.
- **Dev leans upward.** The keep rule picked the dev results. Only the locked test is claimed.
