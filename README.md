# Architect

Architect turns a job you describe into an agent that runs on your own computer.

A strong model, the **mentor**, watches a small local model, the **student**, attempt the job. It reads the student's failed attempts, works out what went wrong, and rewrites the student's harness: its instructions, step-by-step skills, small helper tools, worked examples and refusal rules. A change stays only if the student does measurably better on held-out practice tasks. When the student passes a locked test on its own, it graduates. You then work with the graduate inside Architect, offline, with no calls to the mentor.

It is meant for people with repetitive work and data they would rather not send to a cloud model on every request: small-business operations, back offices, internal tools.

By default the mentor is Muse Spark 1.3 (Meta Model API) and the student is Muse Glimmer, a 30B open-weight model running locally through Ollama. Both are choices in the job setup.

## Install

Download the installer for your computer from the [latest release](https://github.com/echoo19/architect/releases/latest).

**Windows.** Run `Architect-Setup-<version>.exe`. It installs for your user account and opens Architect when it finishes. The installer is not signed, so Windows may say it protected your PC. Choose More info, then Run anyway.

**macOS.** Open the disk image for your Mac, `arm64` for Apple silicon or `x64` for Intel, and drag Architect into Applications. The app is not signed, so macOS blocks the first launch. Right-click Architect, choose Open, then choose Open again. On macOS 15 and later there may be no Open button; go to System Settings > Privacy & Security and choose Open Anyway instead.

Architect needs Ollama running on the same computer. The first-run screens check for it and say where to get it if it is missing, then download the student model (about 18 GB for Muse Glimmer) and ask for the mentor's API key.

## How it works

You describe the job and attach the files it works from. The mentor asks a few questions and drafts the job: what the agent does and doesn't do, the example tasks with expected results, how answers are checked, the pass rate it must reach, and a spending cap. The tasks are split into practice (train), check (dev) and a locked test that the mentor never sees.

Training starts, when you begin from a blank harness, with the mentor writing a whole first draft from the job and its examples before it has seen the student try anything. After that it runs in rounds. The student attempts a batch of practice tasks inside its current harness. A deterministic checker grades every attempt; there is no model judging pass or fail. The mentor reads the failed attempts, names one cause, and proposes one change to the harness with a prediction of how many check tasks it will fix. Architect applies the change to a new harness version and runs the check tasks. The change stays only if the student passes a set number more of them and no task type loses more than one, and the gain holds when both versions are measured again on fresh draws; otherwise it is reverted. (The model's answers vary from run to run, so one good draw isn't enough.) Either way the lineage records the failure that prompted it, the prediction, and what actually happened.

When the student meets the target or the budget runs out, the mentor is disconnected and the locked test runs once on your machine. The report card shows the result per task type, typical and slowest answer times, what training cost, which changes helped most, and the task types the agent refuses because nothing fixed them. Accept it, and the graduate appears in the sidebar, ready to use.

In the workspace you chat with the graduate like you would with a coding agent, because it is one: it reads, searches and changes your files and runs small JavaScript programs over them in a sandbox. Each step it takes is shown as it runs, every change to your files waits for your approval with a diff, and requests it was not trained for are refused with the reason from its report card. The graduate's process can only reach the local model runtime; anything else is blocked.

A few guarantees hold throughout, and the tests check each of them:

- The test split lives in a vault that only the test runner can open, and only after the mentor has been released. Every payload sent to the mentor is scanned for test content first.
- The mentor can change only harness files: never the checker, the splits, the data, the permissions or the sampler seed.
- Tools the mentor writes run in a QuickJS sandbox in a separate process, with no network, clock or randomness, and read-only access to the job's declared files.
- Budgets for rounds, mentor dollars and wall-clock time are hard caps; a mentor call that could cross the dollar cap doesn't start.

## Results

Everything below was measured on the sample job, Ferncliff Home Services (version 2): a made-up back office where the agent prices finished jobs into invoices, answers questions about overdue balances, and books service visits into the schedule. Its 180 tasks, each with a deterministic check, are split into 60 practice tasks, 45 check tasks, 15 calibration tasks and a locked test of 60 that the mentor never sees. The mentor is Muse Spark 1.3 and the student is Muse Glimmer 30B. To save time, training and the comparison's locked tests ran on a hosted copy of Glimmer on OpenRouter; the agent the repo ships was then tested again on this computer, offline. These runs used the first version of the student's tools, which read and wrote tables row by row, before the student got a coding agent's tools (decision 030), so they describe that version.

### Seed 1

Locked test, 60 tasks:

| Method | Passed | Invoices | Overdue balances | Scheduling | Spark | Hosted Glimmer |
| --- | --- | --- | --- | --- | --- | --- |
| Glimmer alone | 45 (75%) | 11/20 | 17/20 | 17/20 | none | $0.81 |
| One-shot: Spark writes the setup once, without seeing an attempt | 60 (100%) | 20/20 | 20/20 | 20/20 | $0.07 | $0.77 |
| Architect: that same draft, then watched refinement | 60 (100%) | 20/20 | 20/20 | 20/20 | $0.07 | $0.13 more |
| Self-reflection: Glimmer refines that same draft itself | 59 (98%) | 20/20 | 19/20 | 20/20 | $0.07 | $0.13 more |

On the same 60 tasks, Architect's agent passes 15 that Glimmer alone failed and fails none that it passed: 25 points better, with a 95% interval of 15 to 37 points from resampling tasks.

### On this computer, offline

The shipped agent, tested again on the 4-bit Glimmer running through Ollama on an RTX 4070 Ti (12 GB, so about half the model runs on the CPU), with no network access: 60 of 60. A typical answer took 1 min 57 s, against 6.9 s on the hosted copy, and the slowest 5% took more than 3 min 17 s.

### What this shows, and what it doesn't

A setup that Spark wrote for about seven cents turns a 30B model that gets three in four of these tasks right into one that got all 60 right on tasks it had never seen, running offline.

It doesn't show that watching the student adds anything on this job. Spark's first draft, written before it saw a single attempt, already passed all 45 check tasks, so Architect's refinement had nothing left to fix and stopped at once: Architect and one-shot tested the same setup. That is a property of this job, whose policy spells out every rule with an example. A job whose rules aren't all written down is where watching should matter, and that hasn't been tested yet.

One seed is initial evidence. Seeds 2 to 5 were declared before they ran (decision 027) and are waiting on hosted credit.

### How the comparison changed while it ran

Each change, with its reason, is in [docs/DECISIONS.md](docs/DECISIONS.md).

- A noise pilot showed the check score moving by up to 6 of 45 tasks between identical runs, so a change now has to clear the keep bar on a second, fresh measurement too (decision 022).
- The first two starts of seed 1 were thrown away after they exposed problems that affected every method: a one-shot reply lost to a format slip, a tool API whose docs never said file names keep their extension, and a tool with a syntax error that nothing caught before measuring. Every author now gets one fix for a reply the runner can't use, tools may use a file's short name, and a tool must load before it is measured (decisions 023 to 025).
- After seeing the one-shot score on seed 1, Architect was changed to start from a whole first draft instead of building its setup one change at a time, and the comparison now shares each seed's draft between one-shot, Architect and self-reflection (decision 026). This was settled before any Architect run and reviewed by GPT-6 Astra, but it is still a change made after seeing a result, and it is reported as one.

## Status

Built from an empty repository between Oct 27 and Nov 4, 2026. [docs/PROGRESS.md](docs/PROGRESS.md) says where things stand.

## Docs

- [SPEC.md](SPEC.md): what Architect does and how it is evaluated
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): processes, data flow, isolation guarantees
- [docs/HARNESS_FORMAT.md](docs/HARNESS_FORMAT.md): the harness and graduate folder format
- [docs/DECISIONS.md](docs/DECISIONS.md): design decisions
- [docs/MODELS.md](docs/MODELS.md): models, endpoints, pricing

