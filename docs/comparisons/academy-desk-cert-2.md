# Certified answers: Academy desk, second live run

Written on Nov 1, 2026 from the run's stored certification record and its attempts, recounted from the stored answer keys without reading any content. The plan was written before any attempt and kept in the run folder. The records stay outside the repository.

## What was asked

A certificate says how often a specialist is wrong when it answers, with stated confidence, and how much it hands to staff. How it is computed is in [docs/CERTIFY.md](../CERTIFY.md). The first live run ([academy-desk-cert-1.md](academy-desk-cert-1.md)) certified the third field run's Academy desk and issued none. This run asked for one on the frozen Academy desk from the first field run ([academy-desk-1.md](academy-desk-1.md)): 99 of 120 on its locked test, 43 of 48 at Harborview Prep. That is harness `8430022212bd`, with that run's frozen settings: temperature 0, top_p 1, top_k 64, 30 steps, 8,192 output tokens a turn and medium reasoning. Nothing was taught or tuned for it. The code was release 0.8.0, unchanged, with no patch.

## Setup

| | |
| --- | --- |
| Version | Academy desk from the first run, frozen as it was |
| Calibration | 60 tasks from the three taught academies (Ridgeline Test Prep, Wrenfield Prep, Lakemont Scholars) that the first run never touched: 22 assign, 20 diagnose and 18 history. `architect certify` set aside every task whose id, family (academy, student and topic) or wording the run used. That left 163, and the calibration drew 60 of them. |
| k | 5 attempts per task: seed 101, the run's locked-test seed, and 4 seeds drawn from it |
| ε | 0.10: at most 10% of answered requests wrong |
| δ | 0.05, so 95% confidence |
| Check | Harborview Prep, the academy the run never trained on, sealed in the vault. 54 tasks (17 diagnose, 19 history, 18 assign), every one whose student and topic the run's 48 Harborview test tasks never touched. |
| Student | Hosted Glimmer (`meta/muse-glimmer-30b` on OpenRouter). OpenRouter lists one provider for it, DeepInfra (bf16), the one the run used. |
| Mentor | None. Spark was not called. |
| Attempts | 570, one at a time: 300 for calibration and 270 for the check |

**Where the tasks came from.** cert-1's route isn't open for the first run. At that run's commit, the academy generator makes exactly 8 tasks of each skill per academy, and the run used all of them. The current generator builds other academies. So the tasks were built with the repository's record task builder (`record-tasks` in `examples/academy`). It makes tasks from an academy's records alone, and the run's own Real academy tasks were made the same way. It ran on the run's own academy files, byte for byte, as of the run's date (Nov 16, 2026), with one seed drawn once. For every built task, the reference answer, worked out with the agent's own tools, passed the run's own checker, and a wrong answer failed. No model was used for that check.

## Result: a certificate

The app's words:

> When Academy desk answers, it is wrong on at most 5% of requests like these, with 95% confidence. It handed 0% to a person.
> It answers when 1 of 5 attempts agree, measured on 60 calibration tasks.
> Harborview Prep: answered 53 of 54, 0 wrong. Held.

**The bound is 4.87%**, the one-sided 95% Clopper-Pearson upper bound on 0 wrong of 60 answered. **Coverage is 100%.** That is the lowest bound 60 tasks can give, so it reflects the size of the set, not a measured error rate. With no error at any threshold, the test reaches the loosest one: answer with the most common answer whenever any attempt gives one.

Risk and coverage on the 60 calibration tasks:

| Answers when | Answered | Wrong | Coverage | Handed off | Upper bound |
| --- | --- | --- | --- | --- | --- |
| 5 of 5 agree | 59 | 0 | 98% | 2% | 4.95% |
| 4 or more of 5 | 59 | 0 | 98% | 2% | 4.95% |
| 3 or more of 5 (2 and 1 give the same) | 60 | 0 | 100% | 0% | 4.87% |

The most common answer was right on all 60. 298 of the 300 attempts passed. The 2 that failed belonged to one assign task, ended with no answer and, under decision 099, did not count. That task's other 3 attempts agreed and were right. No calibration attempt gave a wrong answer.

