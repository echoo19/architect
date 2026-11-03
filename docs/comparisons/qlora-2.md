# Fine-tuning: qlora-2, Sweep desk's work distilled into a LoRA adapter

Written on Nov 1, 2026 from the run's records. Run folder: `runs/qlora-2` (PLAN.md written before the job, SPEND.md, the job's record and log, the adapter and its integrity record). The first fine-tune, on Inventory desk, is [qlora-1.md](qlora-1.md); it found and fixed the faults this one ran without.

## The result

Architect's fine-tuning path ran clean, first time, on a second field: Sweep desk, which reads ML research groups' training runs.

- **What was trained:** the 6 practice attempts at Sweep desk's train tasks that the checker passed, made by hosted Glimmer on the taught arm's harness in [sweep-desk-2.md](sweep-desk-2.md) (graduate `grd_mvxpmxu2ecffc9ddfa`). They were exported by `architect field export` and sent by `architect train start`.
- **On what:** Glimmer's open weights, `meta-models/Muse-Glimmer-30B` at commit `cec94fc`, in 4 bits (QLoRA), with a LoRA of rank 16 on 312 modules.
- **Where:** one NVIDIA A100 80 GB on Hugging Face Jobs (`a100-large`), job `trn_mvxre3x2f6eb4cedd8`.
- **How long and what it cost:** 5.1 minutes of GPU, of which 1.8 were training, for **$0.21**, under its $5 cap.
- **The adapter:** a GGUF LoRA of 180 MB, sha256 `b1564f43…b25b`. It passes the product's file-level checks against the base GGUF on this computer.

**It barely trained, by construction.** With 6 examples and the recipe's 8 accumulation steps, each epoch is one optimizer step, and the first runs during warmup at learning rate 0. The adapter got one update at 2e-5, and the loss was the same at both steps (0.1398). This run shows the path working on an AI lab's data; it doesn't produce an adapter expected to change anything.

**Its effect is not measured.** Whether it changes Glimmer on Sweep desk's sealed final test, Fennick Research among its groups, is measured next, with a GPU to serve the base with the adapter. None was used here.

## What was trained on

| | |
| --- | --- |
| Demonstrations | 6: halden-diverged-06, halden-early_stop-06, marlow-early_stop-08, marlow-next_runs-01, quill-best_config-04, quill-did_it_help-05 |
| Target turns | 46 |
| Target tokens | 3,114 by Glimmer's own tokenizer and chat template; none skipped |
| Length | 3,875 to 9,838 tokens a conversation |
| Dataset | sha256 `2ed30e53…3350`, `passed_attempt` only, remote training allowed |

The export's guards held as in qlora-1: train split only, each attempt checked against its harness and files, every example scanned with the locked-test detector and the sealed group's names. Fennick Research appears in the export only as one hash. In the first Sweep desk run the same guard refused the export, because `marlow-next_runs-01` then matched final-test tasks; after the generator fix it passed. The owner allowed remote training for these synthetic groups, and the job's `sharing` was set, hashed before and after.

## How it was trained

The recipe qlora-1 ended on, unchanged (`field/main` `53b52a38`): QLoRA with NF4 and bf16 compute; LoRA rank 16, alpha 32, on v, o and the attention gate and the MLP's gate, up and down; 2 epochs at 1e-4 with a cosine schedule and 5 warmup steps, batch 1 with 8 accumulation steps; llama.cpp's converter at `60eeeb6`, f16. The PEFT adapter was uploaded, hashed, before the conversion.

Sized by Architect's corrected planner before it was sent: at 9,838 tokens, one L40S doesn't fit and one A100 does (66.2 GB of 72 usable, counting a gathering term a single GPU doesn't need).

| Step | Epoch | Loss | Gradient norm | Learning rate |
| --- | --- | --- | --- | --- |
| 1 | 1 | 0.1398 | 4.28 | 0 |
| 2 | 2 | 0.1398 | 4.20 | 2e-5 |

The second step's loss is computed before its update, so neither row reflects a trained adapter.

## The adapter's checks

All at the file level. No model was loaded on this computer.

| Check | Result |
| --- | --- |
| The job's manifest lists the GGUF, both PEFT files and the log with their sha256; the worker downloaded each at the outputs' commit (`cbcee42`) and checked it | pass |
| `adapter.gguf`: 180,235,072 bytes, sha256 `b1564f43492d6e6c713d6a29e07e1afa628e877d6dc01a8e8fe68d4bf7fbb25b`, the same in the job's record and its manifest | pass |
| GGUF header: architecture `muse-glimmer`, type `adapter`, adapter type `lora`, alpha 32 | pass |
| `inspectLoraAdapter`: 312 pairs over all 52 blocks, rank 16, F16, modules attn_v, attn_output, attn_gate, ffn_gate, ffn_up, ffn_down; not a stand-in | pass, no problems |
| `checkLoraAgainstBase` against `muse-glimmer:30b` in Ollama's store: same architecture, every adapted weight in the base, every pair shaped to fit | pass, no problems |
| Base digest: the blob's bytes hash to `sha256:71b5c9c9abbc2a9e7c13550b6f9fe1f062650117a24490b15a310cbd7de03f8b` | pass |

The integrity record the adapter runtime checks is `adapter/integrity.json` in the run folder.

## What a useful Sweep desk adapter would need

More demonstrations than one train batch's passes. Here the taught arm's Spark cap ended its rounds after one call, so it made only 12 practice attempts. A larger taught-arm cap, or demonstrations from more practice rounds, would give the recipe enough examples for its 8-step accumulation to take several steps past warmup. Nothing was made public: the job's repository is private.
