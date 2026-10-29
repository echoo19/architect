# Comparisons: Returns desk

Made 2026-10-29T01:02:02.276Z at commit 4872821, from stored records only. Splits seed 20261124: 15 calibration, 60 train, 45 dev and 60 locked-test tasks. Mentoring seed 1. Development closed at 2026-10-28T21:56:26.858Z, when the locked tests were released; no arm developed after it.

Locked-test seeds declared in the plan before any arm ran: 101 and 102. Seed 101 ran for Bare student; One-shot draft; Targeted mentoring; and Spark reference, blank harness. Seed 102 was declared for the decoding repeat and was not run, so no result in this report is under it.

Not in this comparison, so not run: Spark reference, targeted harness; Decoding repeat; Fixed intervention; One-shot adapter; and Failure-specific adapter.

Every reported agent is harness-only: none has trained weights.

Pinned when the plan was made, and checked on every run since: Returns desk (sample-gear-returns): job.json `9c527d0a3163`, tasks `c721e7ce6826`, data `4ac1a8c8ca35`, checker `76cabbe15f71`; the regression check's Service desk (sample-home-services): job.json `a2836b7d5f53`, tasks `74ce6132e11f`, data `f77e9e7139dd`, checker `6be9172e61fd`.

Calibration (the bare student on the calibration tasks, run first to price an attempt): Returns desk, 11/15, 73.3% (48.0% to 89.1%) on 15 tasks (Refunds 5/5, Order questions 3/5, Pickups 3/5); latency p50 31.7 s, p95 59.3 s; $0.0062 an attempt, 61,816 tokens in and 1,581 out on average.

Runtime regression check (the bare student on dev tasks of a second job, to check the runtime): Service desk, 24/30, 80.0% (62.7% to 90.5%) on 30 tasks (Invoices 10/10, Overdue balances 8/10, Scheduling 6/10); latency p50 79.5 s, p95 265.8 s; $0.0109 an attempt, 108,940 tokens in and 2,722 out on average.

## Money

What was spent, from the records. The projection made before the run is further down, apart from this, and none of it is counted here. The three figures for the hosted student count the same requests in different ways, so they are not added together.

- **Spark: $2.5797.** The cost ledger: every Spark call, and Spark doing the tasks itself as a reference. Spark calls are not in the request journal.
- **Compute: $0.0000.** No training job was paid for.
- **The hosted student, recorded by its attempts: $3.7630.** The cost written down with each attempt, every dollar once: the arms $3.3438, the calibration $0.0935 and the regression check $0.3257.
- **The hosted student, settled by the provider: $3.8075.** The request journal's 5,077 requests with a known charge, all of them billed by the provider. That is $0.0445 more than the attempts record: the journal writes down every request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again).
- **The hosted student, uncertain: $0.1359.** The journal's 10 requests that a crash or a failure cut off, whose charge is not known, each counted at the most it could have cost.

The journal counts $3.9434 in all, settled plus uncertain, of the $15.00 set aside for the hosted student: $0.1804 more than the attempts record.

## Arms

| # | Arm | Status | Rounds used of the most allowed, and why training ended | Dev, first measurement | Dev, last kept round: before to after |
| --- | --- | --- | --- | --- | --- |
| 1 | Bare student | complete | - | 24/45 | - |
| 2 | One-shot draft | complete | 1 of 1, done | 30/45 | round 1: 30/45 to 35/45 (kept without a check) |
| 3 | Targeted mentoring | complete | 2 of 2, cap reached | 33/45 | round 2: 60/90 to 73/90 |
| 4 | Spark reference, blank harness | complete | - | - | - |

The first dev measurement is one run over the dev tasks. A round that went through the keep rule is decided on its confirmation: the dev tasks again on new seeds, over more than one run, so its before and after are out of a larger total. Compare a round's before with its after, not with the first measurement. A one-shot draft is kept without a check, so its before and after are one run each.

| # | Arm | Spark: spent of its cap, tokens | Student: spent of its cap, attempts | Compute | Examples / trained tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | Bare student | $0.00 of $0.00, 0 in / 0 out | $0.85 of $0.98, 105 attempts | $0.00, 0 min | 0 / 0 |
| 2 | One-shot draft | $0.12 of $1.00, 43,937 in / 14,791 out | $0.82 of $1.40, 150 attempts | $0.00, 0 min | 0 / 0 |
| 3 | Targeted mentoring | $0.17 of $4.88, 96,477 in / 16,638 out | $1.67 of $4.57, 489 attempts | $0.00, 0 min | 0 / 0 |
| 4 | Spark reference, blank harness | $2.30 of $4.00, 3,985,367 in / 237,317 out | $0.00 of no cap, 0 attempts | $0.00, 0 min | 0 / 0 |

