# Architect: Field Specialization

**Date:** October 30, 2026  
**Owner:** Jake Kang  
**Status:** Proposed product and engineering specification; implementation has not started.  
**Audience:** The owner and concurrent Claude Code/Codex development sessions.

## 1. Product decision

**Architect turns a field of work into a specialist you can own.** A large mentor researches the field, proposes the skills that matter, builds verified practice, and teaches an open student model. Architect measures what the student can do across those skills, packages the qualified version, and improves it through accepted expert corrections.

The unit of specialization grows from one task to a **field with several related competencies**. A specialist should understand shared concepts and complete unfamiliar combinations of work. Five unrelated demos do not satisfy this requirement.

Keep one product and one loop:

**Describe a field → research and define it → teach and test → use the specialist → correct and improve.**

Research, curriculum, training, and qualification are stages inside Architect. They are not separate products, general-purpose research workspaces, or an autonomous team of agents. One mentor can act as researcher, curriculum author, and teacher in different bounded stages. The existing runner retains authority over execution, permissions, budgets, and evaluation.

The long-term opportunity is infrastructure for building industry-specific models: permissioned domain knowledge, reusable evaluations, verified demonstrations, and reproducible adaptation. The first release demonstrates field specialization of an existing model. It does not claim to have pretrained a foundation model or established expertise across an entire industry.

### Relation to the existing specifications

Extend the current application, runtime, teaching loop, package format, and workspace. Do not restart the project. This proposal changes the older single-task scope into one field containing related task families and adds research before teaching. Once adopted, those scope changes take precedence over the corresponding limits in `SPEC.md` and `docs/SPEC_EXPANSION.md`.

Preserve the existing vault, deterministic qualification, offline graduate, permission, lineage, and budget contracts. The mentor proposes weight-training interventions through the controlled training worker; it never directly edits weights, checkers, permissions, or evaluation splits. Older instructions about fixed weights must be reconciled with the already specified training-worker route, not removed wholesale. Do not revive the superseded Pi integration described in the older expansion document; use the current Architect runtime.

This document is a design deliverable, not an instruction to start paid compute, change the application, or publish a release.

## 2. Who benefits and what makes this useful

The initial builder is a domain expert or small operations team with procedures, examples, and recurring work, but without a model-training team. A technical builder can support that person. The resulting specialist serves staff working in that field.

The current alternative is repeatedly explaining the same rules to a general assistant, manually reviewing every result, or hiring engineers to build a narrowly scripted tool. Architect should reduce repeated setup and review by making competence reusable and its limits visible.

Research reduces the burden of starting from a blank page. It can identify terminology, common workflows, authoritative references, edge cases, and missing evidence. It cannot replace access to real work or an expert's definition of a correct outcome.

The product has three layers, exposed as one specialist:

| Layer | Contains | How it changes |
| --- | --- | --- |
| Field | Shared terminology, sources, competencies, procedures, verification templates | A versioned field definition, reviewed before teaching |
| Organization | Local policies, pricebooks, records, permissions, preferences | A versioned organization profile and resource bindings |
| Trained specialist | Pinned student, optional adapter, harness, source snapshot, qualification evidence | A candidate is measured, then explicitly promoted |

Stable behavior can belong in the model: interpreting a work order, finding missing evidence, choosing tools, and recovering from mistakes. Prices, stock, dates, and changeable company rules belong in data or procedures. A new company should not require training a new model merely to change its pricebook.

## 3. First field: maintenance and repair operations

The recommended first field is **maintenance and repair operations**, initially grounded in one equipment category with an operator who can validate the work. The implementation should support several roles in that lifecycle, rather than just producing quotes for one shop.

This is an initial hypothesis chosen for reusable infrastructure, linked workflows, and checkable outcomes. Research may narrow the equipment category before data and evaluation contracts freeze. It must not expand the release into all trades. If no real operator participates, label the field demonstration synthetic and the customer-demand hypothesis unvalidated.

