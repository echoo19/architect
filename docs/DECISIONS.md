# Decisions

Short records of choices that aren't obvious from the code. Newest last. Each has the context, the decision, and what follows from it.

## 001. Electron, Vite and React for the desktop shell

**Context.** The spec allows Tauri or Electron with a Next.js UI. The engine, adapters and UI are all TypeScript, and end-to-end tests need to drive the real app.
**Decision.** Electron with electron-vite, React and Tailwind. No Next.js: there is no server to render, and Vite keeps main, preload and renderer builds in one tool.
**Consequences.** One language across the stack; Playwright's Electron support drives end-to-end tests. Larger installers than Tauri would give.

## 002. TypeScript 6.0, not 7.0

**Context.** TypeScript 7.0 (the native compiler) is current, but typescript-eslint 8 supports TypeScript below 6.1.
**Decision.** Pin TypeScript 6.0.x across the workspace.
**Consequences.** Revisit when typescript-eslint supports 7.x.

## 003. Engine and agent hosts run in separate utility processes

**Context.** Training runs for hours and must survive renderer reloads and app restarts. Graduates must never reach the network, while training must reach the mentor.
**Decision.** Training, evaluation and storage run in an engine host (Electron `utilityProcess`). Workspace sessions run in a separate agent host that never imports mentor adapters and installs a loopback-only network guard at startup. Both are plain Node modules wrapped by thin Electron entries.
**Consequences.** Clear process boundary for the offline guarantee; the full loop is testable under Vitest without Electron. Events cross processes over MessagePorts, so event payloads are schema-checked.

## 004. Mentor-written tools run in QuickJS inside a child process

**Context.** The mentor writes helper tools that the student calls. They must not touch the network, the file system outside the job's declared data, or other processes.
**Decision.** Each tool call runs in a fresh QuickJS VM (quickjs-emscripten) inside a sandbox child process. The VM gets only a data API for the job's declared files and permissions, plus time and memory limits. Tools are read-only; writes go through built-in write tools that need approval in the workspace.
**Consequences.** No native modules, same behavior on Windows and macOS, deterministic execution (no clock or randomness inside the VM). Tools are plain JavaScript functions, so the mentor can't use npm packages.

## 005. Sample job: the closing routine of a home-services office

**Context.** The sample job must show the product end to end, be deterministic to check, leave room for a learning curve, and stay clear of medical, education, basic RAG and political topics.
**Decision.** Ferncliff Home Services, a fictional plumbing, heating and electrical company with about 12 technicians and 400 customers. A seeded generator writes its records as CSV files plus a short policy document (pricing, tax, payment terms, scheduling rules). The agent, named "Service desk", handles three workflows:
- **Invoices.** Price a completed job: labor by technician tier, parts at markup, trip fee, after-hours multiplier, plan-member discount, city tax, all in integer cents with the rounding rules stated in the policy. Checked by end state: the created invoice's line items and total.
- **Overdue balances.** Find invoices past terms after partial payments, totals per customer, oldest balance. Checked by exact structured answer (ids and cents).
- **Scheduling.** Find the earliest start for a job that needs a skill or license in a zone, given working hours, existing bookings and a fixed zone travel matrix, with fixed-duration slots. Checked by end state: the booking is feasible and starts at the global earliest time; ties between technicians are all accepted.

The bare student gets the same policy document and the same primitive tools as every other method. What the mentor can improve is orchestration: reading the policy, applying rules in order, writing tools for steps it keeps getting wrong. Answers are structured, not free prose. Inventory and plan renewals wait as a possible second task family.
GPT-6 Astra reviewed the first draft (five task types) and recommended cutting to these three, bounding scheduling, using integer cents and avoiding fact-matching on prose. Adopted.
**Consequences.** One coherent story ("close out today: invoices, overdue balances, tomorrow's urgent call"). Fixtures get hand-audited against independently calculated answers before any training run, because a bug shared by the generator and the checker would be invisible otherwise.

## 006. What the mentor can see

**Context.** Keep-or-revert decisions use dev, and showing the mentor dev traces would let it tune to dev the same way it tunes to train.
**Decision.** The mentor sees train traces with checker reasons, per-type train results, dev pass counts overall and per task type, and the lineage. It never sees dev traces, dev task ids or dev checker reasons, and never anything from the test split.
**Consequences.** Dev still leaks a little through aggregate scores (adaptive overfitting), so the number of candidate revisions per run is capped and the report shows the dev to test gap.

## 007. One hypothesis per round, kept on a margin

**Context.** The spec allows "one or a few" changes per round. Measuring each change separately costs a full dev evaluation each, and a slow local student makes that expensive.
**Decision.** Each round the mentor proposes one hypothesis: a change set that may touch several files but serves one diagnosis, with a predicted effect. Dev evaluation runs with temperature 0 and a fixed seed. The change set is kept only if net dev passes rise by at least the job's margin (default: 2 tasks, or 5% of dev if larger) and no task type loses more than one pass. Otherwise it is reverted and logged as a failed hypothesis.
**Consequences.** Clean attribution in the lineage. Kept changes are an engineering gate, not a significance test, and the README says so.

## 008. Answers end with a structured line

**Context.** The checker must parse answers deterministically, and free-text fact matching is fragile.
**Decision.** Task prompts ask the agent to finish with one line `ANSWER: <json>`, where the JSON shape is stated per task type. Write tasks are checked on the end state of the job's scratch data instead.
**Consequences.** Format failures count as failures (the policy and task text state the format, so formatting is part of the job). The workspace uses the same harness without the answer line requirement.

## 009. The locked test runs on the local student

**Context.** Training may use a hosted copy of the student for speed during development.
**Decision.** The locked test always runs on the student runtime the graduate will use in the workspace (Ollama on this machine by default), with the mentor adapter disposed.
**Consequences.** The report card describes the agent the user will actually run.

## 010. Job setup follows the design's conversation, with every field editable

**Context.** The design starts a job as a conversation (Describe, then the mentor's clarifying questions, then a review screen). The spec lists the job fields as one setup form.
**Decision.** Follow the design: describe the job and attach files, answer a few clarifying questions from the mentor, then review the drafted job on the Define screen. Every spec field (tasks, checker, requirements, budget, mentor, student, starting harness, permissions) is editable there under Advanced, and a job file can be imported directly.
**Consequences.** Drafting a job costs a few mentor calls. The saved job file is the same either way.

## 011. Where the design shows more than this version builds

**Context.** The design includes exporting a fine-tuned adapter (`.safetensors`) and training on a "Cloud GPU".
**Decision.** No weight training in this version, so the export offers the graduate folder and the report instead of an adapter. "Cloud GPU" means a hosted endpoint for the student during training.
**Consequences.** The LoRA comparison stays on the stretch list in the spec.

## 012. MIT licence

**Context.** The repository is public and should be reusable.
**Decision.** MIT.
**Consequences.** None beyond the licence text.

## 013. SQLite through `node:sqlite`, not better-sqlite3

**Context.** The brief's default is better-sqlite3, a native module that must be rebuilt for Electron's ABI, which also breaks running the same code under plain Node for tests.
**Decision.** Use the built-in `node:sqlite` (`DatabaseSync`). Electron 45 ships Node 24.22, and a check on 2026-10-27 confirmed `node:sqlite` works inside Electron and in Node 24.
**Consequences.** No native modules in the app, no rebuild step, and tests use the same storage code as the app. The module is still marked experimental in Node, so storage stays behind a small interface in `packages/engine/src/store`.
