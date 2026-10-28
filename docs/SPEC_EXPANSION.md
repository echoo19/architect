# Architect Expanded Implementation Specification

**Owner:** Jake Kang  
**Date:** October 28, 2026  
**Audience:** The Claude Code session already implementing Architect  
**Status:** Approved product direction; implement incrementally against the existing repository  
**Build horizon:** One focused week, subject to the model and training feasibility gate

## 1. Read this first

Continue the existing Architect implementation. Do not restart the project, replace working infrastructure, or interpret this document as a request for a new application. Inspect repository instructions, current code, tests, and the active implementation plan before making changes. Map the requirements below to existing components, identify what is already complete, and extend those components.

This is a self-contained companion to **Architect_Updated_Spec(2).docx**, dated October 23, 2026. It incorporates the subsequent decisions about precise mentoring, user-directed teaching, visible learning, portable graduates, CLI execution, and Hugging Face publishing. Where they conflict, this document governs the new scope and settled decisions; preserve the original specification's evaluation, permission, budget, and honest-reporting requirements.

The task is to implement the features, not just produce another plan. Keep a concise requirement checklist with links to implementation and validation evidence. Resolve routine implementation choices from the repository and this specification. Ask the owner only when a missing decision materially blocks work or would change the intended product.

All week-one requirements are intended work. The priority order determines sequencing and, if necessary, an explicitly reported scope reduction. It does not authorize silently omitting lower-priority features or marking unfinished work complete.

## 2. Product identity and settled decisions

Architect turns a natural-language job description into a specialized personal agent. Muse Spark mentors Muse Glimmer through verified teaching examples and bounded improvements to its harness. The graduate consists of the adapted model plus the instructions, tools, procedures, and configuration needed to do the job.

The default experience is straightforward: a person creates, trains, and uses a specialist on the same PC. Training may use explicitly configured remote compute when necessary, but normal graduate inference runs locally without Spark. Optimize this path first. Exporting to another machine is an optional capability, not a prerequisite for using a graduate.

**Pi is already the base agent harness for every graduate.** Preserve the current integration and pinned compatible version. Do not run a new harness selection exercise, replace Pi, or build a second execution loop for the CLI. The earlier mention of connecting to a Pi meant a **Raspberry Pi device**, not introducing the Pi agent harness.

Architect should become better at deciding what to teach, proving that learning helped, and delivering a useful specialist that the user can keep. Sharing and terminal execution extend that same product. They must not introduce separate agent implementations.

### Core user journey

1. Describe a job and provide representative inputs, preferences, and allowed resources.
2. Review the proposed job, boundaries, success criteria, hardware fit, and mentoring budget.
3. Watch an apprenticeship grounded in actual attempts and verified interventions.
4. Graduate when the locked requirements are met, or retain a clearly labeled experimental result.
5. Use the saved agent immediately in Architect on the current PC.
6. Correct it with **Teach this**, then explicitly create and evaluate an improved version.
7. Optionally run the same graduate from a terminal, export it, or publish it to Hugging Face.

## 3. Scope and priorities

| Priority | Week-one requirement | Completion evidence |
| --- | --- | --- |
| P0 | Working local student, real adapter training/loading, independent evaluation | A real candidate loads and executes the job on the deployment configuration |
| P1 | Failure-specific teaching with replay and verified corrections | A diagnosed failure produces a verified lesson and a measured candidate result |
| P1 | Bounded selection between retrieval, procedure, helper, and weight interventions | Structured intervention decisions, separate initial measurements, and retained/rejected outcomes |
| P1 | Evidence-based apprenticeship UI | Actual attempts, interventions, capability results, regressions, cost, and status |
| P1 | Teach this and versioned improvement | A user correction enters a teaching queue and produces a candidate without silently changing the active graduate |
| P2 | Portable package and import on a supported PC | Export/import round trip, local resource rebinding, compatibility checks, and smoke tests |
| P2 | CLI using the same runtime | Interactive and JSON task execution without launching the desktop UI |
| P2 | Hugging Face publish/install | A reviewed package is uploaded and can be installed from an immutable repository revision |
| P2 | Demonstration and comparisons | Held-out report, offline run, restart/rollback, and truthful comparison artifacts |

Week one supports one model family/configuration, one training recipe, one task family, one inference backend, and the operating-system/hardware combination already targeted by the project. Reuse working abstractions; introduce new ones only where these features need a shared boundary.