### Required competency families

| Competency | Example work | Independent verification |
| --- | --- | --- |
| Intake and evidence | Normalize a work order, reconcile equipment/history, identify required missing information | Required fields, provenance, permitted clarification/deferral states |
| Policy and eligibility | Apply warranty, service agreement, and exception rules | Approved decision tables with boundary cases |
| Estimation and resources | Build line items, check compatible parts and quantities, calculate an estimate | Arithmetic, catalog compatibility, inventory constraints |
| Planning and coordination | Propose a feasible slot, reserve resources, handle conflicts and replanning | Capacity/time constraints and expected final records |
| Reconciliation and communication | Compare approved work with completed work, identify discrepancies, prepare an evidence-backed update | Ledger consistency and required factual content |

Communication style may receive advisory human feedback. It is not awarded a deterministic correctness score merely because an LLM likes the wording. Model outputs should pair readable explanations with structured decisions that the checker can inspect.

Some tasks combine three or more competencies. For example, a returning customer's work order requires clarification, a warranty exception, an alternative part, a revised estimate, and a new slot. A correct estimate with a conflicting reservation fails the complete task.

The specialist stages writes for user approval. A committed operation must leave related records consistent; reject, cancel, stale-input, and partial-failure paths leave no unintended changes. This is a new acceptance requirement where the current runtime does not yet guarantee it.

Bound this guarantee to the example's local, versioned JSON record store in one workspace. Imports normalize operator records into that store. Stage a new snapshot, validate it, acquire the workspace write lock, and compare the original input hashes before committing. Commit by atomically switching the active-snapshot manifest; recovery uses the last complete validated snapshot. All readers of this store resolve that manifest. Reject stale approvals rather than overwriting intervening changes. No cross-workspace transactions, external calendar reservations, or live ERP writes are included. The UI identifies these as local records/proposals, not externally confirmed bookings. Existing arbitrary file tools retain their documented behavior and are not advertised as transactional.

Exclude physical control, safety-critical repair instructions, and broad ERP replacement. Technical manuals supply operational context and allowed references; uncertain diagnosis is escalated to the qualified operator.

## 4. The research stage

### Inputs and user experience

The user describes a field, intended work, target hardware, and optionally an organization. They can attach manuals, procedures, data schemas, example cases, and sources. Architect asks only questions that affect scope, verification, or permission.

The mentor researches through a bounded search/fetch interface in setup. The interface supports public sources and user-provided documents; no browser automation framework or connector marketplace is required. A local-only research mode uses uploaded material and a configured local mentor. An online mode makes the permitted data-sharing boundary explicit.

Research produces a **field brief** containing:

- A concise description of the field and intended users.
- The proposed competency families and how they connect.
- Cited concepts and procedures, including source date/version and applicability.
- Common failures, ambiguous rules, missing evidence, and excluded work.
- The proposed data, tools, verifiers, training strategy, and cost/time limits.

The user reviews the brief on the existing Define screen. Show the capability list and unresolved decisions first; sources and technical settings are expandable. Do not make the user read an academic report before starting.

### Source and claim requirements

Each source record carries an identifier, URL or local origin, publisher, retrieval time, effective date/version when known, content hash, permitted uses, and relevant passages. Claims and proposed skills refer back to source identifiers and locators.

Keep permissions for retrieval, training, and redistribution separate. Public availability does not establish training or redistribution rights. Unknown permission excludes content from weight-training datasets and exported source bodies until resolved; references may remain where appropriate. Uploaded organization material follows the user's declared permissions and existing data-sharing settings.

Enforce permitted use transitively through source → claim → generated case → correction → dataset. Paraphrasing or synthesizing a lesson does not remove its source restrictions. A descendant inherits the intersection of its contributing sources' permitted uses; unknown or denied training permission excludes it from weight training. If dependencies cannot be established, keep the item out of the training export pending review. Apply equivalent checks to redistributed derivatives.

