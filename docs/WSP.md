# Architect WSP

Architect WSP is the third edition of Architect, next to Architect and Architect Lab. It is experimental. You pick an open model on this computer and describe a goal with examples. GPT-6 Astra then writes programs that read the model's weights and propose a targeted edit. The runner measures every candidate the edit makes against the original model and two simpler fixes, and keeps a candidate only when it gains. Decision 109 in `DECISIONS.md` is the full contract. This page is the short version.

## Where the idea comes from

"Sparks of Weight-Space Programming" by Rikiya Takehi, Jayden Teoh, Alex Zhang and Omar Khattab of MIT CSAIL (Nov 2, 2026; [the post](https://rikiyat.github.io/blog/weight-space-programming/), [the logs](https://github.com/RikiyaT/lm_understand-logs), [the edited checkpoint](https://huggingface.co/RikiyaT/Qwen3.5-0.8B-weight-space-programming)).

What the research showed:

- Astra edited Qwen3.5-0.8B with no training, using a Python kernel over the weights and 50 forward passes. The edit removed one direction from 64 output columns of the MLP down projections in layers 15 and 19, which is 131,072 weights, or 0.016% of the model.
- MATH-500 went from 7.9 to 48.1, and answers cut off at the token limit fell from 93.0% to 33.1%.
- An independent rebuild of the checkpoint matched it.
- The search took 158 turns, 80 Python runs and 20.3 hours.
- The authors say the edit removed an obstacle that hid an ability; it could not add an ability the model lacked. A control model that didn't loop gained nothing.

What Architect WSP adds, and has not yet shown:

- An app that runs this kind of experiment on your own goal, with a deterministic check, a sealed qualification and the runner's caps.
- No real Astra experiment has run in Architect yet. Nothing here shows that weight edits help Architect's own jobs, or that a skill can be put into a model by editing it.

## The flow

1. **Model.** Pick a model in the Hugging Face cache or a folder you choose. You see its parameters, dtype, size, the memory it needs and whether it is supported. The original files are hashed and never written.
2. **Goal.** Write the task or behavior and any constraints. Add at least 12 examples, each a prompt with an optional check (contains, exact, regular expression or number), typed in or imported as JSONL.
3. **Compute and limits.** This computer's CPU. Defaults: 8 programs, 24 forward passes, 120 minutes, $5 for Astra, 300 seconds per program, at most 1% of the weights changed, 12 GB of memory. All can be changed.
4. **Brief.** Astra drafts the objective, baseline, investigation, success criteria, regression checks, target, the two controls and the expected output. You can edit any of it.
5. **Start experiment.** This approves the brief, by its hash. Nothing inside it asks again.
6. **Progress.** The experiment moves through baseline, investigation, proposed edit, candidate evaluation and results. It shows Astra's hypothesis, each program with what it printed and what it changed, the measurements, and how much of each cap is left. You can cancel it. An experiment stopped by closing the app resumes from its last finished program.
7. **Results.** The frozen candidate against the base and each control, with 95% intervals, any regressions, what wasn't compared and why, and the deployment status. From here you can run the sealed qualification once, and export the candidate as a whole checkpoint with its provenance.

## How it runs

| Part | What it may do |
| --- | --- |
| Kernel (`trainer/wsp/kernel.py`) | Runs one of Astra's programs in a fresh Python process, under a time limit and a memory cap. It reads the base by memory map and writes only to its own output folder and the experiment's scratch folder. A guard refuses the network, new processes, native calls and other files. It can't run the model. |
| Evaluator (`trainer/wsp/evaluator.py`) | The runner's own process, and the only one that runs the model. It checks every edit again before it builds a candidate, generates outputs, reads hidden states and exports checkpoints. It runs none of Astra's code. |
| Runner (`packages/engine/src/wsp`) | Checks the base's hashes, holds every cap, keeps or discards each candidate, and writes every program, output, candidate, measurement and Astra call to the experiment's folder. |
| Vault | Keeps the sealed examples. It opens them only after the candidate is frozen and Astra is released. It screens program output and every request to Astra for them. |

Neither worker process gets a key or a token, and neither can reach the network. The guard is inside the process; it is not an operating-system sandbox, so the runner re-checks everything a program hands back. Running the kernel in an OS sandbox comes before WSP leaves Experimental.

A candidate (`architect.wsp-candidate/1`) is a set of whole replacement tensors over the pinned base. It is not a LoRA adapter. Its id comes from the hash of its manifest, which records the base's digest, the parent candidate, the hash of the program that made it, and each tensor's shape, dtype, hash, changed elements and relative change.

## Compute

| Target | Status | Why |
| --- | --- | --- |
| This computer (CPU) | Supported | The kernel and the evaluator run here, set up from pinned packages (CPU torch, transformers, safetensors) |
| Hugging Face Jobs | Not supported | A job runs as one batch, and an experiment's worker has to answer the runner turn by turn |
| Slurm, Kubernetes, SkyPilot | Not supported | Architect writes cluster bundles but never submits them, and the worker has to answer the runner while it runs |

## What has been verified

- `packages/engine/test/wsp.test.ts`, 18 tests. Two of them need a worker environment (`WSP_TEST_PYTHON_ENV`) and run the real kernel: its guard refuses eight escape attempts and hands back a checked edit, and a program that runs too long is stopped. The other 16 run without Python and cover the scoring, the split, the vault, model folders (a tied head counted once), the verdicts, drafting, refusals, interruption, and a whole run on stand-in processes through freeze and qualification.
- A real experiment end to end on this computer, unbilled (`packages/engine/scripts/wsp-demo.ts`, Nov 3, record in `runs/wsp-demo-1`). It used the scripted stand-in mentor, not Astra. The setup:
  - Model: Qwen/Qwen3-0.6B at revision `c1899de2`, on the CPU.
  - Examples: 26 multi-step word problems with number checks, split into 10 practice, 8 dev and 8 sealed.
- What happened in that run:
  - The base passed 8 of 10 practice problems and 7 of 8 on dev. The decoding control also got 7 of 8 on dev, and the instruction control 5 of 8.
  - Program 1 read hidden states for the failing and passing outputs.
  - Program 2 removed the direction between them from 64 columns of the down projections in layers 9 to 18: 643,841 weights, 0.11% of the model. The edit passed every check and became candidate `wspc-5a6f12443289dd3877ec`.
  - The candidate scored 7 of 8 on dev, no gain over the base, so the runner discarded it. With no candidate kept, no qualification ran.
  - The run took 6 minutes, with 8 forward passes and $0.
- An earlier run removed the direction from whole matrices. That changed 26,756,603 weights, past the 1% cap, and the runner refused the edit.

## What isn't done

- No real Astra experiment has run. Running one costs money, and it waits on an approved spending limit.
- A candidate is measured in full precision with transformers on the CPU. No GGUF or quantized build is made or checked on a local runtime, so a candidate is never a local agent.
- Fine-tuning isn't compared inside an experiment: it learns from a field's verified lessons, which a WSP experiment doesn't have.
- Astra's reasoning effort is capped at high, the most the mentor adapter sends. The research used max.