**Deferred:** Raspberry Pi support, arbitrary hardware conversion, training a smaller alternative student, a model marketplace, multi-agent teams, broad connector support, unrestricted generated tools, automatic continuous training, open-ended architecture/hyperparameter search, and fully offline bundles that redistribute base weights. Do not implement these as hidden prerequisites.

## 4. Preserve the foundational contract

The setup conversation produces a versioned job contract: supported tasks, inputs and outputs, tool permissions, logical resource bindings, training-data permissions, independent evaluation rules, success thresholds, device limits, and budget caps. Explain this to the user in ordinary language.

The runner owns data splits, checks, tool isolation, budget accounting, and final-test access. Spark proposes diagnoses and interventions; it cannot redefine success, change the base-model revision, grant permissions, inspect held-out answers, or bypass the runner. Generated examples must be checked before training.

An agent is ready only when the selected frozen candidate passes the predefined requirements on the target configuration. Partial results remain usable only with an explicit experimental/not-ready status. Never lower thresholds after observing a failure.

Normal conversations neither update weights nor send local content to Spark. Remote training and mentor calls disclose and obey the data-sharing settings. Preserve the previous graduate when creating any candidate. Sessions remain separate from distributable graduate artifacts, and installed agents share compatible base weights through the existing cache.

## 5. A meaningful, bounded demonstration task

Preserve the task family already implemented if it provides deterministic checks and meaningful baseline failures. Do not switch domains merely to match an example in this document.

If the family remains undecided, use a **local operations analyst** over registration, attendance, and workshop records. It reconciles records, answers natural-language questions, and produces a report with supporting records. This extends the original dataset-query demo while keeping one bounded task family.

Useful challenges include duplicate records, joins using stable IDs, registration versus actual attendance, date boundaries, missing values, inconsistent labels, and unsupported or ambiguous requests. Source data stays read-only; a report may be written only to an approved output destination. Any export permission is part of the job contract.

Run the baseline before locking the task selection. Choose realistic difficulties where the student makes recurring, learnable mistakes. Do not manufacture an artificially weak baseline or expand into invoices, browser automation, and coding as additional supported domains.

Keep business facts and changing records in data/retrieval. Teach the model how to interpret requests, use tools, check results, and recover. Success should transfer to fresh records rather than depend on memorizing the demonstration dataset.

## 6. Failure-specific mentoring

### Capture observable attempts

Record the task, model/harness versions, relevant inputs, tool calls and results, final output, checker findings, elapsed time, and resource usage. Capture externally observable actions and evidence; do not require access to hidden chain-of-thought.

Identify replay points between tool interactions. In week one, replay uses read-only inputs or resettable fixtures. Record the input snapshot or content hashes and any necessary tool state. Reconstructing conversation history alone is insufficient if the environment has changed. Never replay a live side effect to obtain a training trace.

### Diagnose and verify a correction

For each selected failure, Spark proposes:

- The suspected decision or missing information that caused the failure.
- Evidence from the observable trace, with references to relevant steps.
- The expected effect of a proposed correction.
- One intervention type from the bounded menu in Section 7.

The identified failure point is a hypothesis, not proven causality. For a behavioral lesson, resume from the saved state and ask Spark for a corrected continuation. Execute that continuation through the same permitted tools and verify the outcome with the independent checker. Reject invalid, unauthorized, or unverifiable corrections.

Train on verified target actions/responses and successful continuations. Do not accidentally label the student's incorrect actions as desired outputs. Produce related practice cases that vary the underlying records, wording, and relevant conditions, then independently validate their labels. Keep a small set of earlier verified examples in each update to reduce forgetting.

If reliable replay is impossible, label the correction as a full-task demonstration. Do not display it as an exact-state repair.

### Example lesson

A student counts workshop registrations as attendance. Spark identifies that it queried registration records without checking the attendance source. A verified continuation selects check-in records, joins by stable ID, and handles duplicate check-ins. Practice cases exercise that distinction across different records. Development evaluation tests transfer on withheld scenarios.

### Bound the curriculum

Group recurring failures into a few explicit categories. Select examples using simple severity/frequency counts and fixed per-category caps; avoid building a new learned curriculum scheduler. Deduplicate related examples, cover multiple failure types, and stop spending on a category when progress plateaus.

