# Architect

Architect turns a job you describe into an agent that runs on your own computer.

A strong model, the **mentor**, watches a small local model, the **student**, attempt the job. It reads the student's failed attempts, works out what went wrong, and rewrites the student's harness: its instructions, step-by-step skills, small helper tools, worked examples and refusal rules. A change stays only if the student does measurably better on held-out practice tasks. When the student passes a locked test on its own, it graduates. You then work with the graduate inside Architect, offline, with no calls to the mentor.

It is meant for people with repetitive work and data they would rather not send to a cloud model on every request: small-business operations, back offices, internal tools.

By default the mentor is Muse Spark 1.3 (Meta Model API) and the student is Muse Glimmer, a 30B open-weight model running locally through Ollama. Both are choices in the job setup.

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
