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

Training runs in rounds. The student attempts a batch of practice tasks inside its current harness. A deterministic checker grades every attempt; there is no model judging pass or fail. The mentor reads the failed attempts, names one cause, and proposes one change to the harness with a prediction of how many check tasks it will fix. Architect applies the change to a new harness version and runs the check tasks. The change stays only if the student passes a set number more of them and no task type loses more than one; otherwise it is reverted. Either way the lineage records the failure that prompted it, the prediction, and what actually happened.

When the student meets the target or the budget runs out, the mentor is disconnected and the locked test runs once on your machine. The report card shows the result per task type, typical and slowest answer times, what training cost, which changes helped most, and the task types the agent refuses because nothing fixed them. Accept it, and the graduate appears in the sidebar, ready to use.

In the workspace you chat with the graduate like you would with a coding agent: each step it takes is shown as it runs, every write to your files waits for your approval with a diff of the rows, and requests it was not trained for are refused with the reason from its report card. The graduate's process can only reach the local model runtime; anything else is blocked.

A few guarantees hold throughout, and the tests check each of them:

- The test split lives in a vault that only the test runner can open, and only after the mentor has been released. Every payload sent to the mentor is scanned for test content first.
- The mentor can change only harness files: never the checker, the splits, the data, the permissions or the sampler seed.
- Tools the mentor writes run in a QuickJS sandbox in a separate process, with no network, clock or randomness, and read-only access to the job's declared files.
- Budgets for rounds, mentor dollars and wall-clock time are hard caps; a mentor call that could cross the dollar cap doesn't start.

## Status

Under active development. See [docs/PLAN.md](docs/PLAN.md) for the milestones and [docs/PROGRESS.md](docs/PROGRESS.md) for where things stand.

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