Use the existing reliable LoRA recipe. Keep training settings constrained, aggregate verified lessons into batches, and log example counts and compute. Do not retrain after every single message or correction.

## 7. Choose the appropriate intervention

| Failure hypothesis | Candidate intervention | Required verification |
| --- | --- | --- |
| Required facts or schema information are missing | Improve retrieval or provide a relevant source | Correct source selection, access boundaries, and task outcome |
| A workflow omits a necessary check | Revise instructions or a bounded procedure | Development success and regressions with weights unchanged |
| A repeatable deterministic operation is unreliable | Add or adjust a small helper | Direct helper tests, bounded inputs/outputs, no new permissions, and end-to-end evaluation |
| The student repeatedly misinterprets requests or chooses wrong actions | Train on targeted verified lessons | Candidate adapter evaluation with the comparison harness fixed |
| The request or user preference is ambiguous | Ask one focused clarification | Capture the confirmed interpretation before creating labels |

Spark returns a structured proposal containing the hypothesis, category, affected capability, proposed change, expected effect, estimated cost, and verification plan. The runner validates it against allowed changes and remaining budgets.

Prefer an inexpensive, evidence-appropriate intervention first, but do not enforce a universal rule that prompts always precede training. For selected important failures, compare a bounded harness candidate with a training candidate if the budget permits. Do not fork every failure into a large experiment tree.

Measure harness and adapter changes separately initially. A combined candidate may be selected after the individual effects are recorded, but it must be evaluated again because their interaction may cause regressions.

Helper generation is limited to the supported task family and the existing sandbox/tool mechanism. A helper must have a narrow typed interface, deterministic checks, resource limits, and no authority to request additional access. Do not build a general plugin marketplace or unrestricted code-generation framework. If safe execution cannot be supported, use preapproved helper templates and report that boundary.

Retain a candidate only when it meets the locked selection criteria and regression/device limits. Reject or revert harmful candidates. Track the actual reason for rejection. Improvements in accuracy do not excuse violating hard memory or permission constraints.

## 8. Teach this and controlled further learning

Add **Teach this** to relevant assistant outputs or task results. The user can describe what was wrong, provide the desired behavior or a corrected result, and optionally identify supporting evidence.

Architect shows the proposed lesson before committing it to the teaching queue. Classify the correction as an explicit preference/procedure, missing fact/source, behavioral weakness, ambiguous request, or invalid/unverifiable correction. Do not assume every correction requires a weight update.

Examples:

- “When I say attendance, use people who checked in” may become an explicit task definition.
- “This file contains the current membership list” changes a resource binding or retrieval source.
- Repeated failure to choose the right join despite clear instructions may justify targeted training.

An accepted instruction change can take effect through a recorded harness-only version without retraining. Keep the previous version available and mark evaluation status accurately. A change to success criteria or supported scope creates a new job-contract version; it cannot silently inherit the old graduation result.

**Improve agent** processes the queued lessons within a displayed budget. It constructs verified practice cases, performs the relevant intervention, runs regression/development checks, and creates a candidate. Show what improved, what did not, and whether promotion is allowed. The user can keep using the current graduate while a candidate trains if the hardware permits; otherwise explain the resource conflict and queue the work.

No automatic model update from ordinary chats. No silent mentor upload. User corrections are training inputs after acceptance, not hidden-test material. Repeated improvement cycles need an explicit held-out evaluation policy: use reserved fresh scenarios for new graduation runs and never reuse disclosed final-test feedback as training guidance for the same reported test.

## 9. Evidence-based apprenticeship interface

Extend the existing UI rather than introducing a separate experiment application. Required surfaces remain setup/job review, apprenticeship, capability report, and the saved-agent workspace.

For each lesson or experiment, show:

- The diagnosed weakness and the actual supporting attempt.
- Spark's short hypothesis and proposed intervention.
- A real corrected trace or before/after comparison when available.
- The development cases exercised, successes, failures, and sample counts.
- Regression outcomes, latency/memory changes, and resources spent.
- Whether the candidate was retained, rejected, invalid, or stopped.

Add a capability breakdown using categories from the supported task family. Distinguish training, development, locked evaluation, and installation checks visually and in the underlying records. Never present training accuracy or an import smoke test as held-out capability evidence.

