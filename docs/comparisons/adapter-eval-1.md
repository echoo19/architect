# Fine-tuning measured: qlora-1's adapter on Inventory desk's sealed final test

Written on Nov 2, 2026 from the run's stored records. Run folder: `architect-runs/adapter-eval-1` (PLAN.md written before anything was spent, with three amendments written before any locked test was released and a run record after; SPEND.md; both comparisons' folders; the endpoint's logs; the analysis scripts and their output). Code: a pinned checkout of branch `runs/adapter-eval-1` at `b5204eab`, which adds three options to the comparisons runner (decision 105). The adapter is the one [qlora-1.md](qlora-1.md) reports.

## The result

With Inventory desk's taught harness held fixed, the adapter raised Glimmer's score on the sealed final test. At Corvid Hill Discovery, the lab neither the harness nor the adapter ever saw, Glimmer with the adapter passed **32 of 32**. Without it, on the same deployment, it passed **22 of the 30** it took. Paired task by task that is **+26.7 points (95% interval +9.8 to +44.4)**: 8 wins and no losses. The interval is above zero, so by the registered rule this is a rise.

The base arm never took two Corvid Hill tasks: Hugging Face paused the endpoint when the account's prepaid credit ran out, with four attempts left in the run. The adapter arm passed both of those tasks, so they can only be ties or more wins for it. Counted either way the result stands: +25.0 (+9.1 to +42.1) if the base had passed both, +31.3 (+14.2 to +48.6) if it had failed both.

On the taught labs' test split the adapter arm passed 23 of 24 against 19, +16.7 points (-1.7 to +36.1): 4 wins, no losses, an interval that just includes zero, so flat by the rule. Over all 54 tasks both arms took it is +22.2 points (+10.4 to +35.1), 12 wins and no losses.

This is one seed, 54 to 56 tasks an arm, and an adapter trained on 22 examples in 6 optimizer steps. The limits are at the end, and the first of them matters most: the adapter also stopped Glimmer from writing its reasoning, so this run can't say how much of the gain is the lessons and how much is answering without thinking aloud.

## What was asked

qlora-1 fine-tuned Glimmer on the 22 practice attempts at Inventory desk's train tasks that the checker passed, made by hosted Glimmer with its taught harness (see [inventory-desk-1.md](inventory-desk-1.md) for the desk, its labs and its checker). The question: with that same harness, does the adapter change how many sealed final-test tasks Glimmer passes?

- **Primary.** Taught harness with the adapter minus taught harness without it, at Corvid Hill (32 tasks), paired task by task: wins, losses, and the difference in pass rate with a 95% interval for paired proportions (Newcombe, method 10). It rises only if the interval is above zero, falls only if it is below; otherwise it is flat.
- **Secondary.** The same on the seen labs (24) and on all 56; each lab and skill; the blank harness with and without the adapter.
- **Rule.** One seed, no rerun or tuning after any locked result; a run that pauses after a locked test starts is reported as it stands.

The hypothesis written down beforehand was a small or null effect.

## How it was measured

**One deployment, two names.** Glimmer (`meta-models/Muse-Glimmer-30B` at `cec94fc`) was served by vLLM 0.32.0 on one NVIDIA A100 80 GB, on a Hugging Face Inference Endpoint in AWS us-east-1. The same process served it under two model names: `muse-glimmer`, the base, and `muse-glimmer-qlora-1`, the base with qlora-1's PEFT adapter (rank 16, alpha 32, 312 modules). The container downloaded the adapter from its private repository at the training job's commit (`c1896ad`) and checked both files' sha256 against the job's manifest before vLLM started. vLLM logged "Loaded new LoRA adapter" for the second name. So the weights, the quantization, the GPU, the server and the chat template were the same for both names. The only difference was the adapter.

**bf16, not 4-bit.** The adapter was trained on the base loaded in 4-bit NF4. vLLM dropped bitsandbytes in 0.28.0, the first release that serves Glimmer, so no vLLM release can serve Glimmer in NF4. Both arms ran in bf16. That is the usual way a QLoRA adapter is served, but it is not the arithmetic the adapter was trained against.

