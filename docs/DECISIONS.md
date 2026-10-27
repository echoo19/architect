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
**Decision.** The mentor sees train traces with checker reasons, per-type train results, the overall dev pass count, and its earlier hypotheses with their keep or revert decision and overall dev change. A round rejected before dev saw it (a reply that isn't a hypothesis, or a change set the harness refuses) is listed too, with the runner's reason, which is about the mentor's own reply and files. It never sees per-type dev counts, dev traces, dev task ids or dev checker reasons, and never anything from the test split. (Per-type dev counts were in the first version of this decision; GPT-6 Astra pointed out they are an extra channel for tuning to dev, and train results already show which types fail.)
**Consequences.** Dev still leaks a little through the overall score and the decisions (adaptive overfitting), so rounds per run are capped in advance and the report shows the dev to test gap.

## 007. One hypothesis per round, kept on a margin

**Context.** The spec allows "one or a few" changes per round. Measuring each change separately costs a full dev evaluation each, and a slow local student makes that expensive.
**Decision.** Each round the mentor proposes one hypothesis: a change set that may touch several files but serves one diagnosis, with a predicted effect. Dev evaluation uses Meta's recommended sampling for Glimmer (temperature 1.0, top_p 0.95, top_k 64; greedy decoding makes it repetitive). The runner, not the harness, owns the sampler seed. Each round draws its dev seeds from the run's panel seed and evaluates both the candidate and the incumbent on them, so the incumbent is measured again instead of being judged by the score that got it kept, which was the luckier of its draws. Sharing seeds does little against noise: at temperature 1 any change to the prompt re-samples every dev task, so the two results are close to independent draws. What shared seeds do is stop a change from choosing its own seeds and make every number reproducible. The guard against noise is repetition and the margin. With `devRepeats` (1 to 3, default 1) every dev task runs under that many seeds and passes add up across them. The change set is kept only if net dev passes rise by at least the job's margin times the repeat count (default margin: 2 tasks, or 5% of dev if larger) and no task type loses more than one pass per repeat; otherwise it is reverted and logged as a failed hypothesis. Before main runs, the noise pilot (`devNoisePilot`) evaluates one harness on dev under three student seeds and reports how far the score moves; if noise alone moves it by the margin or more, raise `devRepeats`, the margin or the dev set.
**Consequences.** Clean attribution in the lineage. A round evaluates dev twice per repeat, once for the candidate and once for the incumbent, so it costs 2 × `devRepeats` × the dev tasks in attempts, on top of the train batch. Kept changes are an engineering gate, not a significance test, and the README says so.

## 008. Answers end with a structured line

**Context.** The checker must parse answers deterministically, and free-text fact matching is fragile.
**Decision.** Task prompts ask the agent to finish with one line `ANSWER: <json>`, where the JSON shape is stated per task type. Write tasks are checked on the end state of the job's scratch data instead.
**Consequences.** Format failures count as failures (the policy and task text state the format, so formatting is part of the job). The workspace uses the same harness without the answer line requirement.

## 009. Where training and the locked test run

**Context.** On this machine the local student needs 2 to 3 minutes per task (measured 2026-10-27), so a full comparison (four methods, three seeds) can't be optimized locally in the time available. A hosted copy of Glimmer is much faster.
**Decision.** Training rounds and dev evaluations may run on a hosted copy of the student. Every graduate is frozen before any test runs, and test results never trigger another round. The graduate the app ships, and one predeclared seed of every method, are locked-tested on the local student after the mentor is released: its gate closed, so no call can start, and its adapter dropped. Hosted locked tests cover every seed as supplementary results. GPT-6 Astra reviewed this and preferred local tests for every seed; that stays the goal if GPU time allows.
**Consequences.** The report card of a shipped graduate describes the agent the user actually runs. The README states, for every number, the provider, precision, runtime and seed it came from, and says plainly that optimization happened on a hosted copy.

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

## 014. Mentor tier for the sample job's runs

**Context.** The Meta Model API has a standard tier ($1.25 in, $4.25 out per million tokens) and a contributor tier ($0.10 in, $0.20 out) whose content Meta may use for training and which must not carry sensitive or personal data. The app defaults to the standard tier and shows the tier as a setting.
**Decision.** Development and debugging runs on the sample job use the contributor tier: its data is generated and fictional. The comparison runs reported in the README all use one tier, the standard one, so the reported cost matches what a user with real data would pay.
**Consequences.** Spend stays small (a mentor round costs well under a cent on the contributor tier and a few cents on the standard tier). The README says which tier produced each number.

## 015. Glimmer runs with low reasoning strength

**Context.** Glimmer always reasons; Ollama's `think: false` hides the reasoning but may not stop it. Meta measured 1,811 completion tokens for one agent decision at the default `high` strength and 256 at `low`. On this machine the 30B model generates only a few tokens per second.
**Decision.** Harnesses default to `thinking: low`, and the mentor may raise it per harness through `decoding.yaml` like any other decoding setting.
**Consequences.** Several times fewer tokens per step. If low reasoning caps what the student can do, a kept change that raises it will show up in the lineage with its measured cost in latency.

## 016. Harness files are strict

**Context.** Harness folders are written by a model and read back by the runner, the workspace and other people's tools. A silently ignored typo (`max_step` instead of `max_steps`) would make a change do nothing while the lineage claims it was tested.
**Decision.** Unknown or misspelled keys in any harness or graduate file are validation errors with a "did you mean" hint. On-disk keys are snake_case everywhere (YAML, `lineage.jsonl`, `report.json`). Skills, tools and examples are ordered by slug; a tool's file name must equal its `name`; Windows device names (`con`, `nul`, `com1`...) are refused as names; symlinks and OS clutter files are ignored when reading. A version folder only counts once its `harness.yaml`, written last, exists, and loading fails if the files no longer match the saved hash. Graduate folders carry the report card twice: `report.json` for the app and `report.md` for people.
**Consequences.** A mentor edit with a typo is rejected and logged as a failed round instead of being kept as a no-op. Folders written on one platform read identically on another.

## 017. Small departures from the design for accessibility and robustness

**Context.** Matching the design exactly occasionally conflicts with readable contrast or Electron's behaviour.
**Decision.** Muted text is `#7F7F87` instead of the design's `#7E7E86`, which reached only 4.48:1 on the composer; a test keeps every readable text color at 4.5:1 or better in both themes. The theme setting drives Electron's `nativeTheme`, and the page copies the resulting `prefers-color-scheme` onto `<html data-theme>`, so there is one source of truth and no flash on launch. IPC handlers reply with `{ ok, value }` or `{ ok: false, error }` because Electron mangles errors thrown across IPC; the preload turns a failure back into an `Error` with the original message. Settings rows from the design that have no setting behind them yet (open at login, privacy toggles) are replaced by real ones: mentor tier, mentor reasoning, comparison mode, and read-only privacy facts.
**Consequences.** The look is unchanged to the eye; every visible control does something.

## 018. How the sample job's data avoids shortcuts

**Context.** The mentor sees train tasks with their expected answers. Any answer value shared by many tasks (train and test alike) would let it hard-code that value and look like it taught something.
**Decision.** Every id in an answer follows from the task's own record: invoices take their job's number (job W-2482 gets INV-2482) and bookings take their request's number (R-3042 gets B-3042). The first draft numbered invoices after the highest existing one, which made all 60 invoice tasks expect the same id; it was changed before any training run. The records are a snapshot as of Thursday 2026-11-05 (`businessDate` on the job), with the office closed on Wednesday 2026-11-11. The checker works out the earliest scheduling slot itself from the original tables, an implementation independent of the generator's reference code. Values that repeat by rule (the issue date, a few due dates and trip fees) remain, and so do some scheduling slots (27 distinct slots across 60 tasks, the most common one answering 7); none of them passes a task on its own, because the checker validates feasibility and every field.
**Consequences.** A harness that memorizes answers scores close to nothing on unseen tasks. The README notes the repeated scheduling slots as a limitation of one task family.

## 019. How a graduate behaves in the workspace

**Context.** The workspace is where people use a graduate every day; its rules for writes, refusals and interruptions need to be predictable.
**Decision.** A graduate's write mode is its saved setting, falling back to the job's `permissions.writes`. "Always allow" saves `allow`; in `allow` mode the diff still appears in the chat, marked approved, so every change stays visible. A refusal is decided before the student is called and shows the reason from the guardrails. Stopping a reply marks running steps stopped and pending writes denied; a reply interrupted by a restart comes back as an error when the graduate is reopened. History sent to the student is the last 12 messages that fit in a quarter of its context. The workspace's data lives in its own folder per graduate (`<userData>/workspace/<graduateId>/`), seeded from a copy of the job's data, so workspace writes never touch training data. The agent host runs behind a loopback-only network guard and refuses any student endpoint that isn't on this machine; the tool sandbox's child process has no network APIs at all (QuickJS), so it needs no guard of its own.
**Consequences.** Every write a graduate makes is visible and reversible at the moment it happens, and the offline guarantee is enforced by the process, not by convention.

## 020. Sixteen model turns per request by default

**Context.** The first calibration on local Glimmer (15 calibration tasks, blank harness, 2026-10-27) passed every overdue task (5/5) and failed every invoice and scheduling task (0/10). The traces showed why: Glimmer makes one tool call per turn, and the write tasks need about ten reads (job, customer, technician, rate, parts, prices, tax, policy; or the request, technicians, three pages of bookings, travel) before they can compute and write. Every write attempt hit the 8-turn limit while still reading. Its tool use up to that point was sound.
**Decision.** The default `max_steps` is 16. The mentor can still change it in a harness like any decoding setting.
**Consequences.** Bare failures now come from what the student gets wrong, not from a cap it can't see. Write attempts take longer on a local student (each turn is about 17 seconds), which makes a hosted student more important for training runs.

## 021. One bounded revision of the sample job, then a freeze

**Context.** On hosted Glimmer with a blank harness, the first version of the sample job scored 34/45 on dev (76%: invoices 9/15, overdue 13/15, scheduling 12/15) against an 85% requirement. That leaves little room for any method, and a mentor that only reads the policy would likely write the same invoice tool Architect found in its first round, so the comparison could show nothing about the value of watching attempts. GPT-6 Astra advised one bounded revision with realistic complications and no hidden rules, then a freeze, keeping the first version as a secondary benchmark.
**Decision.** Version 2 (`examples/home-services/job/`, the sample the app ships) adds overdue questions over groups of customers (a city, or a zone narrowed to plan members or one payment term; 5 to 60 customers), which a careful agent answers in a few filtered reads while a lazy 50-row read silently truncates; morning and afternoon windows for scheduling requests; and paired boundary cases inside the existing rules (labor minutes on and just past a quarter hour, invoices due today versus yesterday, payments dated today versus tomorrow, a slot that travel to the next booking invalidates). Every rule is in the policy with a worked example, the reference answers use only the student's own tool operations and limits (at most 4 reads for any overdue question), and no answer value is right for more than three tasks of a type. Version 1 stays byte for byte in `job-v1/`. Both are frozen from here: no further changes before the comparison runs.
Measured after the revision, same student and blank harness: dev 36/45 (80%: invoices 9/15, overdue 14/15, scheduling 13/15) and calibration 11/15. The estimate had been about 52%; Glimmer handled the group questions and the windows well, and invoices still fail mostly by running out of turns while pricing line by line. Following the same advice (don't keep hardening until a method wins), the tasks stay as they are.
The readiness bar is raised from 85% to 95% for both versions, before any comparison ran. These tasks write invoices and bookings into a business's records; one wrong row in seven is more than an office would accept from an assistant, and one in twenty is about the most it would.
**Consequences.** Comparison results are reported on version 2, with version 1 as a secondary result. Changing the tasks after seeing how the methods do would bias the comparison, so it doesn't happen. With the bare student near 80%, the room for any method is the last 15 points and the time per answer, so the README reports latency and turns per task alongside pass rates.

## 022. A change that clears the keep check is measured again before it's kept

**Context.** Before the comparison runs, a noise pilot ran the sample job's starting harness on all 45 dev tasks three times under different student seeds (hosted Glimmer, its recommended temperature 1): 39, 33 and 36 passes, with 14 tasks changing outcome between runs. A second pilot at temperature 0.6 gave 37, 38 and 34 with 15 tasks flipping, so lower temperature brought no clear benefit and decoding stays at the model's recommended settings. Pooled over the six runs, 21 of the 45 tasks are unstable and one dev run's score has a standard deviation of about 2.3 tasks; invoices carry most of it (11 of 15 unstable). Simulating the keep check with those per-task pass rates, a change that does nothing cleared the old rule (+2 net dev passes, no type down more than one, one run each) about 28% of the time.
**Decision.** A change that clears the limits on its first measurement has both versions measured again on dev under new seeds, the round's next `devRepeats` seeds, and is kept only if the totals over both measurements clear the limits for twice the runs (+4 net, no type down more than two, with one repeat). The second measurement needn't clear the limits alone. Changes that miss on the first measurement are reverted without the second, so the extra cost falls only on promising changes. The per-type limit stays at one per run: loosening it to two raised the share of kept trade-offs (one type up, another down) from about 9% to 22% in the same simulation. Patience for the sample job rises from three to four reverts in a row, since a real three-task gain now clears the check only about half the time. The same rule serves Architect and self-reflection.
In simulation with the pilot's task pass rates, a do-nothing change is kept 11 to 15% of the time (depending on whether rates come from one pilot or both and whether they are smoothed), a change worth about 4.5 tasks 78 to 83%, and one worth about 2 tasks 43 to 47%; each round runs 2 to 4 dev measurements of 45 tasks instead of 2. GPT-6 Astra reviewed the rule before it was built and agreed, with three conditions this follows: store both measurements (lineage and rounds keep `firstMeasurement` beside the pooled scores), call kept effects selection-conditioned dev estimates, and plot pass rates rather than mixed totals.
**Consequences.** The 13% figure is a per-proposal estimate from a small pilot, not an experiment-wide error rate; kept changes' measured effects still lean upward because the same measurements decided to keep them, and dev curves reflect repeated use of one dev set. Claims about methods rest on the locked test. Dev scores can now have different totals within a run (45 or 90 with one repeat), so anything that compares them uses rates or per-run counts.

## 023. One fix for a reply the runner can't use

**Context.** The first comparison run of the one-shot baseline lost its only reply to a format slip: Spark wrote its worked examples with `args` where the harness format says `arguments`, and left out `tool_call_id` on tool turns. The change set was refused, so the "one-shot" result would have been the blank starting harness: a measure of one formatting mistake, not of writing a harness without watching the student. Architect and self-reflection lose a whole round to the same kind of slip, and two refused rounds in a row end training.
**Decision.** When the runner can't use a reply (it isn't a hypothesis, or the harness refuses its change set), the round's author gets the same request again followed by its own reply and the runner's reason, and one more answer. If that can't be used either, the round is rejected as before. The fix adds nothing but the refusal reason, so the one-shot author still never sees an attempt, and every method gets exactly the same chance. The fix call is charged to its round and saved beside the first (`mentor/round-<n>-fix-1.json`); the stored reply records whether it is a fix, so a restart never asks twice. The mentor's guide to the harness now shows the exact shape of each example message.
**Consequences.** A round can cost two author calls. Comparison runs started before this was in place are discarded and run again.

## 024. A tool may name a data file without its extension

**Context.** In the restarted seed 1, Spark's one-shot harness called `ctx.readTable("jobs")` in its pricing tool, and the file is `jobs.csv`. The mentor's guide said `ctx.readTable(name, ...)` without saying the name keeps its extension, so the tool failed on every call and the student spent its steps retrying it: dev fell from 38/45 to 15/45. The student can correct a wrong file name after the error message; a tool's code can't, and one-shot never sees an attempt.
**Decision.** In the sandbox, a name that isn't a file but is exactly one file's name without its extension refers to that file. The mentor's guide now describes `ctx` precisely: file names as listed, rows as objects keyed by column with text values and null for empty cells, every matching row unless a limit is passed, and the same filters as `read_table`. The student's own tools still take exact names.
**Consequences.** The runs of that start were discarded and seed 1 began again with this in place.

## 025. A change set's tools must load before it is measured

**Context.** The same one-shot harness had a second tool, `find_slot`, with a typo (`var start Day=null;`) that no JavaScript engine parses. Every scheduling task called it, got a syntax error back, and ran out of steps. A tool that doesn't load is as detectable before any task runs as a malformed example file, and it costs Architect a whole measured round to find out from traces.
**Decision.** When a change set adds or edits a tool, the runner loads the tool's code in the sandbox before measuring anything: only the code's top level runs, the tool isn't called and sees no data. A tool that doesn't load (a syntax error, no `run`, a top level that throws or runs too long) makes the change set unusable, with the reason and line, so the author gets its one fix (decision 023). The sandbox now reports the line of a syntax error too.
**Consequences.** All methods get the same check. A tool that loads but computes the wrong thing is still found only by attempts, which is what the comparison is about.

## 026. A blank start begins with a whole draft, and the comparison shares it

**Context.** The one-shot baseline is there to test whether watching the student adds anything (SPEC). Architect started from the job's starting harness, which is blank for the sample job, and made one change per round, so within eight rounds it built a whole harness piece by piece while one-shot wrote one in a single reply. In seed 1, with decisions 023 to 025 in place, Spark's one-shot draft took dev from 35/45 to 45/45. A loss to that baseline would then say "writing piece by piece is slower" as much as "watching adds nothing". No Architect or self-reflection run had been made in any start of the comparison. This is a change to the protocol made after seeing that one-shot score, and it is reported as one.
**Decision.** In the product, a run that starts from a blank harness begins with a draft round: the author writes a whole harness from the job setup and the train examples with their expected answers, with no attempts, as one-shot does, and the draft is kept as the starting point. Every later round is one watched change under the keep rule. A run that starts from a template or an imported harness refines it directly. In the comparison, each seed's draft is written once and shared: one-shot stops there, while Architect and self-reflection start from that exact draft with the seven rounds left and the draft's mentor spend taken off their cap. Self-reflection is then the student refining the mentor's draft, which compares the two refiners from the same starting point. GPT-6 Astra reviewed this and advised keeping the draft unconditionally and forking one draft per seed.
**Consequences.** What the comparison can test is "watched refinement adds value over stopping after the draft". When a draft already meets the 95% bar on dev, refinement stops at once (target met) and Architect tests the same harness one-shot did; the README says so plainly where it happens, and reports each draft's dev score, every kept change, paired test outcomes, costs, and every earlier start of seed 1 with its fixes and cost.

## 027. Five seeds for the comparison

**Context.** With the shared draft (decision 026), a seed whose draft meets the bar costs about $2.50 of hosted student time: bare and one-shot, plus two refining runs that stop at once. Seed 1's draft passed 60/60 on the locked test, so the question three seeds can barely answer is how often a draft falls short, which is the only place watched refinement can show anything on this job.
**Decision.** Seeds 1 to 5 for all four methods, decided after seed 1's one-shot result and before any later seed ran. The order is fixed: seeds 2 to 5 run in sequence, and if the $50 cap on the hosted student key comes within $8, the remaining seeds are dropped and the README says which.
**Consequences.** Every seed is reported, including any that fail, with each draft's dev and test scores. The limit that matters turned out to be the account's prepaid credit ($10), not the key's $50 cap; it ran out minutes into seeds 2 to 5, which wait for more credit.