## Related work

Architect sits near several lines of work. What differs in each case is which model writes the improvements, what it is allowed to change, and what has to happen before the result is trusted.

DSPy compiles a pipeline of language-model calls by searching over instructions and few-shot demonstrations against a metric on training data, and its optimizers can use a stronger teacher model to bootstrap demonstrations. TextGrad treats natural-language feedback from a model as a gradient and uses it to update prompts and other text. Architect's mentor also writes feedback-driven updates, but it reads the student's own failed traces, proposes one diagnosed change at a time with a predicted effect, and can change more than the prompt: it can add procedures, write helper tools, add worked examples, change which context loads, adjust decoding settings, or mark a task type as refused.

Voyager, an agent that plays Minecraft, grows a library of skills written as code and reuses them. The model that writes those skills is the same model that uses them. In Architect a strong model writes skills and tools for a weaker one, and then leaves.

Reflexion has an agent reflect in words on its own failures and keep those reflections in memory for later attempts. That idea is one of Architect's baselines: with the same round budget, the student edits its own harness. Comparing it with the mentor shows whether a stronger outside teacher adds anything.

AIDE searches over candidate solutions written as code and keeps the ones that score best on validation, and MLE-bench measures such agents on Kaggle competitions graded against held-out test sets. Architect borrows that discipline. Every candidate is measured, a dev set decides what stays, and the final number comes from a test the optimizer never saw.

Architect's own bet is narrower than any of these: diagnose one particular student's real failures, accept the result only after a locked test that runs once with the mentor disconnected, and then run with no mentor at all.

## Built during the Meta Global AI Developer Hackathon

Architect is being built from an empty repository during the Meta Global AI Developer Hackathon (Oct 27 to Nov 4, 2026). The idea predates the event; the code does not. The commit history shows what was built when, and [docs/HACKATHON.md](docs/HACKATHON.md) has the details.

## How it was built

Written by Jake Kang with AI coding agents: Claude Code (Claude Opus) does most of the implementation under his direction, with subagents for parallel pieces and GPT-6 Astra for second opinions on design decisions. Commits made with Claude carry a co-author line.

## Licence

MIT