Prefer primary documentation and actual operator procedures. Resolve conflicts using scope, effective date, and confirmed authority. A company policy can override an internal default within its scope; it cannot silently override an external constraint. Ask about unresolved consequential conflicts rather than averaging conflicting instructions into a training label.

Fetched material is evidence, never instructions to the researcher or runner. It cannot grant tools, change budgets, run code, or override the job contract. Source text and links must not smuggle locked-test material or private local content into a research call.

Search failures, inaccessible sources, or an exhausted budget produce a partial brief with explicit gaps. Users can supply missing documents and resume. No uncited model memory is presented as researched evidence.

### Research acceptance

A field may proceed to teaching only when every active competency has an approved scope, a credible evidence basis, a data route, and a supported independent verifier. Unsupported competencies stay proposed and are excluded from qualification. Research should discover limitations as readily as it discovers opportunities.

Source updates are explicit refreshes. Changes create a new field version with an impact summary; they do not rewrite an active specialist while it is being used.

## 5. From field knowledge to a curriculum

A competency is a small record, not a new orchestration framework: its identifier, description, prerequisites, evidence references, task families, verifier identifier/version, exclusions, and target requirements. A short dependency list is sufficient; a graph editor is unnecessary.

The curriculum combines three kinds of material:

1. Permissioned examples from actual work, with operator-confirmed outcomes.
2. Source-grounded synthetic training cases with independently computed answers.
3. Verified mentor corrections collected from student failures.

Generated labels are proposals until validated. The first release uses a bounded verifier catalog: exact structured answers, approved rule tables, arithmetic, required evidence, constraint checks, and sandboxed final-state checks. The mentor may propose a task or a new verifier requirement; it cannot write an arbitrary grader and certify itself with that grader. New verifier logic requires a separate implementation/review step and adversarial fixtures.

The runner owns partitioning and the vault. Cluster related cases by underlying scenario, organization records, and template lineage before partitioning so paraphrases and near-duplicates do not cross splits. Common public manuals may be shared knowledge; hidden scenarios, expected outcomes, private organization records, and evaluation feedback are not.

The research/teaching mentor creates training proposals only. Final-test scenarios are authored by a separate evaluator or generated inside the runner's isolated evaluation process from frozen templates and private seeds. The mentor cannot author all test answers upstream and then claim never to have seen them. Evaluator identities, accessed inputs, and task origins are recorded.

The evaluation owner authors and reviews the final scenario templates independently from the mentor's generated examples, traces, and curriculum templates. Permitted shared inputs are the approved public field sources, capability definitions, and independently reviewed business/checker rules; the hidden scenario designs, private records, seeds, and outcomes remain evaluation-owned. Common domain rules are expected; shared concrete scenario ancestry is not. Review template lineage before freezing partitions, and reject disguised paraphrases across train/development/final cohorts. Separate model sessions alone do not establish independence.

Select practice using capability gaps, severity, and fixed per-family quotas. Include earlier competencies to detect forgetting. Stop work on a family at a declared plateau or cap. No learned curriculum scheduler or unbounded recursive research loop is needed.

## 6. Teaching and model adaptation

Reuse failure-specific replay, trace-referenced diagnosis, answer-blind corrected continuations, verified lessons, and keep/revert experiments. Each intervention must connect a diagnosed weakness to a measured result.

| Observed weakness | Candidate intervention |
| --- | --- |
| Missing or stale information | Source binding or retrieval change |
| Omitted workflow step | Procedure or instruction change |
| Repeated deterministic mistake | Bounded helper with direct tests |
| Persistent interpretation/action-selection failure | Batch of verified demonstrations and a candidate adapter |
| Ambiguous domain rule | Expert clarification before more training |

Every candidate is evaluated across the active competency suite, including regressions. The old aggregate development target must not short-circuit work on a new accepted competency. A changed field scope, company rule, or success definition creates a new contract version and a new qualification requirement.