Support trace playback or step-by-step inspection with corresponding tool evidence. Display useful concise explanations rather than raw internal configuration in the default experience; technical details may be expandable.

Every displayed result must derive from stored execution records. Show failed experiments and plateau/budget stops honestly. Do not fabricate progress percentages, learning gains, confidence scores, or live activity during prerecorded training.

## 10. One graduate package and one runtime

The portable graduate is the canonical immutable versioned artifact used by the desktop app, CLI, export/import, and Hub sharing. Adapt the existing saved-agent contract instead of creating an unrelated distribution format.

Use a normal directory representation plus a ZIP-based transport archive, for example `name.architect.zip`. The extension is a product convention, not a new compression format. A small versioned JSON manifest describes the package. Keep base-model caches, chats, credentials, temporary training files, and machine-specific configuration outside it.

| Package element | Required content |
| --- | --- |
| Identity | Package schema version, agent identity, graduate version, parent version, and creation metadata |
| Job contract | Capabilities, inputs/outputs, boundaries, and acceptance contract version |
| Model | Exact base repository/revision, adapter format/path/hash, inference configuration, and compatible runtime |
| Harness | Pinned Pi compatibility, instructions, procedures, selected tools, helper files, and dependency lock information |
| Resources | Logical resource names, required/optional status, accepted types, and requested access |
| Requirements | Tested OS/architecture/backend, measured resource usage, estimated minimum needs, and limitations |
| Evidence | Evaluation summary, configuration and dataset identifiers, counts, metrics, provenance, and experimental/ready status |
| Verification | Small non-sensitive fixtures and installation smoke checks, separate from private locked tests |
| Integrity and terms | File checksums, licensing notices, base/adapter usage requirements, and selected resource provenance |

Support adapter-only distribution first: include adapter weights/configuration and an immutable reference to the base. Reuse or download the exact base as necessary. Preserve standard model artifacts so they remain understandable outside Architect; the complete specialist additionally requires its harness.

Do not automatically merge, quantize, convert, or switch the model during export/import. Such changes can alter behavior and require their own compatibility checks and evaluation. An adapter is tied to its compatible base architecture and revision, not interchangeable with a smaller model.

Checksums detect corruption; they do not prove publisher trust. Installation must validate the package before loading code. Reject path traversal, unsafe archive links, missing/modified required files, unsupported schema versions, and unresolved dependencies. Apply extraction size limits. Do not execute imported helpers or arbitrary install scripts just to inspect a package.

Export local-first. A prepared export is not permission to publish it publicly. Use a file inclusion review that excludes secrets, chats, private datasets, local paths, and raw training traces by default. Include only selected shareable resources and sanitized evidence. Explain in the sharing flow that trained weights may retain information from training data; excluding source files does not guarantee anonymity.

## 11. Import and adaptation to the destination PC

Import is a short setup workflow, not automatic full retraining:

1. Read and validate the manifest and integrity metadata without executing package code.
2. Check the destination OS/architecture/backend and available resources against the package's supported configuration.
3. Reuse the exact base-model cache or explain the required download size and access requirements before downloading.
4. Resolve declared dependencies through the existing trusted installation path. Fail clearly on unsupported combinations.
5. Ask the user to bind logical resources such as `attendance_data` and `report_output` to their own locations.
6. Review requested tools, network access, and writes; store destination permissions locally. A package's requested access is not a permission grant.
7. Load the exact graduate and run its portable installation checks and basic resource measurements.
8. Mark installation ready, blocked, or requiring attention, with actionable reasons.

Use logical bindings throughout the harness. Do not hard-code the author's absolute directories, account names, API keys, or external service IDs. Rebinding data changes the data source, not the learned adapter.

Keep original evaluation provenance visible: “Evaluated on the author's configuration” differs from “Installation checks passed on this computer.” A short check does not recreate the original benchmark or certify unfamiliar data. Report destination resource measurements separately. A recipient may explicitly run a broader evaluation later if suitable shareable data is available.

The same-PC path should reuse existing bindings, approvals, model cache, and installed dependencies wherever valid. Do not force export or repeat setup to use a newly graduated local agent.

Imported graduates may be taught further through the normal candidate workflow. Record the imported version as their parent and never overwrite the publisher's artifact or assume access to private training data.

## 12. Terminal execution

