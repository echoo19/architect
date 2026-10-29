# Architect: rules for agents working in this repo

Start every session by reading, in order: this file, `docs/PROGRESS.md`, `docs/PLAN.md`, `docs/EXPANSION.md`, and `git log -20`. The product spec is `SPEC.md`; since Oct 28 the owner's expanded spec, `docs/SPEC_EXPANSION.md`, governs scope where they differ, and `docs/EXPANSION.md` tracks its requirements with evidence. Design decisions are in `docs/DECISIONS.md`.

## What this is

A desktop app (Electron, React, TypeScript). A **mentor** model watches a **student** model attempt a job, diagnoses its failures, and edits the student's **harness** until the student passes a locked test on its own. The result, a **graduate** (pinned model + harness folder), runs offline in the app's agent workspace.

In code and docs say `mentor` and `student`. The UI shows the chosen model's short name (for example "Spark", "Glimmer").

## Invariants

These are enforced in code and covered by tests. Never weaken one to make something else pass.

1. **The mentor never sees the locked test split.** No path, no content, no scores before graduation. Only the runner's vault (`packages/engine/src/vault`) reads or writes it.
2. **The checker is deterministic**, and the mentor cannot edit the checker, the splits, the student weights, or the tool permissions.
3. **A graduate makes zero network calls** except to the local model runtime. The offline test must keep passing.
4. **Mentor-written tools run sandboxed** (QuickJS inside a child process), limited to the job's declared data and permissions. Writes need user approval in the workspace.
5. **Every harness change is logged in lineage** with the failure that caused it, the predicted effect and the measured effect, and every change can be reverted.
6. **Budgets are hard caps**: rounds, mentor dollars, wall clock.

## Layout

```
apps/desktop          Electron main, preload, renderer (React)
packages/shared       types and zod schemas: the contracts every package builds against
packages/engine       runner, core loop, checker contract, splits and vault, lineage, budgets, baselines, storage
packages/adapters     mentor adapters (OpenAI-compatible, Meta, Spark Open self-hosted) and student adapters (Ollama, OpenAI-compatible)
packages/harness      harness and graduate folder format: read, write, validate, diff, version
packages/ui           component library and design tokens; every screen uses it
examples/             the sample job: data generator, tasks, checker
site/                 the public landing page: one static page, its mocks built from packages/ui
trainer/              the pinned QLoRA recipe a remote training job runs (Python), with its GGUF conversion
docs/                 plan, progress, architecture, decisions, models, harness format, gotchas
```

## Commands

```
pnpm install        install everything
pnpm dev            run the desktop app in development
pnpm test           unit tests (Vitest) across packages
pnpm typecheck      tsc across the workspace
pnpm lint           ESLint + Prettier check
pnpm build          build all packages and the app
pnpm e2e            Playwright end-to-end run against the built app (hidden windows)
pnpm package        build the installer for this platform into apps/desktop/release
pnpm e2e:packaged   the packaging specs against the unpacked packaged app (hidden)
pnpm check          typecheck, lint and tests; run it before every commit and read its exit code
```

## Conventions

- TypeScript strict everywhere. Data that crosses a process or file boundary is parsed with the zod schemas in `packages/shared`.
- Import other packages by name (`@architect/shared`), never by relative path across packages.
- UI: build screens only from `packages/ui` components and theme tokens. No one-off hand-styled screens.
- Errors are typed and shown to the user with a way to recover. Never swallow an error.
- Model ids live only in `docs/MODELS.md` and `packages/shared/src/models.ts`.
- No dead code, no commented-out blocks, no TODOs in core flows.
- Tests and screenshots run with hidden windows (`ARCHITECT_HIDDEN=1`). Never pop windows on the developer's desktop.

## Commits

- Conventional style, imperative, specific: `feat(engine): revert harness change when dev pass rate drops`.
- One coherent unit per commit. Short-lived branches for bigger pieces, merged with a summary.
- Real timestamps and authorship. Never backdate, rewrite or squash history into something it wasn't.
- `main` always builds, typechecks, lints and passes tests.
- Update `docs/PROGRESS.md` at the end of every working block.

## Never

- Commit secrets or `.env` files, or print a key's value.
- Read, copy or edit the locked test split outside the vault.
- Let a graduate or the workspace construct a mentor adapter or reach a non-local host.
- Add a Meta model that has no job in the product.
- Put event names, judging terms or prize names in product UI, code or comments. That context lives only in the README's "Built during" section and `docs/HACKATHON.md`.
- Copy code from other projects. Everything here is written in this repo.