**The arms.** Two comparisons of the runner, one per model name, each with two arms, on the same job folder (a byte copy of inventory-1's, hashes checked), splits seed 20261101, mentoring seed 1 and locked-test seed 101:

| Arm | Harness | Decoding |
| --- | --- | --- |
| Taught | Inventory desk's frozen graduate `grd_mvxet7nj59cab32f6c`, harness `sha256-27b46e7cbde4…`, adopted whole with no mentor call | temperature 0, top_p 1, top_k 64, 30 steps, 8,192 tokens a turn, reasoning high |
| Blank | Glimmer's blank harness | temperature 1, top_p 0.95, top_k 64, 16 steps, 4,096 tokens a turn, reasoning low |

Both comparisons froze the taught harness unchanged: every file equals inventory-1's frozen v3, and the frozen hash is the same. No mentor was called in this run. The organizations' brief was inventory-1's confirmed one, reused without a call, and no arm here reads it. The locked test is the same 56 tasks inventory-1 used: 24 from Fenwick Screening Core, Alder Row Biosciences and Saltmarsh Institute Assay Lab, and Corvid Hill's 32, sealed in the vault.

**Before any arm**, a smoke check asked each name one tool-call question at temperature 0. Both answered with the right tool call. The base wrote a short reasoning span first; the adapter went straight to the call, and the two names' log-probabilities differed from the second token on. The adapter's training examples hold no reasoning (hosted Glimmer's reasoning wasn't kept in the traces), so this is what it was taught.

## Locked test

Tasks passed out of those taken, with a 95% Wilson interval in brackets.

| Arm | Seen (24) | Corvid Hill (32) | All |
| --- | --- | --- | --- |
| Taught, base | 19 of 24, 79.2% (59.5 to 90.8) | 22 of 30, 73.3% (55.6 to 85.8) | 41 of 54, 75.9% (63.1 to 85.4) |
| **Taught, with the adapter** | **23 of 24, 95.8% (79.8 to 99.3)** | **32 of 32, 100% (89.3 to 100)** | **55 of 56, 98.2% (90.6 to 99.7)** |
| Blank, base | 5 of 24, 20.8% (9.2 to 40.5) | 3 of 32, 9.4% (3.2 to 24.2) | 8 of 56, 14.3% (7.4 to 25.7) |
| Blank, with the adapter | 6 of 24, 25.0% (12.0 to 44.9) | 7 of 30, 23.3% (11.8 to 40.9) | 13 of 54, 24.1% (14.6 to 36.9) |

The two tasks missing from the base taught arm and from the blank arm with the adapter are the same two, `corvid-hill-reserve-07` and `-08`: the last in each arm's queue when the endpoint was paused.

### By lab

| Lab | Taught, base | Taught, adapter | Blank, base | Blank, adapter |
| --- | --- | --- | --- | --- |
| Alder Row Biosciences (seen) | 8/9 | 9/9 | 5/9 | 3/9 |
| Fenwick Screening Core (seen) | 6/7 | 7/7 | 0/7 | 2/7 |
| Saltmarsh Institute Assay Lab (seen) | 5/8 | 7/8 | 0/8 | 1/8 |
| **Corvid Hill Discovery (never seen)** | **22/30** | **32/32** | 3/32 | 7/30 |

### By skill and group

| Skill | Group | Taught, base | Taught, adapter | Blank, base | Blank, adapter |
| --- | --- | --- | --- | --- | --- |
| Usable | Seen | 6/6 | 6/6 | 2/6 | 4/6 |
| | Corvid Hill | 4/8 | 8/8 | 1/8 | 3/8 |
| Pick a lot | Seen | 6/6 | 6/6 | 2/6 | 1/6 |
| | Corvid Hill | 7/8 | 8/8 | 1/8 | 3/8 |
| Allocate | Seen | 5/6 | 6/6 | 0/6 | 1/6 |
| | Corvid Hill | 5/8 | 8/8 | 0/8 | 1/8 |
| Reserve | Seen | 2/6 | 5/6 | 1/6 | 0/6 |
| | Corvid Hill | 6/6 | 8/8 | 1/8 | 0/6 |

### Paired results

Task by task under seed 101, on the tasks both arms took. A win is a task the arm with the adapter passed and the arm without it failed; a loss is the reverse. The bold row is the primary comparison.

| Harness | Group | Tasks | Wins / losses | Both / neither | Difference (95% interval) | By the rule | Wins/losses by skill |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Taught** | **Corvid Hill** | 30 | 8 / 0 | 22 / 0 | **+26.7 (+9.8 to +44.4)** | **rose** | usable 4/0, allocate 3/0, pick a lot 1/0 |
| Taught | Seen | 24 | 4 / 0 | 19 / 1 | +16.7 (-1.7 to +36.1) | flat | reserve 3/0, allocate 1/0 |
| Taught | All | 54 | 12 / 0 | 41 / 1 | +22.2 (+10.4 to +35.1) | rose | |
| Blank | Corvid Hill | 30 | 6 / 2 | 1 / 21 | +13.3 (-6.1 to +32.1) | flat | usable 3/1, pick a lot 2/0, allocate 1/0, reserve 0/1 |
| Blank | Seen | 24 | 4 / 3 | 2 / 15 | +4.2 (-18.7 to +26.6) | flat | usable 3/1, allocate 1/0, pick a lot 0/1, reserve 0/1 |
| Blank | All | 54 | 10 / 5 | 3 / 36 | +9.3 (-5.3 to +23.5) | flat | |

Per lab, the taught harness's wins and losses with the adapter were 1/0 at Alder Row, 1/0 at Fenwick, 2/0 at Saltmarsh and 8/0 at Corvid Hill. Only Corvid Hill has enough tasks for its interval to clear zero.

### How the attempts ran

| Arm | Calls an attempt | Output tokens a call | Median seconds (95th percentile) | How the misses ended |
| --- | --- | --- | --- | --- |
| Taught, base | 4.4 | 357 | 55.5 (200.2) | 13 wrong answers |
| Taught, adapter | 5.2 | 149 | 14.4 (73.6) | 1 wrong answer |
| Blank, base | 2.9 | 391 | 13.4 (199.5) | 39 wrong answers, 8 errors, 1 at the step limit |
| Blank, adapter | 9.9 | 133 | 51.4 (149.0) | 29 wrong answers, 11 at the step limit, 1 error |

Output tokens include reasoning; vLLM didn't report it apart. With the adapter Glimmer wrote less than half as much a call and made more calls. With the taught harness that meant reading the files and calling `plan_stock` the way the harness asks, in a quarter of the time. With the blank harness, which has no tool to lean on, it meant looping until the 16-step limit 11 times. Locked tests ran one attempt at a time per arm, four arms at once on one GPU, so the seconds compare the arms with each other, not with any other serving.

## What the numbers support

- **With the taught harness the adapter helped, most at the lab it never saw.** 12 wins and no losses over 54 tasks, 8 of them at Corvid Hill, where the arm with the adapter passed every task. The wins were in usable, allocate and pick a lot at Corvid Hill, and in reserve on the seen labs.
- **With the blank harness, nothing shown.** 10 wins and 5 losses, intervals across zero in every group. The adapter was trained on attempts made with the taught harness and its tool, and on its own harness it gives a blank one little.
- **Part of the effect may be the missing reasoning.** The adapter learned from traces with no reasoning in them, and it answers without any. On this serving the base, reasoning at "high" and at temperature 0, scored lower than the same harness did on DeepInfra in inventory-1 (41 of 54 here; 48 of 56 there, 27 of 32 at Corvid Hill). If reasoning hurts this harness on this serving, an adapter that drops it would gain from that alone. This run can't separate the two. A base arm told to reason at "low", or an adapter trained on traces that keep their reasoning, would.
- **The dev results point the same way and aren't claimed.** On the 24 dev tasks the adopted taught harness scored 20 without the adapter and 24 with it. Those were runner steps, not the test.

## Money

- **GPU: at most $4.42** of the $25 cap, at $2.50 an hour for one A100: about 6 minutes on a first deployment that couldn't start, and 98 minutes on the second, from its creation until Hugging Face paused it, plus 2 paused minutes before it was deleted. SPEND.md has each step.
- **No hosted model, no mentor.** No OpenRouter, Meta or DeepInfra call was made. The runner priced the endpoint's tokens at DeepInfra's Glimmer rates only to cap their volume; that isn't money spent.
- **The endpoint is deleted.** Its GET returns 404 and the namespace lists no endpoint (00:02 UTC, Nov 2).

## What went wrong on the way, and what was changed

Each change was written into PLAN.md before any locked test was released.

- **The first image couldn't start vLLM.** `vllm/vllm-openai:v0.32.0-cu129` ships a torchcodec built for CUDA 13 (`libnvrtc.so.13` missing), and vLLM's import of it fails with an error it doesn't catch. The second deployment used `vllm/vllm-openai:v0.32.0` (CUDA 13.0), which the endpoint's driver (580) supports.
- **A start against the deleted first address.** It reached no model and nothing was recorded; it was set aside.
- **The adapter comparison first dropped its primary arm.** Its calibration priced an attempt at twice the base's tokens (the adapter's extra calls), so under a $5 token cap the runner left the taught arm out. It was stopped before any test, set aside, and run again with a $15 cap, inventory-1's. The cap counts tokens, not money, and each arm's own cap is still its projection.
- **The endpoint was paused by Hugging Face at 00:00 UTC**, when the account's prepaid credit ran out, with four attempts left (above). The run stopped there, as its rules say.