Implement a small CLI over the same package loader, Pi-based execution service, inference backend, resource bindings, permissions, and event stream as the desktop app. It must run without opening the desktop UI. It must not silently route to Spark or a cloud inference fallback.

The following is the intended command surface; adapt naming to an existing CLI if one exists while retaining these capabilities:

```bash
architect list
architect install ./workshop-analyst.architect.zip
architect install hf://owner/workshop-analyst --revision <commit>
architect run workshop-analyst
architect run workshop-analyst --input request.json --output result.json --non-interactive
architect inspect workshop-analyst
architect verify workshop-analyst
architect export workshop-analyst --output ./workshop-analyst.architect.zip
architect publish workshop-analyst --repo owner/workshop-analyst --private
```

`run` starts an interactive session when no batch input is provided. Batch input contains the task and supported input references, validated against the job contract and local access rules. Batch output is a versioned JSON result with status, answer or structured task output, references/artifacts, graduate version, and any error. Keep logs/progress on stderr so stdout remains machine-readable when used for JSON. Reject malformed input before execution.

Use stable documented exit codes: zero for successful execution, nonzero for invalid input, unmet requirements/permissions, task failure, or runtime errors. Exact code values may follow existing project conventions. In noninteractive mode, an action needing ungranted approval must return a structured approval-required failure rather than hanging or silently approving.

Persist sessions through the existing store when requested. Preserve cancellation and step/resource limits. A `verify` result describes installation checks; it is not a new graduation report.

## 13. Hugging Face publishing and installation

Treat Hugging Face as a distribution destination for the same package contents. Reuse its standard repository/upload mechanisms and standard adapter artifacts. Do not build a marketplace or duplicate Hub infrastructure.

The publish flow stages a reviewable export, scans for obvious secrets/private paths, lets the user select repository and visibility, and shows the final included files. Default new repositories to private. Publish only after explicit action with the chosen visibility; never widen an existing repository's visibility as a side effect. A secret scan is a best-effort check, not proof that weights or files contain no sensitive information.

Use the standard local authentication mechanism; never put tokens into packages, model cards, logs, or command examples. Respect gated-model access and recorded redistribution restrictions. Upload the adapter, portable harness/manifest, non-sensitive checks, and generated model card. Include licenses/attribution where applicable.

The generated model card explains the job, base model and pinned revision, adapter format, runtime/harness requirements, training method, evaluation distribution and counts, tested device, results/limitations, intended data access, and exact install/run commands. Do not invent benchmark results or claim unsupported hardware. Clearly state that uploading to the Hub does not by itself make the entire agent runnable through hosted inference services.

Record the successful repository URL and immutable commit/revision. Installation resolves an explicitly supplied revision, or resolves the current revision once and records its immutable commit. Never silently update an installed graduate when a remote branch changes. Failed or incomplete publication must not be shown as a shareable completed release. Retrying should preserve the intended version and avoid duplicate local graduate records.

## 14. Raspberry Pi and other hardware

Raspberry Pi is a future target, not a week-one requirement. Portability means a graduate can move to compatible environments; it does not guarantee that a large model fits or runs acceptably on every device.

The initial implementation should detect and explain unsupported device/runtime combinations without attempting automatic conversion or claiming support. Running on a smaller device may later require a separately selected student, an appropriate backend, new training, and evaluation on that device. Preserve requirements metadata so this can be added later without redesigning packages.

## 15. Minimal implementation architecture

Retain the current desktop stack, Pi integration, training worker, and storage choices. Prefer an existing local database plus filesystem artifacts and the current worker mechanism. Do not introduce microservices, a distributed queue, a new plugin framework, or a generalized workflow DSL for this scope.

Maintain clear responsibilities within the existing codebase:

- **Mentoring coordinator:** plans bounded experiments and lesson batches through Spark.
- **Independent runner:** executes checks, maintains split boundaries, applies budgets/permissions, and controls candidate selection.
- **Training worker:** runs the pinned recipe and produces adapter artifacts/checkpoints.
- **Graduate runtime:** loads the exact model/harness, resolves local bindings, and runs the Pi session for both desktop and CLI.
- **Package service:** validates, exports, imports, and prepares the same artifact for Hub publication.
- **UI and CLI:** present those shared services without implementing their own policy or execution semantics.

These are logical boundaries, not requirements for separate processes. Use isolation where needed for model/training workloads and tool execution.

