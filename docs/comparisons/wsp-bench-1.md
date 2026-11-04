# wsp-bench-1: GPT-6 Astra repairs planted faults in a small model

Nov 4, 2026, on this computer's CPU, through Architect WSP's own runner (decision 109). The records are in `runs/wsp-bench-1`.

## The result

GPT-6 Astra repaired 6 of 7 damaged models, an 86% repair rate with a 95% Wilson interval of 49% to 97%. In all 7 it found and edited the tensor that held the fault. Across the 84 sealed examples, the 7 damaged models passed 13 (15%) and Astra's frozen candidates passed 81 (96%): a paired gain of 81 points, with a 95% interval of 70 to 88 (Newcombe). No sealed example a damaged model got right was lost.

| Fault | Planted in | Held-out accuracy, damaged | Sealed, damaged | Sealed, repaired | Weights changed | Damage left | Programs | Astra |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fault-01 | rank-1 spike, layer 0 attention output | 8% | 1 of 12 | 12 of 12 | 4,096 of 4,096 | 6.4% | 4 | $0.47 |
| fault-02 | one row ×, layer 0 MLP down projection | 1% | 0 of 12 | 12 of 12 | 128 of 8,192 | 2.5% | 4 | $0.46 |
| fault-03 | rank-1 spike, layer 1 attention output | 30% | 1 of 12 | 12 of 12 | 4,096 of 4,096 | 8.6% | 3 | $0.40 |
| fault-04 | one row ×, layer 1 attention output | 9.5% | 1 of 12 | 12 of 12 | 64 of 4,096 | 2.1% | 2 | $0.21 |
| fault-05 | rank-1 spike, layer 0 attention output | 21.5% | 6 of 12 | 9 of 12 | 1,024 of 4,096 | 53.5% | 4 | $0.55 |
| fault-06 | one row ×, layer 0 attention output | 0% | 0 of 12 | 12 of 12 | 64 of 4,096 | 3.2% | 2 | $0.25 |
| fault-07 | rank-1 spike, layer 0 attention output | 15.5% | 4 of 12 | 12 of 12 | 4,096 of 4,096 | 8.0% | 4 | $0.43 |
| fault-08 | one row ×, layer 0 MLP down projection | 1% | not run | | | | | |

"Repaired" means the frozen candidate passed at least 11 of the 12 sealed examples. "Damage left" is the distance from the candidate's tensor to the healthy one, over the distance from the damaged tensor to the healthy one. It is measured against the healthy checkpoint, which Astra never saw. fault-08 wasn't attempted: the run's $3.60 had $0.83 left, less than one call to Astra can cost at its worst.

## Against a simple rule

The same eight copies went through the same runner with no model at all: one scripted program, an outlier rule. For every matrix it finds how far the top singular value stands above the next one and how far the longest row stands above the median, takes the most extreme of these, and either shrinks that singular value to the next one or rescales that row to the median. It repaired **8 of 8** (95% interval 68% to 100%), for $0 and about 13 seconds each, with sealed accuracy from 13 of 96 to 95 of 96.

| | Astra | Outlier rule |
| --- | --- | --- |
| Repaired | 6 of 7 | 8 of 8 |
| On the 7 both tried | 6 | 7 |
| Repaired by one and not the other | none | fault-05 |
| Told what kind of fault to look for | no | yes: the rule was written for these two kinds |
| Cost | $2.77 | $0 |

So on these faults a rule written for them does at least as well as Astra. The difference between the two is not established with 7 faults, and the comparison is lopsided: the rule knew the two fault families in advance, while Astra was told only that some weights were damaged. The benchmark shows that Astra finds and repairs weight damage from the weights alone; it doesn't show that it beats a rule made for the damage.

The rule's first run found a kernel bug. For a float32 base, the kernel handed a program the memory-mapped tensor itself, so an edit in place (`W[i] *= ...`) also changed the tensor it was checked against, and the edit was refused as changing nothing. The rule's four row fixes failed that way; Astra's programs built new tensors and never met it. The base files on disk were unchanged (each matched its pinned hash). The kernel now hands programs a copy, a test that edits a row in place covers it, and the rule's results above are from the run after the fix. The run with the bug is kept in `runs/wsp-bench-1/heuristic-aliasing-bug`.

## How it was run

- **The model.** A Llama-architecture language model with 2 layers, a width of 64 and about 85,000 weights, trained on this CPU for 4,000 steps to reverse strings of six letters (`abcdef=` → `fedcba`). On 200 held-out strings it is right on all of them. `examples/wsp-bench/make_bench.py` makes it, seeded.
- **The faults.** Eight damaged copies, each with one fault in one tensor, kept only if it cuts held-out accuracy by at least 40 points. "Spike" adds a rank-1 matrix 4 to 8 times the tensor's spectral norm to an attention output or MLP down projection. "Row" multiplies one output row by 25 to 60, either sign. Where each fault is, and the healthy checkpoint, stay with the benchmark for scoring and never reach Astra.
- **The experiment.** For each copy, the runner made one WSP experiment with the same goal: the model was trained to reverse strings, some weights were damaged, find and repair the damage. It had 40 examples checked by exact match, split by seed into 16 practice, 12 dev and 12 sealed. The limits were 6 programs, 20 forward passes, 25 minutes, at most 10% of the weights changed, and medium reasoning effort. Each experiment's mentor cap was $1.50 or what was left of the $3.60, whichever was less. The runner did the rest as in the app: Astra's brief, the base and a decoding control on dev, Astra's programs in the guarded kernel, a candidate kept only for a dev gain, the freeze, and then the sealed qualification of the base, the control and the candidate. `packages/engine/scripts/wsp-bench.ts` runs it.
- **Spend.** $2.77 for the 7 experiments, $0.21 to $0.55 each. With an earlier, stopped run (below), the benchmark cost $3.37, and Architect WSP's real runs that night $4.44 in all, under the owner's $5.

## An earlier run, stopped

The first attempt gave each experiment $1. Before each call the runner charges the most that call could cost, about $1 once the context grew, so most experiments stopped after two programs without an edit. One of them, on fault-04, still repaired it, 0 of 12 to 12 of 12 with 64 weights. The runner also wiped the reason an investigation ended; that was fixed (it is kept now), and the run was restarted at $1.50. The stopped run's process didn't end when it was told to, and it ran beside the restart for a few minutes. It was killed, and its five experiments, one of them cut off partway, are left out of the table above. Its records are in the same folder, each named with its fault.

## What this shows, and what it doesn't

- It shows that, through Architect WSP's runner and its guard, Astra can read a small model's weights, find a planted fault from the tensors' statistics alone, and write a targeted repair the runner then verifies on examples it never saw. The repairs come close to the healthy weights, and the row repairs touch only the damaged row.
- The faults are planted and made to be found: a spike or a scaled row stands out in a tensor's norms, and a rule written for them repairs all eight (above).
- One small model, one task, one seed, 7 faults. The interval on the repair rate is wide (49% to 97%).
- This is repair of damage, as in the research's own fixes. It is not evidence that a new skill can be written into a model, or that the same works on a large model or on Architect's own jobs. The two Qwen3-0.6B runs on word problems found no localized defect and made no edit (`docs/WSP.md`).