Training must mean what the UI says. Distinguish **instructions/tools improved**, **sources updated**, and **model weights trained**. A training job counts only when real examples and tokens were processed, an artifact was produced, and the intended runtime loads that artifact.

Start with the existing constrained adapter recipe and worker. Record base revision, dataset manifest/hash, source permissions, recipe, seed, compute, adapter identity, conversion, and actual loading evidence. The runner controls the operation and hard caps. Stop or recover without replacing the active version if compute fails, conversion fails, the job times out, or the runtime cannot load the result.

Keep one model family and one deployment configuration in the first full proof. Additional provider logos are not a milestone. Research may propose an unsuitable model, but hardware fit and adapter compatibility must be verified before allocating a training job.

## 7. Qualification: demonstrate a field, not a memorized worksheet

Qualification is scoped evidence. The product must never label an entire profession mastered because a finite task suite passed.

### Required kinds of evaluation

- **Within-family generalization:** new records, entities, values, wording, and exceptions.
- **Composition:** unfamiliar combinations of previously learned competencies.
- **Cross-organization transfer:** a new organization using its own profile and files, without weight updates or access to its answer labels.
- **Change and retention:** a confirmed rule change improves affected cases while preserving unaffected skills.
- **Boundary behavior:** missing information, contradictory evidence, unsupported work, and denied writes produce the correct clarification or refusal.

Cross-organization transfer is the key expansion beyond one custom task. One separately supplied profile and case set is enough for the first demonstration; it is evidence of transfer to that organization, not proof of industry-wide generality. A synthetic second organization is labeled synthetic. Human help, setup time, and any profile corrections are disclosed.

The held-out organization's private records and cases are excluded from research, curriculum creation, training, development, and candidate selection. An operator prepares its profile against the already frozen schema without seeing outcomes; freeze that profile and its resource bindings before qualification. Only the frozen student receives the permitted organization context at inference. No outcome-driven profile, prompt, tool, or weight changes are permitted during the transfer test. After a failure, adapting to that organization is a separate experiment; a renewed claim of unseen-organization transfer requires another untouched organization and cohort.

### Proposed first evaluation contract

Freeze final counts and thresholds before candidate selection. The initial target is 150 distinct scenarios: 24 per competency family plus 30 combined-workflow scenarios. At least 30 of those 150 come from an organization excluded from training. Each case has one primary family/combined classification; report the cross-organization subset separately without double-counting it in the total.

Proposed qualification thresholds are at least 90% complete-task success overall, at least 85% within each family, at least 80% on combined workflows, and at least 85% on the cross-organization subset. Unauthorized writes, hidden-test access, and non-local graduate calls are hard failures regardless of average score. Set latency and memory ceilings from the intended hardware before tuning. These are initial engineering targets, not measured results or claims of production reliability.

Use a development feasibility run to confirm the task mix is realistic and the student has learnable weaknesses. Freeze any revised contract before optimizing candidates; preserve the revision history. Never change thresholds or remove hard cases after observing final results.

### Controlled comparisons

Compare a bare student, a strong one-shot mentor setup, and the taught specialist on the same final suite. When real adapter training is available, additionally isolate harness-only, adapter-only, and combined changes. All candidates freeze before any final-test result is released. Unrun arms remain explicitly unrun.

Use matched context, tools, decoding, and budgets where possible; disclose differences. A research ablation compares expert-provided material alone with the approved researched curriculum, using matched access and teaching budgets. It is a secondary experiment, not a prerequisite that doubles every training run.

Report counts, paired changes, uncertainty, per-family errors, cross-organization results, latency, memory, mentor spend, training compute, and actual deployment configuration. Do not transfer a hosted result to a local quantization. Do not describe fewer output tokens as measured compute savings. Report inference cost and teaching/training amortization separately, with their assumptions.