Persist enough state to restart safely. A completed training job must not rerun because the desktop reopened. Keep active graduate versions immutable, candidate artifacts separate, and promotion atomic. Rollback must restore the matching adapter and harness together. Record each session's version; do not silently swap its underlying agent mid-run.

## 16. Records and lifecycle

Extend current schemas rather than creating parallel stores. At minimum, retain these concepts:

| Record | Essential fields |
| --- | --- |
| JobContract | Version, task schema, boundaries, permissions, evaluation contract, budget, resource requirements |
| Attempt | Task/split identity, model/harness version, observable trace, fixture/snapshot references, checker result, usage |
| Lesson | Source attempt or accepted correction, diagnosis, category, verified targets, related examples, data permissions |
| Intervention | Hypothesis, type, proposed delta, verification plan, predicted effect, parent candidate |
| Experiment | Inputs and versions, recipe/seed, actual budget, development/regression results, disposition and reason |
| GraduateVersion | Parent, model reference, adapter, harness, contract, evaluation status/report, package hashes |
| LocalInstallation | Graduate version, local bindings, permissions, cache locations, compatibility and smoke-test results |
| Publication | Graduate version, destination repository, visibility, immutable revision, completion/error status |

Use explicit lifecycle states compatible with the current application: draft, baselining, diagnosing, preparing, training, evaluating, ready, experimental, stopped, and failed. Not every intervention passes through training. Candidate acceptance and active-version promotion are separate events. Provide cancellation at safe boundaries and record a partial result when budgets are exhausted.

## 17. Evaluation and the claim Architect can support

The central empirical claim remains: a task-specific local graduate can approach Spark's performance on a defined job while meeting device constraints. Do not generalize beyond the tested task distribution.

Use scenario/template-level splits where possible to prevent near-duplicate leakage. Keep synthetic variants of one scenario in the same split. Training and development feedback may inform mentoring; private final-test answers and final-test traces must remain unavailable to Spark and training. Public package smoke checks are separate assets, not a copy of the locked test set.

Freeze the selected candidate before the final test. If it fails, report the failure. Any further development requires a fresh held-out graduation evaluation before claiming a new held-out result.

Target these comparisons within available compute:

1. Untouched student with the fixed baseline harness.
2. Harness-only mentoring with unchanged weights.
3. One-shot verified synthetic-data LoRA training.
4. Iterative failure-specific LoRA mentoring with the comparison harness fixed.
5. Combined graduate selected by bounded intervention choice.
6. Spark on the same task distribution as a performance reference.

The primary research question is whether targeted corrections and appropriate intervention selection improve task success for the available mentoring budget. DAgger-style correction is prior art; do not claim that teacher/student learning or dataset aggregation itself is novel.

For training comparisons, match example and training-compute budgets where feasible. Record teacher tokens/cost, rounds, wall time, and total compute separately. If budgets differ, disclose the differences; do not call them equal-budget. Label omitted comparisons and do not infer their results.

Report task success with counts, per-capability results, refusals/unsupported cases, regression failures, latency p50/p95, peak memory, training and teacher cost, and configuration. Include refusals in overall task-success accounting according to the locked contract. Use deterministic checks where possible; identify any human review. Spark must not be the sole judge.

## 18. Acceptance tests and demonstration

Use meaningful integration and boundary tests, not tests that merely reproduce implementation details. Reuse the existing suite and fixture infrastructure.

| ID | Acceptance requirement |
| --- | --- |
| A01 | A real LoRA adapter is trained, loaded, and used on the intended local inference configuration; mocks are labeled and do not satisfy this gate. |
| A02 | A recorded student failure yields a replayable or explicitly full-task correction that passes an independent checker; invalid corrections are excluded. |
| A03 | A harness change and a weight change can be evaluated separately; a harmful intervention is rejected and the prior working version remains usable. |
| A04 | A user correction enters the teaching queue, respects data-sharing settings, and creates a versioned candidate without silently updating the active model. |
| A05 | UI progress and capability results reconcile with recorded experiments, including rejected and stopped runs. |
| A06 | The graduate reopens after application restart, runs with teacher/network disabled when the job permits, and survives version rollback with adapter/harness alignment. |
| A07 | Export/import preserves model and harness identity; a clean installation resolves the base, binds different local paths, and runs permitted tasks. |
| A08 | Imports reject tampered packages, unsafe archive paths, unsupported schemas, and incompatible required runtimes before executing package code. |
| A09 | Export excludes credentials, chats, private data, and machine bindings by default; selecting optional resources is explicit. |
| A10 | Desktop and CLI use the same loader/runtime and permission rules; deterministic fixtures give consistent task-level outcomes, with version/configuration recorded. |
| A11 | Batch CLI output is valid JSON; invalid input, missing permissions, cancellation, and execution errors terminate predictably without approval hangs. |
| A12 | A private Hub publication can be installed by immutable revision in a clean supported environment; upload failure is reported accurately. Use a local simulation only if credentials are unavailable, and mark live Hub validation incomplete. |
| A13 | Import smoke-test status is distinct from the author's graduation report; an unsupported small device is reported honestly. |
| A14 | Final evaluation remains isolated from mentoring, and all advertised improvement numbers have reproducible records and disclosed budgets. |

