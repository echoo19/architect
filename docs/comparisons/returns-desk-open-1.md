# Comparisons: Returns desk, taught by Muse Spark Open

Written on Nov 1, 2026 from the run's stored records. Code: a pinned checkout of Architect at `a385c043`, used unchanged, with no in-memory patches. Splits seed 20261029, the same split as [returns-desk-2](returns-desk-2.md). Mentoring seed 1, final-test seed 101. Both models have open weights: Muse Spark Open teaches and Muse Glimmer learns.

## Result

**Muse Spark Open's teaching made Glimmer better on the final test.** After 2 rounds of teaching (a one-shot draft, then 1 refinement), Glimmer passed **39 of 60** final requests. On its own, on the same 60, it passed **18 of 60**. The paired difference is **+35.0 points, with a 95% interval of +16.8 to +50.2**. The interval is above zero, so this counts as a gain. Neither version reaches the job's 95% target.

| Glimmer | Final test, out of 60 (95% Wilson) | Refunds | Order questions | Pickups |
| --- | --- | --- | --- | --- |
| On its own | 18, 30.0% (19.9% to 42.5%) | 7/20 | 6/20 | 5/20 |
| Spark Open's one-shot draft | 31, 51.7% (39.3% to 63.8%) | 13/20 | 7/20 | 11/20 |
| Taught by Spark Open (draft + 1 refinement) | 39, 65.0% (52.4% to 75.8%) | 14/20 | 10/20 | 15/20 |

| Paired, request by request | Wins | Losses | Both | Neither | Difference, points (95% interval) |
| --- | --- | --- | --- | --- | --- |
| Taught vs on its own | 28 | 7 | 11 | 14 | +35.0 (+16.8 to +50.2) |
| Draft vs on its own | 21 | 8 | 10 | 21 | +21.7 (+4.2 to +37.4) |
| Taught vs draft | 8 | 0 | 31 | 21 | +13.3 (+4.1 to +22.1) |

The intervals for paired proportions use Newcombe's method 10. All three intervals are above zero. The one refinement Spark Open made ("Fix email normalization and stop wasteful CSV reads") won 8 requests over the draft and lost none.

