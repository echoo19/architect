# Architect as an R&D platform: the plan

Adopted on Oct 30 at the owner's word: Architect becomes a full research and development platform for founders, researchers and scientists who build field-specific models. It keeps one clear flow, adds the controls such people expect, and stays beautiful and smooth. Its visual language extends `docs/DESIGN.md` and takes after Hestia (`C:/JakeOS/projects/hestia`): a calm home of cards with a "Needs you" panel, a side inspector with tabs, icon tiles for choices, toggles with their type on the right, Undo toasts. No signs of generated design: no gradients, glows, emoji, sparkle icons, pill clouds, eyebrows, captions that repeat the layout, or stacks of identical cards.

## Two editions (owner, Oct 30)

Architect ships as two versions of one app:

- **Architect** (personal, for consumers and hobbyists): the pre-pivot product, the one-job flow of `base-one-job` (describe a job, Spark teaches Glimmer, a sealed test, use the agent offline), with the returns desk sample and the chat-first home. It keeps the fixes that make that flow sounder (decisions 066 and 067) and shows none of the places below.
- **Architect Lab** (R&D, for founders, researchers and scientists): everything on this page, `docs/FIELD.md` and `docs/SCALE.md`.

One codebase, one installer and one test suite. The edition is a setting chosen on the welcome screen ("Teach an agent one job" or "Run a lab") and switchable in Settings; the shell, the home, the sidebar, the command palette and the Describe screen's offers follow it. The engine and the CLI are the same in both. The site's download page offers both. Every change keeps both editions working: the personal edition's screens and specs are the regression guard for the pre-pivot product.

## The pitch (owner, Nov 1)

**The training system for your own AI.** A large model teaches a small one by rewriting its instructions and tools; every change is tested on work neither model has seen; Architect certifies when the result can be trusted. The specialists below are what the system makes, never the pitch itself.

## Demo sets (owner, Nov 1)

The platform is the product; the specialists are what it makes. They are shown as sets:

