# Architect

**The training system for your own AI.**

A frontier model, Muse Spark, trains a small open model, Muse Glimmer, on an organization's own work, through harness engineering and LoRA fine-tuning. A sealed test that neither model sees decides whether it passed. The specialist that comes out runs on-premise and offline.

**[Watch the film and see the results on the website →](https://echoo19.github.io/architect/)**

## In short

- **Teaches from your own files.** Spark studies an organization's records and policy, writes the specialist's harness (prompts, small tools, lessons) and refines it round by round. A change stays only if it beats held-out checks Spark never sees.
- **Tested where it never trained.** Some organizations are sealed away from both models until a final test that runs once and is graded by a program, not a model.
- **Fine-tunes the weights.** LoRA and QLoRA on Glimmer, sized from its own config, trained on one GPU, with launch bundles for Slurm, Kubernetes and SkyPilot.
- **Knows when not to answer.** A risk certificate bounds how often the specialist is wrong when it answers.
- **Runs at the edge.** The specialist calls nothing but the model on your machine, and asks before it writes.

## Results

| Run | Where | Glimmer alone | Taught |
| --- | --- | --- | --- |
| Academy desk | Harborview Prep, an academy never seen | 24 of 48 | 43 of 48 |
| Inventory desk | Corvid Hill Discovery, a lab never seen | 4 of 32 | 27 of 32 |
| LoRA adapter on Inventory desk | Corvid Hill Discovery | 22 of 30 | 32 of 32 |
| Wind farm desk, made in the app | sealed final test | 11 of 32 | 32 of 32 |

The first risk certificate: wrong on at most 5% of answers at 95% confidence, held on an academy it never trained on. Every figure comes from a report in [docs/comparisons](docs/comparisons); the organizations are generated, except one anonymized real academy.

## How it was built

In 7 days, from an empty repository:

| | |
| --- | --- |
| Commits | 2,010 |
| Measured runs | 22, each planned before it ran |
| Model API spend | about $65 in all: $57 of hosted Glimmer, $7.50 of Spark, $0.21 of Spark Open |
| GPU compute | under $6, about 2.3 GPU-hours on Hugging Face |
| Hosted model requests | over 47,000 |
| Tests | 4,341 unit and 264 end-to-end |
| Design decisions recorded | 108, in [docs/DECISIONS.md](docs/DECISIONS.md) |
| Film narration | 32,374 characters of ElevenLabs voice across 8 takes |

Spend figures are upper bounds from each run's records.

## Get it

Download for Windows or macOS from the [website](https://echoo19.github.io/architect/download/) or the [latest release](https://github.com/echoo19/architect/releases/latest). You'll need [Ollama](https://ollama.com) and a Meta API key for Spark. [The user guide](docs/Architect-Guide.pdf) walks through each step, and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how it fits together.

## Built during the Meta Global AI Developer Hackathon

Built from an empty repository between Oct 27 and Nov 4, 2026. The idea and orchestration are Jake Kang's; the dev team was Claude Code on Claude Opus 5.5 and Codex on GPT-6 Astra. The idea came first; every line of code was written during the event. [docs/HACKATHON.md](docs/HACKATHON.md) has the details.

MIT licence.
