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

## Built during the Meta Global AI Developer Hackathon

Architect is being built from an empty repository during the Meta Global AI Developer Hackathon (Oct 27 to Nov 4, 2026). The idea predates the event; the code does not. The commit history shows what was built when, and [docs/HACKATHON.md](docs/HACKATHON.md) has the details.

## How it was built

Written by Jake Kang with AI coding agents: Claude Code (Claude Opus) does most of the implementation under his direction, with subagents for parallel pieces and GPT-6 Astra for second opinions on design decisions. Commits made with Claude carry a co-author line.

## Licence

MIT