- *Business:* Returns desk (`examples/gear-returns`), Service desk (`examples/home-services`), a pricing desk Spark drafted from a repair shop's files.
- *Academies:* Academy desk across several academies, one of them real (`examples/academy`). It is a staff-facing operations specialist (it diagnoses missed questions, sets practice in the academy's records and flags students for staff), never a chatbot for students.
- *Science lab (R&D in two layers: Architect is an R&D platform, and the specialists it makes do R&D):* Sweep desk for ML research groups (`examples/sweep-desk`: best configuration by the group's rule, early stopping, diverged runs, whether a change helped with a paired interval, proposed next runs) and Assay desk for screening labs (`examples/assay-desk`: normalization to controls, hits by the lab's rule, Z-prime plate QC, replicates, a re-test plan).

Every set uses the same places, words and checks; no set gets screens of its own.

## Any model, any cluster, every setting (owner, Nov 1)

The owner: "this whole thing should connect smoothly and be versatile (for demos its muse models tho). should show the strength by highlighting compatibility with any models and gpu clusters and the true customizability like real enterprise r&d science and ml tools." The demos run on Muse Spark and Muse Glimmer; the product works with whatever a team uses. What that means, each item small:

- *Any model in every role.* The teacher and the student can come from any connected provider or any OpenAI-compatible address (vLLM, SGLang, TGI or llama-server on a cluster node as much as a hosted API). A job keeps its models through a job file, an experiment runs on its field's models, and every label names the chosen models rather than Spark and Glimmer. Graduates still run only on this computer (invariant 3).
- *One view of connections.* Models shows every connected provider and address with its status and the roles it can fill.
- *Clusters one step from the work.* A training plan starts from the field's own student model and is reachable from the Student tab, a version in Models and an experiment's weights arm. Exports survive a restart. Bundles cover Slurm, Kubernetes and SkyPilot (any cloud); Architect writes them and never submits them or holds credentials.
- *The science lab is shown, not only offered.* Sweep desk has stand-in fields and an experiment for screenshots, and one measured comparison on hosted models.

## The flow stays the spine

Describe a field → Study and define it → Teach → Qualify → Use. Everything new hangs off that line. A newcomer can follow it without opening anything else; an expert finds every control one step away, in an inspector or on a page of its own.

## Places (sidebar, icon-led, in this order)

| Place | Route | What it is for | Focal point |
| --- | --- | --- | --- |
| Lab | `/` | What is running, what needs you, what just finished, what it cost | "Needs you" and the running experiments |
| Fields | `/fields`, `/fields/:jobId` | Each field: its skills, organizations (taught on, sealed, real), study brief, candidates, assets | The skill by organization grid of the best candidate |
| Experiments | `/experiments`, `/experiments/new`, `/experiments/:id` | Design a comparison (arms, seeds, caps), preregister it, run it, read it like a paper | The interval plot of each arm on each group |
| Models | `/models` | Every agent and version: base model, method, harness, adapter, scores seen / unseen / real, status; compare two | The registry table |
| Compute | `/compute`, `/compute/fields/:jobId[/:model]` | Where training runs: this computer, Hugging Face Jobs, a Slurm, Kubernetes or SkyPilot cluster; training plans with sizing and bundles | The plan's memory breakdown |
| Agents | `/agents/...` (existing chats) | Use a specialist | The chat |

The guided flow screens (Describe, Define, Train, Results, Improvement) keep their routes and their top stepper.

## The inspector

A right-hand panel (Hestia's pattern) on Define, on an experiment's design and on a model, with tabs:

- **Teacher**: the mentor model as tiles, reasoning effort, spending cap.
- **Student**: the student model and where it runs (this computer, hosted), decoding (temperature), context budget.
- **Teaching**: what the teacher may change (instructions, retrieval, helpers, weights, questions) as toggles, rounds, patience, the keep rule (margin on check tasks, the most a skill may lose, measuring again on new seeds).
- **Evaluation**: split sizes and seed, locked-test seeds and repeats, which organizations are sealed.
- **Budget**: Spark dollars, student dollars, compute dollars, wall clock, with meters.

Every control maps to a field the engine already validates (`packages/shared` job, evaluation and budget schemas). A control that would break an invariant does not exist (no switch that shows the mentor a sealed organization).

## Contract for the lanes

- New routes are added in `apps/desktop/src/renderer/src/lib/router.ts` and `app/App.tsx` by the foundation lane only; other lanes fill screens it creates as placeholders.
- New shared components live in `packages/ui` (Inspector with tabs, ChoiceTiles, ToggleRow with a type label, Meter, Card grid, IntervalPlot, DataTable with sorting and a sticky header) with tests and the design-rules test passing.
- Every screen reads stored records through the engine API; nothing is invented on screen. A missing measurement is shown as absent, never as zero.
- Hidden e2e and screenshots (`ARCHITECT_HIDDEN=1`) for every new screen, against the stand-in engine; each lane looks at its screenshots and fixes what reads badly, then a blind reader checks a set of them.

## Lanes

| Lane | Branch | Owns | Depends on |
| --- | --- | --- | --- |
| Foundation | `platform/foundation` | sidebar places, routes and placeholders, the new `packages/ui` components, the Lab home wired to existing data | none |
| Experiments engine | `platform/experiments-api` | the engine host API and IPC to plan, preregister, start, pause, stop and read comparisons from the app (wrapping the existing runner) | none |
| Experiments screens | `platform/experiments` | list, design (arms as tiles, seeds, caps, the inspector), live status, results as a paper | foundation, experiments engine |
| Models | `platform/models` | registry, compare two versions (harness diff and score deltas), promote and roll back through existing calls | foundation |
| Fields | `platform/fields` | field page: skills, organizations (add a generated or real one as sealed), study, candidates, assets and export | foundation, `scale/export` |
| Compute | `platform/compute` | targets, training plans with the sizing breakdown, bundles and commands, labeled experimental | foundation, `scale/targets` |
| Inspector on Define | `platform/inspector` | the inspector wired to the job's settings | foundation |
| Editions | `platform/editions` | the edition setting, welcome choice, Settings switch, and the shell, home, sidebar, palette and Describe offers following it | the screen lanes |

Then: a blind read of every new screen, a GPT-6 Sol review, the guide, the site and the film.
