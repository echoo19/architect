# Certified answers: Academy desk, first live run

Written on Oct 31, 2026 from the run's stored certification record and its attempts, recounted from the stored answer keys without reading any content. The plan was written before any attempt and kept in the run folder. The records stay outside the repository. The Real academy is anonymized, and its records are not published.

## What was asked

A certificate says how often a specialist is wrong when it answers, with stated confidence, and how much it hands to staff. How it is computed is in [docs/CERTIFY.md](../CERTIFY.md). This run asked for one on the frozen Academy desk from the third field run ([academy-desk-3.md](academy-desk-3.md)), harness `38c5250c3d6b`, with that run's frozen settings: temperature 0, top_p 1, top_k 1, 30 steps, 8,192 output tokens a turn and high reasoning. Nothing was taught or tuned for it.

## Setup

| | |
| --- | --- |
| Version | Academy desk from the third run, frozen as it was |
| Calibration | 60 tasks from the three taught academies (Copperfield Learning, Thistlewood Learning, Bramble Hill Academy) that the third run never touched. `architect certify` set aside every task the run saw or was tested on, by id, by family and by wording. That left 75, and the calibration drew 60 of them. |
| k | 5 attempts per task: seed 101, the run's locked-test seed, and 4 seeds drawn from it |
| ε | 0.10: at most 10% of answered requests wrong |
| δ | 0.05, so 95% confidence |
| Check | The Real academy's first snapshot (attempts from Oct 3 to 29, 2026), sealed in the vault as an organization the version never saw. 10 tasks, 5 diagnose and 5 history, built as of Oct 30. Its drafted policy is the one the third run's Real academy used. Assign was left out, as planned, because that policy gives no id format for an empty `assignments.csv`, and in the third run no arm could pass those tasks. |
| Student | Hosted Glimmer (`meta/muse-glimmer-30b` on OpenRouter), pinned to DeepInfra with no fallback |
| Mentor | None. Spark was not called. |
| Attempts | 350, one at a time: 300 for calibration and 50 for the check |

## Result: no certificate

The app's words: "Not certified (error rate)." At every agreement threshold, the share of answered calibration tasks that were wrong is far above the 10% target. More calibration tasks would not change that, so the report names no number that would.

Risk and coverage on the 60 calibration tasks. The bound is the one-sided 95% Clopper-Pearson upper bound on the share wrong among answered tasks, rounded up to a tenth.

| Answers when | Answered | Wrong | Coverage | Handed off | Upper bound |
| --- | --- | --- | --- | --- | --- |
| 5 of 5 agree | 46 | 14 | 77% | 23% | 43.5% |
| 4 or more of 5 | 52 | 16 | 87% | 13% | 43.0% |
| 3 or more of 5 (2 and 1 give the same) | 60 | 21 | 100% | 0% | 46.4% |

The most common answer was right on 39 of the 60 tasks. At 5 of 5, by skill (answered, wrong, of the skill's tasks):

| Skill | Answered | Wrong | Tasks |
| --- | --- | --- | --- |
| Solve | 15 | 0 | 15 |
| Diagnose | 3 | 0 | 7 |
| Hint | 5 | 1 | 9 |
| Assign | 7 | 3 | 11 |
| History | 9 | 3 | 9 |
| Tutoring turn | 7 | 7 | 9 |

Of the 14 wrong answers at 5 of 5, 11 were the same wrong answer given five times. The other 3 were tasks where all five attempts ran out of steps (see "The flaw this run found").

## The check on the Real academy

No bound was certified, so there is nothing to hold or break there. Read at the same thresholds anyway:

| Answers when | Answered | Wrong | Handed off |
| --- | --- | --- | --- |
| 5 of 5 agree | 8 | 8 | 2 |
| 4 or more of 5 | 9 | 9 | 1 |
| 3 or more of 5 | 10 | 10 | 0 |

It got 0 of 10 right. On every history task, all five attempts hit the 30-step limit (25 of 25 attempts). The third run saw the same thing: this version ran out of steps on every Real academy history task there too. On diagnose, 6 of 25 attempts hit the step limit, and 3 tasks gave the same wrong answer five times.

## What it shows

The certificate refused to vouch for a model that was confidently wrong, which is the point of certifying. On the tutoring turn Academy desk answered 7 of 9 tasks with all five attempts in agreement, and all 7 were wrong. On solve, the same agreement was right 15 times out of 15. At temperature 0 with top_k 1, the five attempts differ only through the provider's own nondeterminism, so a wrong answer repeats as reliably as a right one, and agreement says little about which is which.

## The flaw this run found

A task whose five attempts all ran out of steps counted as five agreeing "no answer" results. The agreed result was then graded wrong, where it should have been handed to staff. That made all 5 Real academy history results and 3 of the 14 calibration errors. It was fixed after this run, in decision 099: five "no answer" outcomes no longer count as agreement. This run's numbers stand as measured. The other 11 calibration errors at 5 of 5 were real answers, the same wrong one five times, and those alone are far above a 10% target.

## Cost

- **OpenRouter: $4.42**, by the credits endpoint. The engine's own count was $4.45, under the run's $4.90 cap and the $5 limit set before it started.
- The CLI projected $1.11, from its rough per-attempt estimate, which is too low for this version. The plan's own projection, from the third run's measured attempts, was about $4.4.
- Spark: $0. No local GPU: Ollama's process list was empty before and after.
- 350 attempts in 4 h 14 min, one at a time.

## Limitations

- **Hosted, not local.** The student was hosted Glimmer. Keeping the third run's provider pin took one in-memory patch to the runner; no repository file changed. The local build of the graduate was not measured.
- **Calibration from generated academies.** The 60 tasks are new tasks on files the version already knew, so "requests like these" means requests at those three academies.
- **A drafted policy and a small check.** The Real academy's policy was drafted for these tests, not written by the academy, and awaits its confirmation. One row was renamed so the current task builder could read it, which made it the same draft the third run used. The check had 10 tasks, and history may be unanswerable for this version (see [academy-desk-3-misses.md](academy-desk-3-misses.md)).
- **One seed set, near-greedy decoding.** Five attempts per task under one set of seeds, at temperature 0 and top_k 1, makes agreement a weak signal for this version.
- **A cut-off counted as an answer**, as described above, fixed after this run.
- **A copy of the third run's records.** The certificate is filed on a copy of the third run's data folder in which only the graduate's display name was changed. The third run's own records are untouched.
- **No traces.** Attempts keep only a salted answer key, so the misses are known by counts and stop reasons, not by what the agent did.
