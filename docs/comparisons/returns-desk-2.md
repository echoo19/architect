# Comparisons: Returns desk

Made 2026-10-29T01:18:12.596Z at commit a09975c, from stored records only. Splits seed 20261029: 15 calibration, 60 train, 45 dev and 60 locked-test tasks. Mentoring seed 1. Development closed at 2026-10-29T00:54:41.020Z, when the locked tests were released; no arm developed after it.

Locked-test seeds declared in the plan before any arm ran: 101 and 102. Seed 101 ran for Bare student, One-shot draft and Targeted mentoring. Seed 102 was declared for the decoding repeat and was not run, so no result in this report is under it.

Not in this comparison, so not run: Spark reference, blank harness; Spark reference, targeted harness; Decoding repeat; Fixed intervention; One-shot adapter; Failure-specific adapter; and the runtime regression check.

Every reported agent is harness-only: none has trained weights.

Pinned when the plan was made, and checked on every run since: Returns desk (sample-gear-returns): job.json `bf4882e8d228`, tasks `bb8c885c77a2`, data `9a2acfeee048`, checker `76cabbe15f71`.

Calibration (the bare student on the calibration tasks, run first to price an attempt): Returns desk, 8/15, 53.3% (30.1% to 75.2%) on 15 tasks (Refunds 4/5, Order questions 2/5, Pickups 2/5); latency p50 17.2 s, p95 32.7 s; $0.0079 an attempt, 88,577 tokens in and 1,978 out on average.

## Money

What was spent, from the records. The projection made before the run is further down, apart from this, and none of it is counted here. The three figures for the hosted student count the same requests in different ways, so they are not added together.

- **Spark: $0.4205.** The cost ledger: every Spark call. Spark calls are not in the request journal.
- **Compute: $0.0000.** No training job was paid for.
- **The hosted student, recorded by its attempts: $3.3796.** The cost written down with each attempt, every dollar once: the arms $3.2613 and the calibration $0.1183.
- **The hosted student, settled by the provider: $3.3819.** The request journal's 5,454 requests with a known charge, all of them billed by the provider. That is $0.0023 more than the attempts record: the journal writes down every request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again).
- **The hosted student, uncertain: $0.0087.** The journal's 1 request that a crash or a failure cut off, whose charge is not known, counted at the most it could have cost.

The journal counts $3.3906 in all, settled plus uncertain, of the $25.00 set aside for the hosted student: $0.0110 more than the attempts record.

## Arms

| # | Arm | Status | Rounds used of the most allowed, and why training ended | Dev, first measurement | Dev, last kept round: before to after |
| --- | --- | --- | --- | --- | --- |
| 1 | Bare student | complete | - | 31/45 | - |
| 2 | One-shot draft | complete | 1 of 1, done | 29/45 | round 1: 29/45 to 31/45 (kept without a check) |
| 3 | Targeted mentoring | complete | 4 of 7, done, the dev target was reached | 31/45 | round 4: 84/90 to 88/90 |

The first dev measurement is one run over the dev tasks. A round that went through the keep rule is decided on its confirmation: the dev tasks again on new seeds, over more than one run, so its before and after are out of a larger total. Compare a round's before with its after, not with the first measurement. A one-shot draft is kept without a check, so its before and after are one run each.

| # | Arm | Spark: spent of its cap, tokens | Student: spent of its cap, attempts | Compute | Examples / trained tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | Bare student | $0.00 of $0.00, 0 in / 0 out | $0.88 of $1.24, 105 attempts | $0.00, 0 min | 0 / 0 |
| 2 | One-shot draft | $0.08 of $1.00, 18,992 in / 12,429 out | $0.72 of $1.77, 150 attempts | $0.00, 0 min | 0 / 0 |
| 3 | Targeted mentoring | $0.34 of $4.92, 186,121 in / 41,713 out | $1.66 of $17.14, 693 attempts | $0.00, 0 min | 0 / 0 |