**Bare student.** The student on the blank starting harness, with no mentoring: the baseline the other arms are compared with. Frozen: harness version 1 (`1ea24f894dce`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured.

**One-shot draft.** Spark wrote the whole harness once, from the job alone, without seeing the student attempt anything. It is kept whatever it scores. Frozen: harness version 2 (`a18de4a72c2c`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured. Round 1 (draft) kept: Larchwood exact refund pickup order harness. Dev 30/45 to 35/45; the one-shot method keeps its harness without a keep-or-revert check.

**Targeted mentoring.** Each round Spark reads the student's failed attempts on practice tasks and makes one change to the harness; a change is kept only if it clears the keep rule on dev. It starts from the draft arm's kept harness (version 2), so the draft's Spark spend came off this arm's cap, and its cumulative cost below includes the draft's development. Its graduate's cumulative development cost, with the one-shot draft arm's: Spark $0.28, student $2.05, compute $0.00. Frozen: harness version 3 (`c0fa47e2912c`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured. Round 1 (harness) reverted: Fix pickup_next to parse legacy pickup_from dates. Dev 32/45 to 35/45, measured again on new seeds: 67/90 to 68/90 over 2 runs, short of the +4 margin. Dev regressed on order (24 to 23). Round 2 (harness) kept: Normalize legacy dates in pickup tool. Dev 30/45 to 39/45, measured again on new seeds: 60/90 to 73/90 over 2 runs, no type lost more than two.

**Spark reference, blank harness.** The primary reference: Spark acted as the agent with the bare arm's frozen harness (blank), so it saw no lesson, with the same tools and limits, on the same locked-test tasks under the first seed. It is a reference, not an arm: nothing it did reached mentoring, and the same checker graded it.

## Locked test, one table per backend

### Hosted Glimmer

Model meta/muse-glimmer-30b; served by openrouter.ai, pinned to DeepInfra with no fallback on openai_compatible; quantization bf16, as DeepInfra's listing on OpenRouter says; not reported per call; GGUF none; runtime build not recorded; chat template the provider's own; context 16,384 tokens

Settings each row ran with. The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare student | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 64 | high | 30 | 8,192 |
| Targeted mentoring | 0 | 1 | 64 | high | 30 | 8,192 |

| Arm | Locked test, seed 101 (95% Wilson) | Target | By type | Refused | Latency p50 / p95 | Cold start | Peak memory | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bare student | 43/60, 71.7% (59.2% to 81.5%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 15/20, Order questions 12/20, Pickups 16/20 | 0 | 17.7 s / 70.5 s | - | - | `1ea24f894dce` |
| One-shot draft | 47/60, 78.3% (66.4% to 86.9%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 16/20, Order questions 15/20, Pickups 16/20 | 0 | 8.1 s / 54.8 s | - | - | `a18de4a72c2c` |
| Targeted mentoring | 45/60, 75.0% (62.8% to 84.2%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 16/20, Order questions 14/20, Pickups 15/20 | 0 | 7.0 s / 20.7 s | - | - | `c0fa47e2912c` |

| Paired under seed 101, scenario by scenario | Scenarios | Wins | Losses (regressions) | Both | Neither | First less second, in percentage points (95% interval) | By type (wins/losses) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One-shot draft vs Bare student | 60 | 13 | 9 | 34 | 4 | +6.7 (-8.8 to +21.8) | refund 4/3, order 5/2, pickup 4/4 |
| Targeted mentoring vs Bare student | 60 | 11 | 9 | 34 | 6 | +3.3 (-11.5 to +18.0) | refund 4/3, order 4/2, pickup 3/4 |
| Targeted mentoring vs One-shot draft | 60 | 3 | 5 | 42 | 10 | -3.3 (-13.4 to +6.6) | refund 0/0, order 1/2, pickup 2/3 |

### Spark as a reference

Model muse-spark-1.3; served by api.meta.ai on meta; quantization not recorded; GGUF none; runtime build not recorded; chat template the provider's own; context not recorded

Settings each row ran with. The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Spark reference, blank harness | 1 | 0.95 | 64 | low | 16 | 4,096 |

| Arm | Locked test, seed 101 (95% Wilson) | Target | By type | Refused | Latency p50 / p95 | Cold start | Peak memory | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Spark reference, blank harness | 60/60, 100.0% (94.0% to 100.0%) | meets the 95.0% target as observed (57 of 60 needed) | Refunds 20/20, Order questions 20/20, Pickups 20/20 | 0 | 13.8 s / 29.5 s | - | - | `1ea24f894dce` |

| Paired under seed 101, scenario by scenario | Scenarios | Wins | Losses (regressions) | Both | Neither | First less second, in percentage points (95% interval) | By type (wins/losses) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Spark reference, blank harness vs Bare student | 60 | 17 | 0 | 43 | 0 | +28.3 (+16.8 to +40.8) | refund 5/0, order 8/0, pickup 4/0 |
| Spark reference, blank harness vs One-shot draft | 60 | 13 | 0 | 47 | 0 | +21.7 (+11.2 to +33.6) | refund 4/0, order 5/0, pickup 4/0 |
| Spark reference, blank harness vs Targeted mentoring | 60 | 15 | 0 | 45 | 0 | +25.0 (+14.0 to +37.2) | refund 4/0, order 6/0, pickup 5/0 |

## Projection made before the run, not what was spent

These are estimates, made from the calibration attempts before any arm spent. Nothing here was spent; what was spent is under Money and Arms.

| Input | Value | Source | Note |
| --- | --- | --- | --- |
| Hosted attempt | $0.0062 | measured | mean of 15 calibration attempts as the provider billed them |
| Hosted attempt time (p50) | 31.7 s | measured | 15 calibration attempts on the hosted student |
| Input tokens per attempt | 61816.0 tokens | measured | 15 calibration attempts on the hosted student |
| Output tokens per attempt | 1581.2 tokens | measured | 15 calibration attempts on the hosted student |
| Spark author call | $0.0755 | assumed | 40,000 tokens in and 6,000 out at Spark's price; each arm's Spark cap holds it whatever it costs |
| Spark as the agent, per task | $0.0840 | assumed | the student's measured tokens per attempt at Spark's price |
| Local attempt time (p50) | 99.3 s | measured | 3 probe attempts on this computer |
| Training job | $2.7000 | assumed | its whole authorization, 90 minutes on one L40S at $1.80 an hour, the most it can cost |

| Arm | Hosted attempts | Local attempts | Spark calls / tasks | Projected student | Projected Spark | Projected compute | Local GPU | Wall clock | Funded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bare student | 105 | 0 | 0 / 0 | $0.65 | $0.00 | $0.00 | 0 min | 36 min | yes |
| One-shot draft | 150 | 0 | 2 / 0 | $0.94 | $0.15 | $0.00 | 0 min | 40 min | yes |
| Targeted mentoring | 489 | 0 | 4 / 12 | $3.05 | $1.31 | $0.00 | 0 min | 76 min | yes |
| Spark reference, blank harness | 0 | 0 | 0 / 60 | $0.00 | $4.00 | $0.00 | 0 min | 32 min | yes |

Projected for the funded arms: student $4.64 of $15.00, Spark $5.46 of $10.00, compute $0.00 of $0.00, local GPU 0 of 0 minutes, about 183 minutes of wall clock.

## Disclosures

- Claims rest on the locked test alone. Dev gains were picked by the keep rule, so they lean upward and are not claimed.
- Every arm ran with one mentoring seed (1). The locked test ran under seed 101. Seed 102 was declared for a decoding repeat that was not run, so no result here is under it.
- A pair's difference in pass rate is the first arm's less the second's, with a 95% interval for paired proportions: Newcombe's hybrid score method, his method 10 (Statistics in Medicine, 1998), made from the wins, losses, both and neither counts. When the interval includes zero, no difference was shown, which is not the same as showing there is none.
- Targets are quoted as observed counts: 57 of 60 meets the job's 95.0% target as observed. That is not proof of 95.0% reliability: 57 of 60 has a 95% Wilson interval of 86.3% to 98.3%.
- The arms' budgets differ and are not equal-budget comparisons. Bare student: Spark $0.00 of $0.00, student $0.85 of $0.98, compute $0.00 of no cap; One-shot draft: Spark $0.12 of $1.00, student $0.82 of $1.40, compute $0.00 of no cap; Targeted mentoring: Spark $0.17 of $4.88, student $1.67 of $4.57, compute $0.00 of no cap; Spark reference, blank harness: Spark $2.30 of $4.00, student $0.00 of no cap, compute $0.00 of no cap.
- The totals count each dollar once. A graduate's cumulative cost adds what it builds on: Targeted mentoring includes the one-shot draft arm's development (Spark $0.28, student $2.05, compute $0.00 in all).
- The request journal writes down every hosted request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again), and it counts a request a crash or a failure cut off at the most it could have cost, since its charge is not known. A restart repeats no recorded attempt, Spark reply or training job; an attempt in flight when a process stopped is made again, and its cut-off requests count in the journal at their worst; a Spark call in flight is paid again.
- Calibration against the provider's billing: it billed $0.09 where the listed price of the same usage is $0.09 (1.000 times), for 128 of 128 calls. Costs are what it billed wherever it said.
- Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. A01 is blocked without Hugging Face credentials.
- Local evaluation incomplete: no locked test ran on this computer, so no result here describes muse-glimmer:30b-iq2, the build the agents are set to run on.
- Hosted results ran on openrouter.ai, pinned to DeepInfra with no fallback (bf16, as DeepInfra's listing on OpenRouter says; not reported per call); this computer runs muse-glimmer:30b-iq2, so hosted and local tables are never compared row to row.
- Spark's rows are references on the same tasks, tools, limits and seed, not arms, graded by the same checker; Spark judged nothing. The blank-harness row is the primary reference: Spark saw no lesson.
- The runtime regression check ran only the bare student, on 30 dev tasks of Service desk: it checks the runtime on a second job. It is not evidence that mentoring caused no regression there, since no mentored graduate was tested on that job.
