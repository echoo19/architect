# Plan

Build window: Mon Oct 27 to Wed Nov 4, 9:00 PM ET. Dates follow `SPEC.md`. Each milestone lists the checks that must pass before it counts as done; a fresh-eyes review runs at the end of every milestone and its findings are fixed before the next one starts.

**Current phase: the expansion week (from Oct 28). `docs/EXPANSION.md` holds its plan and requirement checklist; `docs/SPEC_EXPANSION.md` is the governing spec.**

## Phase 0. Foundations (Mon Oct 27)

- Repo, docs, licence, CI (typecheck, lint, unit tests, build) on GitHub Actions.
- pnpm monorepo: `apps/desktop`, `packages/{shared,engine,adapters,harness,ui}`, `examples/`.
- Design tokens from the design canvas in `packages/ui` (dark and light), base components, app shell that opens.
- Contracts in `packages/shared`: job, task, split, checker result, attempt, trace, harness, change, lineage entry, round, budget, run events, adapter interfaces.
- Day-one feasibility, recorded in `docs/PROGRESS.md`: Glimmer speed and memory on this machine, Meta Model API key, bare-student pass rate on the sample job.
- Sample job proposed in `docs/DECISIONS.md`.

Acceptance: CI green on `main`; `pnpm dev` opens a themed window; feasibility numbers written down; any failed check has its fallback applied and reported.

## Phase 1. Core loop and baselines (Tue Oct 28 to Sat Oct 31)

**M1 (Oct 28). Runner and sample job.** Data generator (seeded), task generator with ground truth, deterministic checker, splitter with the vault, student agent loop with built-in data tools, sandboxed tool host, Ollama and OpenAI-compatible student adapters, SQLite storage.
Checks: splitter and vault tests (mentor-facing APIs cannot reach test), checker determinism tests, bare-student pass rate measured on real Glimmer.

**M2 (Oct 29). Vertical slice.** Mentor adapter (Meta Model API), diagnosis and harness edits, keep or revert on dev, lineage, budget caps, locked test with the mentor disconnected, graduate folder, one workspace chat with the graduate. Ugly UI is fine.
Checks: one real run end to end on the sample job; keep/revert, budget-cap and harness round-trip tests; lineage entries carry cause, prediction and measured effect.

**M3 (Oct 30). Training view and report card.** Engine in a utility process with an event stream; live rounds, traces, diffs, dev curve; pause, resume, stop; resume after app restart; report card with per-type results, latency, cost, refusals, top interventions, lineage; accept graduate.
Checks: kill the app mid-run and resume; screens match the design in dark and light.

**M4 (Oct 31). Baselines and comparison mode.** Bare student, one-shot guide, self-reflection on the same job, budget and seed; comparison table and curves behind a setting.
Checks: all four methods run on the sample job. If the loop has no dev curve by tonight, cut the second task family and spend the time on runs.

## Phase 2. Main runs and the workspace (Sun Nov 1 to Mon Nov 2)

**M5 (Nov 1). Main runs and workspace core.** Four methods, seeds as budget allows, every run reported. Workspace: streaming steps, tool calls and results, write diffs with approve or reject, guardrail refusals with reasons, status bar, several graduates in the sidebar.
Checks: offline test passes (graduate makes no non-local calls); workspace works with networking disabled.

**M6 (Nov 2). First run, job setup, settings.** Onboarding (find Ollama, pull the student, connect a mentor, test each), the Describe, Clarify and Define flow with the full job form under Advanced (tasks upload, checker, requirements, budget, mentor, student, starting harness), settings with keys in `safeStorage`, command palette and shortcuts.
Checks: a fresh profile reaches a trained graduate without a terminal.

## Phase 3. Polish and proof (Tue Nov 3)

- Visual QA: Playwright screenshots of every screen, dark and light, compared with the design; fix drift.
- Playwright end to end through all four stages.
- Installers (Windows, macOS) on a GitHub release.
- README results: comparison table, pass-rate curve, cost, failure cases, related work.
- Fresh-eyes review of the whole repo.

## Phase 4. Ship (Wed Nov 4)

- Demo video (3 minutes) on the live product; `docs/HACKATHON.md` checklist complete.
- Final CI run green; submission ready by early afternoon ET, well before 9:00 PM.

## Stretch, in order (only after the core loop produces a curve)

1. Claude Code as a mentor (headless, edits the harness folder directly).
2. A second student for side-by-side comparison.
3. Lineage explorer.
4. A second task family.