The mentor receives train/development evidence only. Once a locked test is disclosed, it is retired for further tuning of the reported experiment. Any later candidate needs a fresh untouched cohort. A failed candidate remains experimental; the active graduate stays unchanged. If budget prevents a fresh cohort, stop with development evidence and say so.

## 8. Output and continued use

The output is one versioned specialist package, compatible with the existing graduate lifecycle. It includes:

- Pinned model and optional adapter identities.
- Field and organization-profile versions.
- Harness, skills, tools, and allowed source snapshot/index.
- Capability report, limitations, lineage, and training provenance.
- Logical resource bindings, permissions, and local runtime requirements.

Runtime inference remains offline except for the local model service. The researcher and remote trainer exist only in explicit setup/improvement sessions. The graduate cannot construct a mentor, search the web, silently refresh sources, or upload ordinary conversations. Required sources are available locally or the capability is unavailable. Do not attempt to solve missing data by breaking offline behavior.

Teach this classifies a correction as shared field behavior, organization-specific policy/data, or an unverified suggestion. The user confirms the scope. A company-specific preference must not silently alter the shared field definition or another organization's graduate. Ordinary chats do not train a model.

Create candidates separately; promote or roll back the model, adapter, harness, and field references together. Include only permitted materials in export. Keep private records and hidden evaluations out of distributable packages. Model/adapter reuse across new base revisions requires retraining or compatibility validation and fresh qualification.

For installation on another machine, the shared package carries source references and required logical bindings, not private organization records. The operator separately supplies an authorized local organization folder, or creates an explicitly reviewed private installation bundle containing those resources. Before enabling a capability, verify required source versions, resource availability, schema compatibility, and permissions. Missing resources block that capability with a repair action; the installer does not fetch private data or silently weaken the task. Installation smoke checks confirm setup, not new field qualification, and rebinding does not inherit an unmeasured cross-organization score.

## 9. UI: extend the current flow

Use existing design tokens and components; preserve the calm, single-focus screens in `docs/DESIGN.md`.

| Existing surface | Extension |
| --- | --- |
| Describe / Define | Describe the field, review researched skills and sources, add company context, confirm the plan |
| Training | Show the current weakness, verified lesson, intervention, and progress across the field's skills |
| Report | Show what is qualified, tested sample sizes, cross-organization evidence, limits, and exact runtime |
| Workspace | Use one specialist across related work; show its version and request approval for changes |
| Teach this / Improve | Choose correction scope, preview affected skills, measure a candidate, keep or revert |

Keep source auditing, recipe settings, and experiment details behind disclosure. No separate research dashboard, model marketplace, curriculum canvas, or committee of agent avatars. One primary action per stage.

The interface must distinguish proposed skills, development-tested skills, and qualified skills. A lack of evidence is not a zero score and not a pass. A current source citation does not imply a trained capability.

## 10. Engineering boundaries and contracts

Add to the existing shared schemas and services. The following are conceptual records to implement, not existing APIs:

| Record | Minimum contract |
| --- | --- |
| Field definition | ID/version, scope, exclusions, competencies, approved source snapshot |
| Evidence source | Origin, version/date, hash, locators, permitted uses, affected claims |
| Organization profile | Field version, approved overrides, resource bindings, private-data policy |
| Curriculum manifest | Competencies, training case lineage, verifier versions, quotas; no test payloads |
| Candidate reference | Existing graduate/run IDs plus field/profile/dataset/model/adapter/harness identities |
| Qualification record | Frozen config, suite version, counts, outcomes, limitations, costs, status |

The evaluation manifest and private seeds live in the vault, with only safe opaque references exposed elsewhere. Validate process/file boundaries with the existing schema system. Migrate package versions explicitly if new required fields demand it; old task-based graduates must still load and run. Do not silently mark them field-qualified.

Suggested extension points:

- `packages/shared`: field/source/capability contracts alongside job, training, and report schemas.
- `packages/engine/src/drafting`: researched brief and user confirmation; a small research boundary may sit beside it.
- Existing teaching/improve/loop services: multi-family curriculum and contract-aware stopping.
- Existing vault/checkers/comparisons: suite partitioning, qualification, transfer metrics.
- Existing training worker and `trainer/`: verified dataset provenance and actual adapter experiment.
- Existing graduates/harness/desktop services: package references, capability report, and source refresh.

All interfaces are pinned before parallel implementation branches diverge. The research service does not get a vault client. The teaching service does not get mutable checker access. The graduate host does not get the research transport. The same current runtime continues to execute CLI, evaluation, and workspace tasks.

## 11. Scope and acceptance

### First delivery: required

1. One researched field definition with the five related competencies above, approved sources, and explicit gaps.
2. Source-to-claim-to-skill-to-lesson provenance visible on demand.
3. One shared specialist that performs both individual and combined tasks through the current runtime.
4. A real correction creates verified practice and a candidate measured across affected and retained skills.
5. A frozen local qualification with an organization held out from training.
6. An actual adapter feasibility experiment, with loaded artifact and honest benefit/no-benefit results if training is feasible.
7. Reusable field definition plus a separate organization profile; no per-organization fork of the application.
8. One complete UI journey and reproducible evidence package.

If real adapter training remains unavailable, the release can demonstrate a researched, harness-adapted specialist. It must explicitly report the missing weight-training milestone and cannot advertise a fine-tuned model. Existing restrictions on local GPU use and unconfigured paid compute still apply when implementation begins; resolve provisioning then, not through an implicit side effect of writing this spec.

The full first-delivery claim requires all five competency families. A smaller scope agreed before candidate selection receives a new, explicitly limited contract: 24 final cases per retained family, at least 30 combined cases spanning two or more retained competencies, and at least 30 held-out-organization cases within that total, using the same rate thresholds. Fewer than two competencies is a task demonstration, not field qualification. After final results are exposed, failed families cannot be removed to manufacture a passing contract; a reduced successor needs a fresh suite. Unqualified or excluded competencies are disabled in the supported tool/action routes and produce an explicit scope response in the workspace. Retain the missing milestones in the delivery report.

### Concrete acceptance scenarios

- Conflicting sources cause a review question; unapproved claims do not become training labels.
- A source allowed for retrieval but not training is excluded from the training export.
- An unsupported competency remains proposed; the UI cannot promote it through an LLM score.
- A correct quote with an invalid inventory change fails; a rejected transaction changes nothing.
- A newly accepted competency trains even when the old development target already passes.
- A policy change creates a new contract/candidate and cannot inherit the old qualification.
- Changing the organization profile alone supports a new organization's cases, with the actual transfer result reported.
- A candidate improving one family while violating a required family threshold is rejected.
- Attempts to inspect the vault through research, teaching, exports, or traces are denied.
- With external networking disabled, the graduate completes a combined task using its pinned local evidence and runtime.
- A failed training/research job can resume safely or stop within its cap; it cannot damage the active version.
- Existing task-only packages continue to load, preserving their original evidence status.

### Defer

Arbitrary industry coverage, autonomous domain certification, multiple independent product verticals, multimodal training, coding execution environments, continuous background training, reinforcement-learning infrastructure, foundation-model pretraining, distributed GPU scheduling, broad business connectors, and a marketplace.

## 12. Delivery sequence and parallel ownership

The initial target window is October 30–November 4, 2026, Eastern time. Parallel capacity accelerates a single integration path; it does not remove the need for independent data or sequential model experiments.

| Lane | Owns | Integrates against |
| --- | --- | --- |
| Research and scope | Source records, field brief, confirmation, refresh | Shared field/profile contracts |
| Domain and evaluation | Operator material, verifier catalog, fixtures, partitions, transfer suite | Frozen competency and mutation contracts |
| Teaching and training | Curriculum selection, lessons, stop conditions, real adapter run | Verified training manifests and immutable evaluator interfaces |
| Product and deployment | Existing screens, packaging, local performance, evidence presentation | Real event and qualification records |

