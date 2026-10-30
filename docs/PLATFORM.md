# Architect as an R&D platform: the plan

Adopted on Oct 30 at the owner's word: Architect becomes a full research and development platform for founders, researchers and scientists who build field-specific models. It keeps one clear flow, adds the controls such people expect, and stays beautiful and smooth. Its visual language extends `docs/DESIGN.md` and takes after Hestia (`C:/JakeOS/projects/hestia`): a calm home of cards with a "Needs you" panel, a side inspector with tabs, icon tiles for choices, toggles with their type on the right, Undo toasts. No signs of generated design: no gradients, glows, emoji, sparkle icons, pill clouds, eyebrows, captions that repeat the layout, or stacks of identical cards.

## The flow stays the spine

Describe a field → Study and define it → Teach → Qualify → Use. Everything new hangs off that line. A newcomer can follow it without opening anything else; an expert finds every control one step away, in an inspector or on a page of its own.

## Places (sidebar, icon-led, in this order)

| Place | Route | What it is for | Focal point |
| --- | --- | --- | --- |
| Lab | `/` | What is running, what needs you, what just finished, what it cost | "Needs you" and the running experiments |
| Fields | `/fields`, `/fields/:jobId` | Each field: its skills, organizations (taught on, sealed, real), study brief, candidates, assets | The skill by organization grid of the best candidate |
| Experiments | `/experiments`, `/experiments/new`, `/experiments/:id` | Design a comparison (arms, seeds, caps), preregister it, run it, read it like a paper | The interval plot of each arm on each group |
| Models | `/models` | Every agent and version: base model, method, harness, adapter, scores seen / unseen / real, status; compare two | The registry table |
| Compute | `/compute` | Where training runs: this computer, Hugging Face Jobs, a Slurm or Kubernetes cluster; training plans with sizing and bundles | The plan's memory breakdown |
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

Then: a blind read of every new screen, a GPT-6 Sol review, the guide, the site and the film.