## The runner change

The comparisons runner had no way to test a frozen harness on a model of the person's choosing, so branch `runs/adapter-eval-1` adds three options, each inert unless given (decision 105):

- `--student-url`, `--student-model` and `--student-key-env` make every arm's hosted student any OpenAI-compatible endpoint. Its key is stored under that endpoint's own host, so the product's key guard sends it there and nowhere else.
- `--draft-harness` has the draft arm adopt a harness folder whole, measured and frozen like a draft, with no mentor call.
- `--study` shares a brief the person confirmed in an earlier comparison of the same organizations' files, in place of a new study.

Tests cover each: a field comparison that reuses a brief and adopts a harness makes no mentor call at all, refuses an unconfirmed brief and freezes the harness it was given; the endpoint is priced, bound to its host and unpinned; the projection asks no Spark of an adopted draft.

## Limitations

- **One seed and small groups.** Corvid Hill has 30 to 32 tasks here and each seen lab 7 to 9. The primary interval is well clear of zero, but its width is about 35 points.
- **Two tasks short.** The base taught arm and the blank arm with the adapter took 54 of 56. The bounds above show the primary result holds whatever the two would have been.
- **Reasoning and lessons are mixed.** See above: the adapter removed the reasoning span, and that could account for some or all of the gain.
- **bf16, not the NF4 base it was trained on.** No vLLM release serves Glimmer in 4 bits through bitsandbytes.
- **Not the local build.** Graduates run Glimmer's 2-bit GGUF on Ollama or llama-server, and the adapter's GGUF on that build took no test here. This computer's GPU wasn't used, and no inference ran on it. The runner did read the 2-bit build's description from Ollama, as every freeze pins it; nothing was loaded (`/api/ps` empty before and after).
- **The adapter's own training data came from the taught labs only.** No Corvid Hill material was in it (qlora-1 checked), so the Corvid Hill result is a transfer result. But all four labs come from one generator, so a lab someone else wrote may not transfer as well.
- **Self-distillation.** The adapter learned from Glimmer's own successful attempts with this harness. That it made those habits more consistent is what this result most plainly shows. It doesn't show the adapter teaches anything Glimmer couldn't already do.
