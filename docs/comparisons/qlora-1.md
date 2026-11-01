# Fine-tuning: qlora-1, Inventory desk's work distilled into a LoRA adapter

Written on Nov 1, 2026 from the run's records. Run folder: `architect-runs/qlora-1` (PLAN.md written before the first job and amended before each one after, SPEND.md, every job's record and log, the adapter and its integrity record).

## The result

Architect fine-tuned Glimmer on a screening lab's checker-passed work, end to end, through its own path, and brought back an adapter the adapter runtime's checks accept.

- **What was trained:** the 22 practice attempts at Inventory desk's train tasks that the checker passed, made by hosted Glimmer working with its taught harness (`inventory-1`, graduate `grd_mvxet7nj59cab32f6c`), exported by `architect field export` and sent by `architect train start`.
- **On what:** Glimmer's open weights, `meta-models/Muse-Glimmer-30B` at commit `cec94fc`, loaded in 4 bits (QLoRA), with a LoRA of rank 16 on 312 modules.
- **Where:** one NVIDIA A100 80 GB on Hugging Face Jobs (`a100-large`), job `trn_mvxqivn7c8e313ed76`.
- **How long and what it cost:** 8.2 minutes of GPU, of which 4.8 were training, for **$0.34**. The whole run, with three failed jobs that found and fixed three faults, cost **about $0.98**, under its $3.60 cap.
- **The adapter:** a GGUF LoRA of 180 MB, sha256 `1ff8de7b…edb7`. It passes the product's checks at the file level against the base GGUF on this computer.

**Its effect is not measured yet.** Whether the adapter changes how Glimmer does on Inventory desk's sealed final test, with Corvid Hill Discovery among its labs, is measured next. That needs a GPU to serve the base with the adapter, and none was used here. The training loss below says the adapter fits its 22 examples. It says nothing about the final test.

## What was trained on

The field export (`architect field export sample-inventory-desk-targeted`) takes every train attempt of the taught job's runs that the checker passed, by the job's own student, as a demonstration (decision 101). It takes one only when its trace is of its task, the harness version is unchanged by hash, each of the task's files is unchanged by hash, and no tool result was taken out of the student's view. Its targets are the student's own turns, except a turn whose tool call failed.

| | |
| --- | --- |
| Demonstrations | 22, from 20 train tasks across all three taught labs and all four skills (allocate 6, pick_lot 6, usable 6, reserve 4) |
| Target turns | 95 (tool calls and final answers); system prompt, request and tool results are context |
| Target tokens | 12,281 by Glimmer's own tokenizer and chat template; none skipped |
| Length | 3,730 to 5,754 tokens a conversation (median 4,373) |
| Dataset | sha256 `49275ffd…3e`, `passed_attempt` only, remote training allowed |

**Train material only, and nothing sealed.** The loader reads attempts with `split = 'train'` only. The dataset builder refuses an episode from any other split. Every example is scanned with the vault's locked-test detector and the sealed labs' names, and a hit stops the export. The export holds only the three taught labs' files; Corvid Hill Discovery appears in it only as one hash in `eval/manifest.json`. No demonstration mentions it.

**The owner's decision.** The job's data stayed on this computer by default. The owner allowed remote training for these synthetic labs, and `"sharing": {"remoteTraining": true, "corrections": false}` was added to the job, hashed before and after.

**One caveat.** Hosted Glimmer's reasoning wasn't kept in the traces, so the examples teach acting and answering without it.

## How it was trained

The pinned recipe (`trainer/recipe.json`): QLoRA with PEFT and bitsandbytes, NF4 with double quantization and bf16 compute; LoRA rank 16, alpha 32, dropout 0.05 on the text decoder's v, o and attention-gate projections and the MLP's gate, up and down; 2 epochs at 1e-4 with a cosine schedule and 5 warmup steps, batch 1 with 8 accumulation steps, seed 1234; llama.cpp's converter at `60eeeb6`, writing f16. The image is PyTorch 2.11 with CUDA 12.8, pinned by digest.

With 22 examples that is 3 optimizer steps an epoch and 6 in all, 5 of them warmup, so the learning rate reached its peak only at the last step.

### The loss curve

| Step | Epoch | Loss | Gradient norm | Learning rate |
| --- | --- | --- | --- | --- |
| 1 | 0.36 | 0.1060 | 0.83 | 0 |
| 2 | 0.73 | 0.0879 | 0.89 | 2e-5 |
| 3 | 1.00 | 0.0693 | 0.54 | 4e-5 |
| 4 | 1.36 | 0.0328 | 0.26 | 6e-5 |
| 5 | 1.73 | 0.0255 | 0.35 | 8e-5 |
| 6 | 2.00 | **0.0078** | 0.17 | 1e-4 |

Mean training loss 0.0549. From the trainer's `train.log`, which the job's manifest hashes. The loss starts low because these are Glimmer's own successful outputs: it already gives them high likelihood. What the adapter can add is consistency in what Glimmer does when it succeeds. It can't add anything Glimmer never did right.

## Five jobs to one adapter

