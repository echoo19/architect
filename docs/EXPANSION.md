# Expansion

The owner's Expanded Implementation Spec (`docs/SPEC_EXPANSION.md`, Oct 28) governs the last week. This page maps it onto the repo, records what day 1 found, and tracks every requirement with its evidence. Status words: **done** (implemented and verified, evidence named), **built** (implemented, not yet verified end to end), **in progress**, **not started**, **blocked** (reason given), **deferred** (by the spec).

## Day-1 findings (Oct 28)

- **No Pi.** Graduates run on Architect's own loop (`packages/engine/src/agent/loop.ts`), which task evaluation and the workspace's agent host already share. The owner: Pi is a good base, and a custom harness is fine if it is a classic coding-agent harness. Decision 030.
- **No LoRA recipe existed.** Decision 011 had ruled weight training out of the first version.
- **Training compute.** Glimmer 30B is dense (about 29.6B). QLoRA needs a 24 GB GPU and plain LoRA more than 40 GB (Unsloth's guide). This PC has 12 GB, and the owner keeps local GPU work to brief checks. Real training needs remote compute the owner hasn't configured yet. Decision 033.
- **Local adapter inference.** Ollama 0.40.9 refuses adapters ("LoRA adapters are no longer supported"). llama.cpp's `llama-server` (b10472, already on this PC) loads the 2-bit Glimmer GGUF straight from Ollama's model store with a LoRA attached, switches the adapter per request (scale 0 and scale 1 gave different text from a probe adapter), and with `--jinja` returns Glimmer's tool calls as structured calls. Decision 031.
- **Task family.** The returns desk (`examples/gear-returns`): bare hosted Glimmer passes 36 of 45 dev tasks (refunds 15/15, orders 11/15, pickups 10/15). Decision 032.
- **Code that fights the spec** (audit): a graduate opens only where it was trained, because its job and data come from the run's folders; `graduate.yaml` carries machine settings (`baseUrl`); a graduate has one version (accepting rewrites it in place, import refuses an existing id); chats don't record which version answered and drop tool traces; approvals in ask mode wait forever; the integrity hash covers only harness files; job contracts are overwritten in place. Fixed by decisions 036 and 037 (Oct 28), except that chats still drop tool traces.

## Plan, in order

1. **Runtime v2, a coding-agent harness** (decision 030). Built-in tools `read`, `ls`, `glob`, `grep`, `write`, `edit`, `append` and `run` (JavaScript in the QuickJS sandbox, no network). `AGENTS.md` instructions, `skills/<name>/SKILL.md` read on demand, helpers as typed sandboxed tools, logical paths (`data/`, `output/`) bound per installation. One loop for evaluation, the workspace and the CLI.
2. **Versions and records.** Graduate versions with parents, candidate apart from active, atomic promotion and rollback (adapter and harness together), versioned job contracts, sessions that record their version; lessons, interventions and experiments; installations and publications.
3. **Local adapter backend and training worker** (decisions 031, 033, 035). `llama-server` process management, an adapter-aware student, a dataset builder from verified lessons (assistant turns only), a pinned QLoRA recipe, a remote backend once configured, durable job ids, compute accounting. A labeled stand-in backend serves tests and never counts toward A01. Built and tested against fakes on Oct 28 (decision 035); the desktop wiring and a real job are still to do.
4. **Failure-specific mentoring.** Replay checkpoints after whole tool batches, with the original inputs and starting tables kept; Spark names the failure point, the evidence and one intervention from the menu; a correction runs from the checkpoint through the same tools without expected values, and the checker verifies the outcome and that nothing else was written; verified lessons; related practice from other train tasks of the same category; per-category caps.
5. **Intervention menu.** Structured proposals (hypothesis, category, capability, change, expected effect, estimated cost, verification plan) that the runner validates; harness and adapter candidates measured apart, and a combined candidate measured again.
6. **Teach this and Improve agent.** A correction becomes a proposed lesson (classified), then joins the queue; an improvement run makes a candidate version; the user promotes it.
7. **Evidence UI.** Lessons and experiments drawn from stored records, a capability breakdown, badges that tell practice, check, final-test and install-check results apart, step-by-step playback.
8. **Package, import and CLI.** Manifest v2, `name.architect.zip` validated before any code loads, an inclusion review, bindings, smoke checks; the `architect` command.
9. **Hugging Face publish and install.** Private by default, immutable revision; a local simulation if no token is configured.
10. **Comparisons and the demo** on the new runtime, within the credit.

## Requirements

| Priority | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| P0 | Working local student, real adapter training and loading, independent evaluation | built: the adapter runtime, a llama.cpp student, the dataset builder, the pinned recipe, the training worker and its Hugging Face Jobs backend; blocked on training compute for a real adapter; local loading verified with a probe adapter | Day-1 findings; decision 035; `packages/engine/test/{gguf,local-runtime,training-dataset,trainer-recipe,training-worker,hf-jobs}.test.ts`, `packages/adapters/test/student/llamacpp.test.ts`; the GGUF reader read the real 2-bit blob (731 tensors, sizes ending at the file's last byte) and passed the probe adapter llama-server had loaded |
| P1 | Failure-specific teaching with replay and verified corrections | not started | |
| P1 | Bounded selection between retrieval, procedure, helper and weight interventions | not started | |
| P1 | Evidence-based apprenticeship UI | not started | |
| P1 | Teach this and versioned improvement | in progress: versions built, the teaching queue not started | Immutable versions with candidates, acceptance, promotion and rollback, chats and replies that record their version, versioned job contracts (decision 037; `packages/engine/test/graduate-versions.test.ts`, `graduate-contracts.test.ts`) |
| P2 | Portable package and import on a supported PC | done | Manifest v2, `.architect.zip`, inclusion review and scan, import checked before code loads, rebinding, compatibility and smoke checks (decision 036). `packages/engine/test/graduate-packages.test.ts`, `packages/harness/test/package.test.ts`, hidden e2e `apps/desktop/e2e/engine.spec.ts` (export, remove, import with other folders, chat) and `agent-host.spec.ts` (an imported package runs a mentor-written tool on a local model) |
| P2 | CLI using the same runtime | not started | |
| P2 | Hugging Face publish and install | not started | |
| P2 | Demonstration and comparisons | not started | |
| Owner | Classic coding-agent harness for graduates | in progress | decision 030 |

## Acceptance tests

| ID | Requirement (short) | Status | Evidence |
| --- | --- | --- | --- |
| A01 | Real LoRA trained, loaded and used on the local configuration | blocked: no training compute (needs a Hugging Face token with Jobs access); every step up to a job is built and tested against fakes, and the stand-in backend is kept out of this gate (`countsAsRealTraining`) | decision 035; `packages/engine/test/hf-jobs.test.ts`, `training-worker.test.ts`, `local-runtime.test.ts` |
| A02 | A failure yields a replayable or full-task correction that passes the checker | not started | |
| A03 | Harness and weight changes evaluated apart; a harmful one rejected, the prior version still usable | not started | |
| A04 | A user correction enters the queue, respects data sharing, makes a candidate without touching the active model | not started | |
| A05 | UI progress and capability results reconcile with stored experiments, rejected and stopped included | not started | |
| A06 | Reopens after restart, runs offline, rollback keeps adapter and harness aligned | done; inference with an adapter waits for the llama.cpp backend (decision 031) | `graduate-versions.test.ts`: a rollback restores version 1's harness and adapter together and survives a restart, a changed adapter file is refused, and after a restart the rolled-back version answers through the agent host on a local model; `agent-host-offline.test.ts` (no network); e2e `engine.spec.ts` reopens graduates after the workspace process is killed |
| A07 | Export and import keep model and harness identity; a clean install binds other paths and runs | done | `graduate-packages.test.ts`: a second computer imports with its own folder and model, every check passes, the digest, harness and model match the author's, and a task reads the new folder's data; an import that names nothing grants nothing, even on the computer that made it; a package joins an agent only through a parent this computer has; an adapter exports byte for byte and is refused at import until an installation can serve llama.cpp; e2e `engine.spec.ts` |
| A08 | Import rejects tampering, unsafe paths, unknown schemas and incompatible runtimes before running package code | done | `graduate-packages.test.ts` (a changed file in a folder and in a zip, a `../` entry, a symlink entry, an oversized entry, too many entries, schema 3, a runtime this build doesn't know, a `data/` resource that doesn't match its contract, a format 1 folder with an oversized file, not a package: each refused with no tool loaded, no model called, nothing installed and staging empty); `packages/harness/test/package.test.ts` (archives built byte by byte: absolute and drive paths, backslashes, case-insensitive duplicates, Unix and Windows links, devices, bombs, lying sizes, encryption, unknown compression, cut archives) |
| A09 | Export leaves out credentials, chats, private data and machine bindings by default | done | `graduate-packages.test.ts`: the default export holds no chat, binding, endpoint, data file or key; a resource ships only when chosen, and only its named files; a stored key or a user path in a harness stops the export until confirmed |
| A10 | Desktop and CLI share the loader, runtime and permission rules | not started | |
| A11 | Batch CLI output is valid JSON; bad input, missing permission, cancellation and errors end predictably | partly: a non-interactive approval fails with `approval_required` instead of waiting (decision 037); the CLI isn't built | `agent-host.test.ts` ("when no one can answer an approval") |
| A12 | A private Hub publication installs by immutable revision; upload failures reported | not started | |
| A13 | Install checks are kept apart from the author's graduation report; unsupported devices reported honestly | done | `graduate-packages.test.ts`: on a linux/arm64 computer with 1 GB the installation is marked blocked, with both reasons, the model never loads and the workspace won't open it, while the author's evidence and report stay byte for byte; on a computer the author didn't test, the checks say so and measure the model there |
| A14 | The final test stays isolated; every advertised improvement has records and a disclosed budget | partly: vault, leak scan and budgets exist | decisions 003, 022 to 029 |

## Deferred by the spec

Raspberry Pi support, other hardware conversion, a smaller alternative student, a model marketplace, multi-agent teams, broad connectors, unrestricted generated tools, automatic continuous training, open-ended hyperparameter search, and offline bundles that redistribute base weights.