## The check at Harborview Prep

**The bound held.** At the certified threshold, Academy desk answered 53 of the 54 tasks, got none wrong and handed one to staff. On its own, 0 of 53 has a 95% upper bound of 5.5%.

| Answers when | Answered | Wrong | Handed off |
| --- | --- | --- | --- |
| 5 of 5 agree | 48 | 0 | 6 |
| 4 or more of 5 | 50 | 0 | 4 |
| 3 or more of 5 | 51 | 0 | 3 |
| 2 or more of 5 | 52 | 0 | 2 |
| 1 or more of 5 | 53 | 0 | 1 |

Single attempts were less clean here than on calibration: 254 of 270 passed. Of the 16 that failed, 6 gave a wrong answer (4 on assign, 2 on diagnose), 9 ended with no answer and 1 ran out of steps. Taking the most common answer outvoted every wrong one. On one diagnose task, 2 attempts gave the same right answer and the 2 wrong ones disagreed with each other. The task handed off was an assign task on which all 5 attempts gave no answer.

## What it shows

On the requests it covers, the product's certificate works on a live model. It vouched for a version that was right when it answered, at the academies it was taught on, and the bound held at an academy it never trained on. The contrast with cert-1 is the version, not the method. The third run's Academy desk gave the same wrong answer five times out of five. This one gave a wrong answer in 6 of 570 attempts, never on calibration, and never as the most common answer.

Agreement did little work here. On calibration the chosen threshold accepts any real answer. At Harborview, stricter thresholds would only have handed off more tasks without catching any error. The certificate rests on the error count, and 60 tasks can't push the bound below 4.87%.

## Cost

- **The engine counted $1.28** for 570 attempts (3,050 calls, 11.96 M tokens in of which 11.07 M cached, 0.47 M out), under the run's $4.80 cap and the $5 limit set before it started. The CLI projected $1.81, and the plan's own projection, from the first run's measured attempts, was about $1.6.
- OpenRouter's credits rose by $8.88 between the readings before and after. Other work shared that account while this ran, and its per-model activity needs a management key, so this run's charge can't be separated there. In cert-1, on the same model and provider, OpenRouter's count was within 1% of the engine's. Priced with no cache discount at all, these tokens come to $4.16, still under $5.
- Spark: $0. No local model or GPU: Ollama's process list was empty before and after.
- 570 attempts in 1 h 36 min, one at a time.

## Limitations

- **Three of six skills.** The certificate covers diagnose (topic and right answer, without the error id), history and assign, as the record builder writes them. History and assign have the same form as the run's own tasks. This diagnose is the lighter form the run met only on the Real academy. Solve, hint and the tutoring turn can't be built from records and are not covered.
- **Generated academies only.** The taught academies and Harborview are all generated. The Real academy was not checked, because the run was already tested on its only snapshot. There this version passed 12 of 24, and its helpers broke on the real export ([academy-desk-1-real-academy-misses.md](academy-desk-1-real-academy-misses.md)). "Requests like these" means requests at academies like the generated ones.
- **Calibration from new pairs on known files.** The 60 tasks are new requests on files the version already knew. Leaving out every student and topic the run touched tilts the draw toward pairs the run never picked.
- **A bound set by the sample size.** With no errors, 60 tasks certify no lower than 4.87%. A tighter claim needs more tasks, not a better version.
- **One seed set, greedy decoding.** At temperature 0 the five attempts differ only through the provider's nondeterminism, as in cert-1.
- **Hosted, no pin.** Release 0.8.0's `--student` drops the run's provider pin, and no patch was used to keep it. The only provider listed was the one the run was pinned to, but the route wasn't forced. The local build of the graduate was not measured.
- **Spend seen only through the engine.** See Cost.
- **A copy of the first run's records.** The certificate is filed on a copy of that run's data folder in which only the graduate's display name was changed, from its old working name to Academy desk. The run's own records are untouched.
- **No traces.** Attempts keep only a salted answer key, so the misses are known by counts and stop reasons, not by what the agent did.