| # | Job | Hardware | What happened | GPU time | Cost |
| --- | --- | --- | --- | --- | --- |
| 1 | `trn_mvxigyzs29e967fa76` | L40S | The Hub refused it: no prepaid credit on the account | none | $0.00 |
| 2 | `trn_mvxmeaycc8c67228bb` | L40S | 45 minutes waiting for hardware, then pip refused to install in the image (PEP 668) | 1.0 min | $0.03 |
| 3 | `trn_mvxp375y9a0407dc13` | L40S | Setup fixed; out of GPU memory at the first step | 8.0 min | $0.24 |
| 4 | `trn_mvxphy7n4437e84fae` | A100 | **Trained** (below), then the converter failed on q and k | 8.1 min | $0.34 |
| 5 | `trn_mvxqivn7c8e313ed76` | A100 | **Trained, converted, checked: the adapter** | 8.2 min | $0.34 |

The costs are the worker's records: time from when a job began to when it ended, at the flavor's price. Three diagnostic jobs on Hugging Face's CPU hardware (`cpu-basic` and `cpu-upgrade`) cost under $0.05 together. Each fault was fixed in the product, with a test, before the next job:

- **The image's Python** (decision 103). The pinned image runs Ubuntu's Python, marked as managed by the system, with no `ensurepip`. A CPU job found it. The bootstrap now tells pip to install beside the image's torch, and the pipeline installs the venv module with git. A second CPU job ran every setup step on the image before any GPU did.
- **Memory**, and the planner's estimate (decision 104). The L40S (44.4 GiB as PyTorch sees it) ran out at the loss: 41.2 GiB in use and 4.2 GiB more asked. Architect's planner had put this job at 39.6 GB of 43.2 GB usable. It left out two real costs: PEFT keeps every weight it doesn't quantize in fp32 when it prepares a model for k-bit training (2.7B of Glimmer's), and the loss holds an fp32 log-softmax beside its fp32 copy of the logits. Corrected, it gives 43.4 GB on one L40S and 54.2 GB on one A100, so it no longer says the L40S fits. The next cheapest GPU that fits, the A100, was used within the same cap.
- **The converter** (decision 104). Attempt 4 trained for real (6 steps, loss 0.1060 to 0.0071, on 416 modules), but llama.cpp's converter at the pinned commit can't convert a LoRA on Glimmer's q and k projections: its RoPE un-permute calls `tensor.ndim`, which its LoRA wrapper lacks. The trained weights were lost with the job. A CPU job ran the pinned converter on synthetic adapters with Glimmer's real shapes. With q and k it failed the same way; without them it converted, and the result passed the product's adapter checks against the base. The recipe now leaves q and k out (14% fewer adapter parameters). The pipeline also now uploads the trained PEFT adapter, hashed, before it converts, so a conversion failure can't lose trained weights again.

Attempt 4's curve, on 416 modules, for comparison: 0.1060, 0.0879, 0.0680, 0.0311, 0.0241, 0.0071. The final run's is within a few thousandths of it at every step.

## The adapter's checks

All at the file level. No model was loaded on this computer, and no runtime was asked anything.

| Check | Result |
| --- | --- |
| The job's manifest lists the GGUF, both PEFT files and the log, each with its sha256; the worker downloaded each at the outputs' commit (`c1896ad`) and checked it | pass |
| `adapter.gguf`: 180,235,072 bytes, sha256 `1ff8de7bf7f1aaff7938f6fcf18ea8b5a263469aecc77b8b32c418a1c926edb7`, the same in the job's record and its manifest | pass |
| GGUF header: architecture `muse-glimmer`, type `adapter`, adapter type `lora`, alpha 32 | pass |
| `inspectLoraAdapter`: 312 `lora_a`/`lora_b` pairs over all 52 blocks, rank 16, F16, modules attn_v, attn_output, attn_gate, ffn_gate, ffn_up, ffn_down; no embedding adapters; not a stand-in | pass, no problems |
| `checkLoraAgainstBase`, against the header of `muse-glimmer:30b` in Ollama's store (16.76 GB, 731 tensors): same architecture, every adapted weight in the base, each pair shaped `[n_in, 16]` and `[16, n_out]` to fit its base tensor | pass, no problems |
| Base digest: the blob's bytes hash to `sha256:71b5c9c9abbc2a9e7c13550b6f9fe1f062650117a24490b15a310cbd7de03f8b`, the digest in Ollama's manifest | pass |

The integrity record the adapter runtime checks (decision 038) is `adapter/integrity.json`. It holds the adapter's sha256 and size, the base's name and digest, scale 1, and the training job's id. The PEFT adapter (360 MB, fp32) is kept beside it in the job's records.

## What it doesn't show

- **Any effect on the final test.** That is measured next, by serving the base with this adapter on a GPU and running the frozen graduate's locked test and its unseen lab with it and without it.
- **That training on the student's own successes helps.** This is self-distillation from 22 examples, 6 optimizer steps, mostly in warmup. A small loss on examples the model already rated likely is expected, not evidence.
- **Anything about the local build.** The adapter was checked against `muse-glimmer:30b` (Q4_K_M) by its file only. llama.cpp applies a LoRA trained on bf16 weights to a quantized base; how well it carries over is part of the measurement still to come.

Nothing was made public: every repository the run made on Hugging Face is private.