**For reference only, from a different run.** In [returns-desk-2](returns-desk-2.md) (Oct 29, engine `a09975c`, teacher Muse Spark 1.3 on Meta's API), the same final test gave 44 of 60 on its own and 58 of 60 taught. Don't compare those numbers with these. Glimmer on its own went from 44 to 18 between the two runs, with the same harness, the same settings and the same tasks. The likely cause is under Limits. Within each run, both arms were measured the same way.

## How it ran

- **Teacher.** Muse Spark Open, `meta/muse-spark-open` on OpenRouter at $1.25 / $0.15 / $4.25 per million tokens. It was pinned to **BaseTen** with no fallback (`provider: { order: ['BaseTen'], allow_fallbacks: false, max_price }`). Medium reasoning effort.
- **JSON without structured output.** BaseTen serves Spark Open without `response_format`, and OpenRouter drops any provider that lacks a parameter the request carries. So the mentor ran with `structuredOutput: false`: the schema went in the prompt, and a reply that didn't parse would get one repair call. The code for both settings (`providers` and `structuredOutput` on the mentor) was written, reviewed and merged before the run.
- **Student.** Hosted Glimmer, `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra (bf16) with no fallback. It ran with a 16,384-token context, and every attempt was hosted. Nothing ran on this computer's GPU.
- **Arms.** Glimmer on its own (blank harness, run fresh). Spark Open's one-shot draft, whose final test was paid for, not held. The taught arm, which starts from the draft and refines it on Glimmer's failed practice attempts, keeping a change only if it clears the job's keep rule on the 45 check tasks (+2, no type down more than 1). The teacher never saw the final test; it stays sealed in the vault.
- **The plan.** It was written in the run folder before anything ran, and amended before anything ran on each new checkout. It isn't in a public registry, so its times are file times. It registered 3 rounds of teaching (the draft and 2 refinements), caps of $4 for Spark Open and $10 for Glimmer, and the primary outcome above.

## Which provider served it, and repairs

- **Provider.** Before the run, three calls through the same adapter, job settings and pin all came back from **BaseTen**: OpenRouter's response names the provider. Every call in the run carried the same pin with no fallback, so OpenRouter could only serve it on BaseTen or fail it. None failed. The engine doesn't record the serving provider per call, so the run's own records show the pin, not a per-call name.
- **Repairs.** The three probe calls all parsed on the first request. In the run, all 4 Spark Open calls produced a usable reply: the draft's 2 and round 1's 2, each round's pair as the method makes them. No round failed on an unusable reply. The engine records a repair as part of the call it repairs, not separately, so the exact number of repair requests in the run isn't in the records.

| Spark Open call | Tokens in | Tokens out (reasoning) | Cost |
| --- | --- | --- | --- |
| Draft, 1 | 19,354 | 8,601 (2,143) | $0.0607 |
| Draft, 2 | 25,862 | 4,678 (366) | $0.0522 |
| Refinement round 1, 1 | 22,281 | 2,912 (689) | $0.0402 |
| Refinement round 1, 2 | 24,576 | 2,267 (117) | $0.0404 |

## Cost

- **Spark Open: $0.19** for the run's 4 calls (the engine's cost ledger). With the probes and the routing checks before the run, about $0.21 in all. The cap was $4.
- **Glimmer: $3.13** (calibration $0.05, the arms $3.07). The attempts record and the request journal agree to the cent: 4,428 requests, all billed by the provider, none cut off. The cap was $10.
- The taught Glimmer's whole development cost, the draft's included: Spark Open $0.19 and Glimmer $1.79.

## Limits

- **2 rounds of teaching, not the 3 registered.** Before the second refinement, the taught arm's own Glimmer cap ($2.08, the runner's projection times 1.2) couldn't cover another round and its final test. Attempts on its harness cost $0.0053, against calibration's $0.0035. The runner stopped the arm with what it had kept, as it should. The cap wasn't raised, and nothing was rerun.
- **Glimmer on its own did much worse than in returns-desk-2, and the engine is the likely cause.** In this run, 12 of its 60 final attempts ended in an error. Final-test traces aren't kept, so their cause isn't in the records. But all 19 errored attempts on the practice and check tasks whose traces are kept, in every arm, were this engine's refusal of a turn whose prompt no longer fits Glimmer's 16,384-token context. Returns-desk-2's engine had no final attempt end in an error: its passing final attempts averaged about 111,000 input tokens across their turns, against about 60,000 here. The stricter limit matches the context the build on this computer runs with. But it makes the bare arm weaker here, so the +35 points is measured against a weaker baseline than returns-desk-2's. The taught arm had no final attempt end this way.
- **One seed per arm.** One mentoring seed (1) and one decoding seed (101). Seed 102 was declared for a repeat that wasn't run.
- **Hosted, not local.** Every result is hosted Glimmer at bf16. No final test ran on the 2-bit build the agents are set to run on.
- **The provider per call isn't recorded.** BaseTen serving rests on the probe responses and the no-fallback pin, not on a per-call record.
- **The plan isn't public.** It sits in the run folder with dated amendments, and the times are file times.
- **Check-task gains aren't claimed.** The keep rule picked them, so they lean upward. Claims rest on the final test alone.

## The runner's report

The rest is the comparisons runner's own report, made from the stored records and not edited. It calls the check tasks "check tasks" and the teacher "Spark".

Made 2026-11-01T07:01:30.517Z at commit a385c043, from stored records only. Splits seed 20261029: 15 calibration, 60 train, 45 check and 60 final-test tasks. Mentoring seed 1. Development closed at 2026-11-01T06:28:43.721Z, when the final tests were released; no arm developed after it.

Final-test seeds declared in the plan before any arm ran: 101 and 102. Seed 101 ran for Glimmer alone, One-shot draft and Targeted mentoring. Seed 102 was declared for the decoding repeat and was not run, so no result in this report is under it.

Not in this comparison, so not run: Spark reference, blank harness; Spark reference, targeted harness; Teacher alone; Decoding repeat; Fixed intervention; One-shot adapter; Failure-specific adapter; and the runtime regression check.

Every reported agent is harness-only: none has trained weights.

Pinned when the plan was made, and checked on every run since: Returns desk (sample-gear-returns): job.json `f054a4f1686a`, tasks `bb8c885c77a2`, data `9a2acfeee048`, checker `76cabbe15f71`.


## Money

What was spent, from the records. The projection made before the run is further down, apart from this, and none of it is counted here. The three figures for hosted Glimmer count the same requests in different ways, so they are not added together.

- **Spark Open: $0.1935.** The cost ledger: every Spark Open call. Spark Open calls are not in the request journal.
- **Compute: $0.0000.** No training job was paid for.
- **Hosted Glimmer, recorded by its attempts: $3.1257.** The cost written down with each attempt, every dollar once: the arms $3.0725 and the calibration $0.0531.
- **Hosted Glimmer, settled by the provider: $3.1257.** The request journal's 4,428 requests with a known charge, all of them billed by the provider. That is the same as the attempts record.
- **Hosted Glimmer, uncertain: $0.0000.** No request was cut off.

The journal counts $3.1257 in all, settled plus uncertain, of the $10.00 set aside for hosted Glimmer: the same as the attempts record.

## Arms

| # | Arm | Status | Rounds used of the most allowed, and why training ended | Check tasks, first measurement | Check tasks, last kept round: before to after |
| --- | --- | --- | --- | --- | --- |
| 1 | Glimmer alone | complete | - | 19/45 | - |
| 2 | One-shot draft | complete | 1 of 1, done | 20/45 | round 1: 20/45 to 31/45 (kept without a check) |
| 3 | Targeted mentoring | stopped | 2 of 2, stopped | 28/45 | round 1: 58/90 to 64/90 |

The first check-task measurement is one run over the check tasks. A round that went through the keep rule is decided on its confirmation: the check tasks again on new seeds, over more than one run, so its before and after are out of a larger total. Compare a round's before with its after, not with the first measurement. A one-shot draft is kept without a check, so its before and after are one run each.

| # | Arm | Spark Open: spent of its cap, tokens | Glimmer: spent of its cap, attempts | Compute | Examples / trained tokens |
| --- | --- | --- | --- | --- | --- |
| 1 | Glimmer alone | $0.00 of $0.00, 0 in / 0 out | $0.65 of $0.45, 105 attempts | $0.00, 0 min | 0 / 0 |
| 2 | One-shot draft | $0.11 of $1.00, 45,216 in / 13,279 out | $0.93 of $0.64, 150 attempts | $0.00, 0 min | 0 / 0 |
| 3 | Targeted mentoring | $0.08 of $2.89, 46,857 in / 5,179 out | $1.49 of $2.08, 297 attempts | $0.00, 0 min | 0 / 0 |

**Glimmer alone.** Glimmer on the blank starting harness, with no mentoring: the baseline the other arms are compared with. Frozen: harness version 1 (`1ea24f894dce`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from hosted Glimmer; that local build was not measured.

**One-shot draft.** Spark wrote the whole harness once, from the job alone, without seeing Glimmer attempt anything. It is kept whatever it scores. Frozen: harness version 2 (`17ee0fbc75fc`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from hosted Glimmer; that local build was not measured. Round 1 (draft) kept: Compact Harness - Refund/Pickup/Order Skills + Tools. Dev 20/45 to 31/45; the one-shot method keeps its harness without a keep-or-revert check.

**Targeted mentoring.** Why: Before round 2 it had spent $1.26, and one more round with its final test could cost $1.34 more (at $0.0053 an attempt), past its $2.08 cap, so it stopped there with what it had kept. Each round Spark reads Glimmer's failed attempts on practice tasks and makes one change to the harness; a change is kept only if it clears the keep rule on the check tasks. It starts from the draft arm's kept harness (version 2), so the draft's Spark spend came off this arm's cap, and its cumulative cost below includes the draft's development. Its graduate's cumulative development cost, with the one-shot draft arm's: Spark Open $0.19, Glimmer $1.79, compute $0.00. Frozen: harness version 2 (`f45f63758830`). Once installed, it is set to run on `muse-glimmer:30b-iq2` on Ollama. All of its measurements here are from hosted Glimmer; that local build was not measured. Round 1 (harness) kept: Fix email normalization and stop wasteful CSV reads. Dev 27/45 to 31/45, measured again on new seeds: 58/90 to 64/90 over 2 runs, no type lost more than two. Round 2 (harness) stopped: Round 2. Training was stopped before this change was scored.

## Final test, one table per backend

### Hosted Glimmer

Model meta/muse-glimmer-30b; served by openrouter.ai, pinned to DeepInfra with no fallback on openai_compatible; quantization bf16, as DeepInfra's listing on OpenRouter says; not reported per call; GGUF none; runtime build not recorded; chat template the provider's own; context 16,384 tokens

Settings each row ran with. The harness sets these, so each row compares a whole configuration: the harness text together with its sampling and limits.

| Arm | Temperature | top_p | top_k | Reasoning | Turn limit | Output tokens a turn |
| --- | --- | --- | --- | --- | --- | --- |
| Glimmer alone | 1 | 0.95 | 64 | low | 16 | 4,096 |
| One-shot draft | 0.2 | 0.95 | 64 | medium | 20 | 4,096 |
| Targeted mentoring | 0.2 | 0.95 | 64 | medium | 20 | 4,096 |

| Arm | Final test, seed 101 (95% Wilson) | Target | By type | Refused | Latency p50 / p95 | Cold start | Peak memory | Harness |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Glimmer alone | 18/60, 30.0% (19.9% to 42.5%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 7/20, Order questions 6/20, Pickups 5/20 | 0 | 8.8 s / 67.7 s | - | - | `1ea24f894dce` |
| One-shot draft | 31/60, 51.7% (39.3% to 63.8%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 13/20, Order questions 7/20, Pickups 11/20 | 0 | 8.4 s / 99.1 s | - | - | `17ee0fbc75fc` |
| Targeted mentoring | 39/60, 65.0% (52.4% to 75.8%) | below the 95.0% target as observed (57 of 60 needed) | Refunds 14/20, Order questions 10/20, Pickups 15/20 | 0 | 6.0 s / 38.4 s | - | - | `f45f63758830` |

| Paired under seed 101, scenario by scenario | Scenarios | Wins | Losses (regressions) | Both | Neither | First less second, in percentage points (95% interval) | By type (wins/losses) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| One-shot draft vs Glimmer alone | 60 | 21 | 8 | 10 | 21 | +21.7 (+4.2 to +37.4) | refund 8/2, order 4/3, pickup 9/3 |
| Targeted mentoring vs Glimmer alone | 60 | 28 | 7 | 11 | 14 | +35.0 (+16.8 to +50.2) | refund 9/2, order 7/3, pickup 12/2 |
| Targeted mentoring vs One-shot draft | 60 | 8 | 0 | 31 | 21 | +13.3 (+4.1 to +22.1) | refund 1/0, order 3/0, pickup 4/0 |

## Projection made before the run, not what was spent

These are estimates, made from the calibration attempts before any arm spent. Nothing here was spent; what was spent is under Money and Arms.

| Input | Value | Source | Note |
| --- | --- | --- | --- |
| Hosted attempt | $0.0035 | measured | mean of 15 calibration attempts as the provider billed them |
| Hosted attempt time (p50) | 42.8 s | measured | 15 calibration attempts on hosted Glimmer |
| Input tokens per attempt | 27989.0 tokens | measured | 15 calibration attempts on hosted Glimmer |
| Output tokens per attempt | 1106.3 tokens | measured | 15 calibration attempts on hosted Glimmer |
| Spark author call | $0.0755 | assumed | 40,000 tokens in and 6,000 out at Spark's price; each arm's Spark cap holds it whatever it costs |
| Spark as the agent, per task | $0.0397 | assumed | Glimmer's measured tokens per attempt at Spark's price |
| Local attempt time (p50) | 117.0 s | assumed | the 4-bit build on Oct 27 (median 1 min 57 s); the 2-bit build is unmeasured until a probe |
| Training job | $2.7000 | assumed | its whole authorization, 90 minutes on one L40S at $1.80 an hour, the most it can cost |

| Arm | Hosted attempts | Local attempts | Spark Open calls / tasks | Projected Glimmer | Projected Spark Open | Projected compute | Local GPU | Wall clock | Funded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Glimmer alone | 105 | 0 | 0 / 0 | $0.37 | $0.00 | $0.00 | 0 min | 49 min | yes |
| One-shot draft | 150 | 0 | 2 / 0 | $0.53 | $0.15 | $0.00 | 0 min | 54 min | yes |
| Targeted mentoring | 489 | 0 | 4 / 12 | $1.73 | $0.78 | $0.00 | 0 min | 103 min | yes |

Projected for the funded arms: Glimmer $2.64 of $10.00, Spark Open $0.93 of $4.00, compute $0.00 of $0.00, local GPU 0 of 0 minutes, about 205 minutes of wall clock.

## Disclosures

- Claims rest on the final test alone. Check-task gains were picked by the keep rule, so they lean upward and are not claimed.
- Every arm ran with one mentoring seed (1). The final test ran under seed 101. Seed 102 was declared for a decoding repeat that was not run, so no result here is under it.
- A pair's difference in pass rate is the first arm's less the second's, with a 95% interval for paired proportions: Newcombe's hybrid score method, his method 10 (Statistics in Medicine, 1998), made from the wins, losses, both and neither counts. When the interval includes zero, no difference was shown, which is not the same as showing there is none.
- Targets are quoted as observed counts: 57 of 60 meets the job's 95.0% target as observed. That is not proof of 95.0% reliability: 57 of 60 has a 95% Wilson interval of 86.3% to 98.3%.
- The arms' budgets differ and are not equal-budget comparisons. Glimmer alone: Spark $0.00 of $0.00, Glimmer $0.65 of $0.45, compute $0.00 of no cap; One-shot draft: Spark $0.11 of $1.00, Glimmer $0.93 of $0.64, compute $0.00 of no cap; Targeted mentoring: Spark $0.08 of $2.89, Glimmer $1.49 of $2.08, compute $0.00 of no cap.
- The totals count each dollar once. A graduate's cumulative cost adds what it builds on: Targeted mentoring includes the one-shot draft arm's development (Spark $0.19, Glimmer $1.79, compute $0.00 in all).
- The request journal writes down every hosted request before it is sent, so it also holds requests that no recorded attempt keeps the cost of (an attempt that failed or was cut off and was made again), and it counts a request a crash or a failure cut off at the most it could have cost, since its charge is not known. A restart repeats no recorded attempt, Spark reply or training job; an attempt in flight when a process stopped is made again, and its cut-off requests count in the journal at their worst; a Spark call in flight is paid again.
- Calibration against the provider's billing: it billed $0.05 where the listed price of the same usage is $0.05 (1.000 times), for 79 of 79 calls. Costs are what it billed wherever it said.
- Harness-only graduate. Remote QLoRA training and adapter loading are built; real end-to-end training is not validated. A01 is not met: this comparison ran no training job.
- Local evaluation incomplete: no final test ran on this computer, so no result here describes muse-glimmer:30b-iq2, the build the agents are set to run on.
- Hosted results ran on openrouter.ai, pinned to DeepInfra with no fallback (bf16, as DeepInfra's listing on OpenRouter says; not reported per call); this computer runs muse-glimmer:30b-iq2, so hosted and local tables are never compared row to row.