### Demonstration sequence

Show a natural-language job, an actual baseline failure, Spark's diagnosis, a verified teaching intervention, and measured development improvement. Execute a new held-out task through the frozen graduate. Show **Teach this** producing a candidate/version record, then run the saved graduate from the CLI. Demonstrate export/import with different resource bindings and show the Hub artifact if publishing is ready. Disconnect the teacher/network for the local-inference segment.

Training may be prerecorded if clearly labeled. The full evaluation report may show limited or no improvement; present the actual result. A polished demonstration cannot substitute for the independent measurements.

## 19. One-week execution order

| Window | Main outcome |
| --- | --- |
| Day 1 | Audit existing implementation; pass inference/training/adapter-loading gate; confirm task family, checker, hardware, and baseline; settle shared graduate/runtime contract. |
| Days 2–3 | Capture/replay traces, verify corrections, implement bounded intervention selection, and train/evaluate targeted candidates. |
| Day 4 | Complete one end-to-end graduate, Teach this queue, version lifecycle, and evidence-backed apprenticeship UI. |
| Day 5 | Add package export/import, local resource rebinding, compatibility checks, and shared-runtime CLI. |
| Day 6 | Add Hugging Face publishing/install, run controlled comparisons, and address clean-environment integration failures. |
| Day 7 | Freeze candidate, run locked evaluation, validate offline/restart/rollback and package workflows, polish demonstration and documentation. |

Overlap independent UI/package work with long training runs using the existing development workflow, but integrate against a real graduate as early as possible. Do not postpone the first end-to-end run until the final days.

If the feasibility gate fails, report the blocker early and preserve the original fallback distinction: a harness-only prototype is not a fine-tuned graduate. If time becomes tight, reduce cosmetic polish, optional comparisons, or external publishing before weakening the real training path, evaluation integrity, or permission boundary. Report every remaining requirement as incomplete; do not silently redefine completion.

## 20. Handoff and final delivery requirements

Deliver working code integrated into the current project; setup/run instructions for the supported configuration; a concise feature/acceptance checklist; runnable graduate/package artifacts; CLI documentation and examples; evaluation records and limitations; and any successful Hub repository/revision link. Separate implemented, validated, and deferred status.

When starting from this spec, first inspect the repository and give a short delta plan identifying existing components to reuse. Then implement in the order above. Preserve unrelated work and current architectural choices. Any change that materially contradicts the settled product decisions must be raised rather than silently substituted.

The finished product should demonstrate two linked capabilities: **Architect can teach and verify a useful local specialist, and it can deliver that specialist as a reusable agent across its desktop, terminal, and compatible installations.**

## Reference links

These links support the implementation direction; inspect the repository's pinned versions before using any API names. Do not upgrade a working integration merely to match current documentation.

- Original product baseline: `Architect_Updated_Spec(2).docx`, October 23, 2026, supplied by the owner.
- Pi SDK: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md
- Pi model connections: https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md
- Pi runtime and permission boundaries: https://github.com/earendil-works/pi
- PEFT checkpoint structure: https://huggingface.co/docs/peft/main/developer_guides/checkpoint
- Hugging Face uploads: https://huggingface.co/docs/huggingface_hub/en/guides/upload
- Hugging Face model cards: https://huggingface.co/docs/huggingface_hub/en/guides/model-cards
- DAgger-style agent-learning precedent: https://arxiv.org/abs/2605.12913