One integration owner controls shared schemas; one evaluation owner controls checker/split changes. Reserve compute and inference budgets centrally. Do not let concurrent sessions consume the same final test as a debugging fixture.

- **October 30–31:** Freeze the field and contracts; secure operator examples; implement the smallest researched brief; run local and actual training feasibility checks.
- **October 31–November 1:** Integrate all five competency families, bounded curriculum, scoped corrections, and existing UI extensions. Run development evaluations continuously.
- **November 2:** Freeze candidates and comparison protocol; complete training; prepare untouched local and transfer qualification.
- **November 3:** Run final qualification, check installation/offline behavior, and record the actual end-to-end experience.
- **November 4:** Resolve evidence/documentation discrepancies and package the verified build. Event-specific checklist and requirements remain in `docs/HACKATHON.md`.

Cut optional research ablations, extra models, and extra modalities before cutting the connected field workflow or evaluation integrity. If the first delivery cannot establish five competencies, report the smaller supported scope rather than renaming one task an industry model.

## 13. Demonstration and path to larger models

The demonstration begins with a field, not a receipt. The user asks for a maintenance-operations specialist. Architect researches the field and shows five connected skills, their sources, and one unresolved rule. The user resolves it and supplies an organization profile.

Show a real student failure on a multi-step job, a verified mentor lesson, and a candidate whose development performance improves without losing earlier skills. Then show the frozen qualification and use the local specialist on a different organization's unfamiliar job. The second organization's source files may be provided as context; its expected answers may not. Finish with a complete approved state change and a known limitation. Label accelerated waits, prerecorded traces, and synthetic fixtures.

The path to broader models has three evidence gates:

1. **Now: field specialist.** Research-informed curriculum, multi-competency local performance, and limited cross-organization transfer.
2. **Next: transferable field training assets.** Permissioned data across independent organizations, portable verifier specifications, expert review, and experiments on additional base models with separate qualification. Export research assets through an explicit reviewed path, not the ordinary graduate export.
3. **Later: industry model program.** Substantial diverse data, expert-built benchmarks, verified rewards, and evidence of competitive accuracy and compute efficiency. Evaluate larger-model fine-tuning, continued pretraining, distillation, or reinforcement learning only when data and measured failure modes justify them.

The same curriculum and data lineage can support a larger remotely trained student. That student is a research candidate until it meets the selected deployment contract. A model that cannot run locally is not silently sold as an offline graduate; hosting it would require a separately specified deployment mode. Larger parameter count is not itself progress.

### Positioning and source basis

YC's current **Vertical Foundation Models** request emphasizes transferable specialist capability, data rights, verifiable domain rewards, and accuracy/compute advantages. Its **Own Your Intelligence** request is an even closer match to Architect: converting business expertise and failures into evaluations and owned models. This specification is our product interpretation of those requests, not evidence that Architect already meets their bar. [YC Requests for Startups](https://www.ycombinator.com/rfs)

The initial operations hypothesis is supported by reported communication, quoting, and administrative workload in Jobber's broad home-service survey. That does not validate this particular field pack, willingness to pay, or preference for local models. Validate those with an operator. [Jobber research](https://www.getjobber.com/home-service-trends-report/)

Existing optimization research means Architect should claim an integrated, inspectable specialization process, not inventorship of reflection or teacher-student learning. [GEPA](https://arxiv.org/abs/2507.19457), [ACE](https://arxiv.org/abs/2510.04618), and [tau-bench](https://arxiv.org/abs/2406.12045) inform the optimization and outcome-evaluation approach.

Repository grounding: `docs/SPEC_EXPANSION.md`, `docs/EXPANSION.md`, `docs/HARNESS_FORMAT.md`, `docs/DESIGN.md`, and the recorded comparisons. The existing hosted result is evidence for harness adaptation; this proposal's research curriculum, field transfer, trained-adapter benefit, and local results require new implementation and measurement.