**Bare student.** The student on the blank starting harness, with no mentoring: the baseline the other arms are compared with. Frozen: harness version 1 (`1ea24f894dce`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured.

**One-shot draft.** Spark wrote the whole harness once, from the job alone, without seeing the student attempt anything. It is kept whatever it scores. Frozen: harness version 2 (`a4300092453b`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured. Round 1 (draft) kept: Returns desk tools-first harness. Dev 29/45 to 31/45; the one-shot method keeps its harness without a keep-or-revert check. Dev regressed on refund (11 to 7), pickup (13 to 12).

**Targeted mentoring.** Each round Spark reads the student's failed attempts on practice tasks and makes one change to the harness; a change is kept only if it clears the keep rule on dev. It starts from the draft arm's kept harness (version 2), so the draft's Spark spend came off this arm's cap, and its cumulative cost below includes the draft's development. Its graduate's cumulative development cost, with the one-shot draft arm's: Spark $0.42, student $2.09, compute $0.00. Frozen: harness version 5 (`51676fe44897`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from the hosted student; that local build was not measured. Round 1 (harness) kept: Normalize dirty values in helpers. Dev 31/45 to 42/45, measured again on new seeds: 62/90 to 85/90 over 2 runs, no type lost more than two. Round 2 (harness) reverted: Strip currency symbols in money parsing helpers. Dev 43/45 to 44/45, short of the +2 margin. Round 3 (harness) reverted: Strip currency symbols in money parsing. Dev 44/45 to 44/45, no change. Round 4 (harness) kept: Parse dirty money with numeric extraction in helpers. Dev 42/45 to 44/45, measured again on new seeds: 84/90 to 88/90 over 2 runs, no type lost more than two.

## Locked test, one table per backend

### Hosted Glimmer

Model meta/muse-glimmer-30b; served by openrouter.ai, pinned to DeepInfra with no fallback on openai_compatible; quantization bf16, as DeepInfra's listing on OpenRouter says; not reported per call; GGUF none; runtime build not recorded; chat template the provider's own; context 16,384 tokens

Settings each row ran with. The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Bare student | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0 | 1 | 32 | medium | 24 | 4,096 |
| Targeted mentoring | 0 | 1 | 32 | medium | 24 | 4,096 |

| Arm | Locked test, seed 101 (95% Wilson) | Target | By type | Refused | Latency p50 / p95 | Cold start | Peak memory | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bare student | 44/60, 73.3% (61.0% to 82.9%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 15/20, Order questions 12/20, Pickups 17/20 | 0 | 17.7 s / 42.7 s | - | - | `1ea24f894dce` |
| One-shot draft | 38/60, 63.3% (50.7% to 74.4%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 11/20, Order questions 10/20, Pickups 17/20 | 0 | 4.0 s / 56.6 s | - | - | `a4300092453b` |
| Targeted mentoring | 58/60, 96.7% (88.6% to 99.1%) | meets the 95.0% target as observed (57 of 60 needed) | Refunds 19/20, Order questions 19/20, Pickups 20/20 | 0 | 3.5 s / 4.8 s | - | - | `51676fe44897` |

| Paired under seed 101, scenario by scenario | Scenarios | Wins | Losses (regressions) | Both | Neither | First less second, in percentage points (95% interval) | By type (wins/losses) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One-shot draft vs Bare student | 60 | 8 | 14 | 30 | 8 | -10.0 (-24.8 to +5.5) | refund 4/8, order 1/3, pickup 3/3 |
| Targeted mentoring vs Bare student | 60 | 15 | 1 | 43 | 1 | +23.3 (+10.9 to +35.9) | refund 5/1, order 7/0, pickup 3/0 |
| Targeted mentoring vs One-shot draft | 60 | 20 | 0 | 38 | 2 | +33.3 (+20.7 to +45.9) | refund 8/0, order 9/0, pickup 3/0 |

## Projection made before the run, not what was spent

These are estimates, made from the calibration attempts before any arm spent. Nothing here was spent; what was spent is under Money and Arms.

| Input | Value | Source | Note |
| --- | --- | --- | --- |
| Hosted attempt | $0.0079 | measured | mean of 15 calibration attempts as the provider billed them |
| Hosted attempt time (p50) | 17.2 s | measured | 15 calibration attempts on the hosted student |
| Input tokens per attempt | 88577.3 tokens | measured | 15 calibration attempts on the hosted student |
| Output tokens per attempt | 1977.7 tokens | measured | 15 calibration attempts on the hosted student |
| Spark author call | $0.0755 | assumed | 40,000 tokens in and 6,000 out at Spark's price; each arm's Spark cap holds it whatever it costs |
| Spark as the agent, per task | $0.1191 | assumed | the student's measured tokens per attempt at Spark's price |
| Local attempt time (p50) | 117.0 s | assumed | the 4-bit build on Oct 27 (median 1 min 57 s); the 2-bit build is unmeasured until a probe |
| Training job | $2.7000 | assumed | its whole authorization, 90 minutes on one L40S at $1.80 an hour, the most it can cost |

| Arm | Hosted attempts | Local attempts | Spark calls / tasks | Projected student | Projected Spark | Projected compute | Local GPU | Wall clock | Funded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bare student | 105 | 0 | 0 / 0 | $0.83 | $0.00 | $0.00 | 0 min | 20 min | yes |
| One-shot draft | 150 | 0 | 2 / 0 | $1.18 | $0.15 | $0.00 | 0 min | 22 min | yes |
| Targeted mentoring | 1449 | 0 | 14 / 42 | $11.43 | $5.00 | $0.00 | 0 min | 96 min | yes |

Projected for the funded arms: student $13.44 of $25.00, Spark $5.15 of $6.00, compute $0.00 of $0.00, local GPU 0 of 0 minutes, about 137 minutes of wall clock.

## Disclosures

- Claims rest on the locked test alone. Dev gains were picked by the keep rule, so they lean upward and are not claimed.
- Every arm ran with one mentoring seed (1). The locked test ran under seed 101. Seed 102 was declared for a decoding repeat that was not run, so no result here is under it.
- A pair's difference in pass rate is the first arm's less the second's, with a 95% interval for paired proportions: Newcombe's hybrid score method, his method 10 (Statistics in Medicine, 1998), made from the wins, losses, both and neither counts. When the interval includes zero, no difference was shown, which is not the same as showing there is none.
- Targets are quoted as observed counts: 57 of 60 meets the job's 95.0% target as observed. That is not proof of 95.0% reliability: 57 of 60 has a 95% Wilson interval of 86.3% to 98.3%.
- The arms' budgets differ and are not equal-budget comparisons. Bare student: Spark $0.00 of $0.00, student $0.88 of $1.24, compute $0.00 of no cap; One-shot draft: Spark $0.08 of $1.00, student $0.72 of $1.77, compute $0.00 of no cap; Targeted mentoring: Spark $0.34 of $4.92, student $1.66 of $17.14, compute $0.00 of no cap.
- The totals count each dollar once. A graduate's cumulative cost adds what it builds on: Targeted mentoring includes the one-shot draft arm's development (Spark $0.42, student $2.09, compute $0.00 in all).
- The request journal writes down every hosted request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again), and it counts a request a crash or a failure cut off at the most it could have cost, since its charge is not known. A restart repeats no recorded attempt, Spark reply or training job; an attempt in flight when a process stopped is made again, and its cut-off requests count in the journal at their worst; a Spark call in flight is paid again.
- Calibration against the provider's billing: it billed $0.12 where the listed price of the same usage is $0.12 (1.000 times), for 131 of 131 calls. Costs are what it billed wherever it said.
- Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. A01 is not met: this comparison ran no training job.
- Local evaluation incomplete: no locked test ran on this computer, so no result here describes muse-glimmer:30b-iq2, the build the agents are set to run on.
- Hosted results ran on openrouter.ai, pinned to DeepInfra with no fallback (bf16, as DeepInfra's listing on OpenRouter says; not reported per call); this computer runs muse-glimmer:30b-iq2, so hosted and local tables are never compared row to row.
