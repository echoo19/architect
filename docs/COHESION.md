# Cohesion: one product across every place

A read-only audit on Nov 1 (all 207 screenshots, the routes, the places' code) found that the parts look like one product but the joins don't yet: words drift between screens, the CLI and the engine's prose, and places lead back into the guided flow rather than to each other. This page is the fix list; each item is struck when it lands.

## One word per idea

| Keep | Replace |
| --- | --- |
| check tasks | dev, dev tasks (Assets, comparison notes, CLI text) |
| final test | locked test, never-seen evaluation, "of new tasks right" on a field job (say "on the final test, organizations it was taught on") |
| never seen (with "real" as a qualifier) | sealed, it never trains on, never taught on; the Fields "Never seen" count excludes real organizations, as Models does |
| taught on | trained with, practises on, organizations it was taught on |
| agent (what you use), version (each build), candidate (a status: a version not in use) | graduated; the Field page's "Candidates" tab becomes "Versions" |
| Spark, Glimmer (or the chosen models' names) | teacher, student, Bare student ("Glimmer alone"), no teacher ("no Spark"), Runs the student ("Runs Glimmer") |
| field (Lab), job (personal edition) | "Open the job" on a field page ("Edit field"), "Couldn't load your jobs" ("your fields") |
| the job's own noun for an organization (`organizationNoun`) | hard-coded "academy" in `flow/define/Recordings.tsx` and `StudyReview.tsx` |
| training (to the person) | run (keep internal) |

## Places that lead to each other

1. ~~Results in the Lab: "Open in Models" and "Open field"; Close returns to the field it came from (`ReportScreen.tsx`, `FlowShell.tsx`).~~
2. ~~Model panel: "Open chat" and "Open results" (`ModelPanel.tsx`).~~
3. ~~Lab: an Experiments card; running experiments under Running and a paused one ("needs funding") under Needs you (`lab/cards.tsx`, `lab/items.ts`).~~
4. ~~Experiment results: each arm links to its run's report and version (`experiments/Results.tsx`).~~ An arm's run lives in the experiment's own records, not the app's, so Table 4 opens it in a drawer (its rounds, check tasks and frozen harness version) rather than on the Results screen.
5. ~~Compute's bundle: "Use the latest export of…" with a field picker; Assets' export toast links to Compute (`compute/BundleCard.tsx`, `fields/Assets.tsx`).~~ The picker lists the exports written since Architect started: a folder from an earlier session must be chosen again (the main process opens only folders the person chose).
6. ~~One way to start a field: the Lab's "Describe a field" (card and empty state) calls the same `newField()` as Fields (`lab/cards.tsx`, `LabScreen.tsx`).~~
7. ~~Field page rows ("Versions") open Models with that version's panel open (`fields/Candidates.tsx`, a `paths.models` key).~~ A version no agent holds yet opens its results.
8. ~~Back links: field page → Fields; Train and Results → their field.~~
9. ~~Qualifying lives in four places (Organizations → Qualify, Models → Certify, Compute → Qualify a trained model, `architect certify`): keep them, but every result shows on the version's panel in Models.~~

## One look

- One score format: "83% · 30 of 36" in rows, "30/36" only inside grids, no decimals (`lib/format.ts`, `experiments/NumberRow.tsx`).
- Unmeasured cells show "–" read as "None" (`flow/report/Organizations.tsx`).
- One error pattern (`ProblemState`): drop the red filled banner (`flow/define/RuleReview.tsx`).
- Pills only where they carry a state; "New field" and "New experiment" alike (both with or both without an icon); Stop the same in Train and Experiments.
- No eyebrow labels ("Spark's finding").
- Fix the clipped "Go back to this version", the stray scrollbar on export dialogs, a toast covering Start training.
- Stand-in data that agrees across screens (Service desk never shows academies; the same rounds count the same).

## The personal edition

- The Define inspector's Evaluation tab hides Certified answers unless the job already has one.
- No academy words in Study for other jobs (fixed by the job's noun above).

## Docs

- `docs/SCALE.md`: "Where it shows" names Fields → Assets and Compute, not a Scale page.
