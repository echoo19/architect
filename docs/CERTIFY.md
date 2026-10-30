# Certified specialists and counterexample-guided repair: the plan

Adopted on Oct 31 after research (prior art below) and a GPT-6 Astra reading, at the owner's ask for a technical centerpiece. Two pieces, one headline.

## 1. Certified answers (the headline)

A specialist should know when not to answer. At qualification Architect calibrates when the graduate answers and when it hands the request to a person, and states a certificate a buyer can read:

> When Tutor answers, it is wrong on at most 8% of requests like these, with 95% confidence. It handed 22% to staff.

**How.**
- *Signal.* Agreement across k independent attempts at the same request (k = 5 by default): the share of attempts whose structured answer and file changes match the most common one. It works on every backend (hosted, Ollama, llama.cpp) and needs no log-probabilities. The graduate answers with the majority answer when agreement reaches its threshold and abstains otherwise.
- *Calibration set.* A new sealed split drawn from the taught organizations, disjoint from train, dev and the locked test, held in the vault like the test (invariant 1: the mentor never sees it). It is opened once, after the candidate is frozen.
- *Threshold and bound.* For each candidate threshold from strictest to loosest, the selective error among answered calibration tasks is tested with a one-sided Clopper-Pearson upper bound at δ; fixed-sequence testing picks the loosest threshold whose bound is at most the target ε (Learn-then-Test; no multiplicity penalty). If none qualifies, no certificate is issued and the report says why and how many more tasks would be needed.
- *Checked where it wasn't calibrated.* The same frozen graduate and threshold run on the locked test and on each never-seen organization; the report shows whether the certified bound held there. The guarantee assumes requests like the calibration ones; a never-seen organization tests that assumption rather than inheriting the guarantee.
- *Honesty.* The certificate always states n, k, δ, ε, coverage and its assumption, and a small calibration set yields a wide bound shown as wide. No certificate is claimed from development data.

**Where it shows.** Qualification and the report (the certificate, the risk-coverage curve, the held / not held line on never-seen organizations); the workspace (an abstained answer says it is unsure and hands off, with the attempts' disagreement inspectable); Models (the certificate per version); the Lab (certificates of recent graduates). The personal edition shows the certificate on its report and the hand-off in chat, in plain words.

**Cost.** k attempts per calibration and test request. It is a setting (k, ε, δ, calibration size) in the inspector's Evaluation tab, with the cost shown before a run.

## 2. Counterexample-guided repair (second)

When a tool Spark wrote gives a wrong or missing result on practice data, Architect turns the failure into a minimal executable counterexample, Spark repairs the tool against it, and the counterexample joins the field's permanent regression suite.

**How.**
- Scope: mentor-written tools (helpers) only, on train material, after faithful replay of the failing attempt.
- Reduction: dependency-aware delta debugging over the tool's input tables (rows, then columns), keeping referenced entities consistent, re-executing the tool in the sandbox on each candidate and keeping a candidate only if the same failure predicate still holds (the tool's output disagrees with the reference the checker uses, or it throws the same error). Never fabricate tool output. Called "1-minimal" only when every remaining unit was tried; "reduced" otherwise.
- Reproducer: the tool, its arguments, the reduced tables, the predicate and hashes, stored with the lesson.
- Repair: Spark receives the reproducer; the repaired tool must pass the reduced case, the original case and every earlier counterexample of the field; then the usual keep or revert on dev decides.
- Shown in the round's drawer and in Fields → Assets ("Counterexamples"), original size → reduced size → repaired.

**Not claimed.** It establishes a reproducible tool defect, not the cause of a model's reasoning failure. Retired locked-test failures are never fed back into teaching.

## Prior art (from the research pass)

Conformal risk control (arXiv 2208.02814), Learn-then-Test (2110.01052), conformal language modeling (2306.10193), conformal abstention (2405.01563); semantic entropy (Nature 2024) for agreement signals; delta debugging (Zeller and Hildebrandt 2002) and its uses with LLM systems. What is new here is the pipeline: certificates per graduate measured with a deterministic checker on sealed sets the teacher never saw, then checked on organizations it never saw, in a product.

## Lanes

| Lane | Branch | Owns |
| --- | --- | --- |
| Certified answers | `certify/answers` | the statistics module, the calibration split in the vault, k-attempt agreement and abstention in the runner and the graduate, the certificate in qualification, report, workspace, Models and Lab, settings in the inspector |
| Counterexamples | `certify/counterexamples` | reduction, reproducers, repair against them, the regression suite, the drawer and Assets views |
