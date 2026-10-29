# Meta Global AI Developer Hackathon

Architect is being built during the Meta Global AI Developer Hackathon (indie developer track, problem statement "Build for Your World"). This file is the only place in the repo, besides one README section, that talks about the event.

## Dates

- Building period: Mon Oct 27 to Wed Nov 4, 2026.
- Submissions close **Wed Nov 4, 9:00 PM ET** on the Cerebral Valley platform.
- Judging Nov 5 to Nov 8; finals and winners Nov 9.

## Rules that shape this repo

- The repository is public.
- New work only. The concept predates the event; no code does. Every file here was written from Oct 27 on, and the commit history shows when.
- The demo shows only what was built during the event.
- The project uses Meta's models: Muse Spark 1.3 as the default mentor, Muse Spark Open as the self-hosted mentor option, Muse Glimmer as the student. Each has a job in the product; none was added for show.

## Notes carried over from the spec

- Built during the event: the concept predates the hackathon; no code does. Every component in the spec is written Oct 27 to Nov 4, and the demo shows only that work.
- Also eligible for: Best Build on Meta Open Weight Models (Glimmer, Spark Open) and Best Agentic Use-Case.
- Submission: (1) public repo with the desktop app, a sample job with its tasks and checker, and one shipped graduate anyone can open in the workspace; (2) a demo video of 3 minutes at most, shot on the live product: the bare student failing a task, the training view as rounds climb, the network cut, then working with the graduate on the same task; (3) README results: the comparison table, the pass-rate-per-round curve, cost, failure cases, and related work. Working title for a later write-up: *Teaching Without Training: An LLM Mentor That Builds a Small Agent's Harness Until It Works Alone.*

## Submission checklist

- [ ] Repository public, README complete, licence present
- [ ] CI green on the final commit
- [ ] Installers attached to a GitHub release
- [x] Sample job and one shipped graduate in the repo
- [x] README results filled from real runs
- [ ] Demo video (3 minutes or less) uploaded and link checked
- [ ] Submission form filled, team members listed

## Demo script

A draft, to be shot on the live app during a real run of the sample job (hosted training for speed, the graduate on the local model). About three minutes; times are targets.

1. **The problem (0:00 to 0:20).** A small office's back-office work: billing finished jobs, chasing overdue balances, booking visits. Show Glimmer on its own getting a billing task wrong in a trace: it reads the tables line by line and runs out of steps before it writes the invoice. Say what the job needs: an agent that runs on the office's own computer, with no data going to a cloud model on every request.
2. **Describe and define (0:20 to 0:50).** Type the job in a sentence and attach the office's files. Spark asks a few questions. The Define screen shows what the agent will and won't do, the 95% bar for the final test, and that writes need approval.
3. **Training (0:50 to 1:40).** Spark writes the first full setup without seeing an attempt; the chart jumps from Glimmer alone to the first draft. Open the round drawer on a change: the failure Spark read, its diagnosis, the tool or skill it wrote, what it predicted and what was measured, and why it was kept. Then the final test runs with Spark disconnected.
4. **Report card (1:40 to 2:00).** Every task type with its score, typical answer time, what training cost (Spark and the hosted copy, apart), and that the test ran once on tasks Spark never saw.
5. **Offline (2:00 to 2:45).** Turn the network off. In the workspace, ask the graduate to bill a finished job: each step shows as it runs, the new invoice row waits for approval with its diff, then the answer. Ask for something outside its job and show the refusal with its reason.
6. **Results (2:45 to 3:00).** The comparison in one line from the README: Glimmer alone 45 of 60 on the locked test, with Architect's setup 60 of 60, and the same on the local 4-bit model offline. Meta's models do the two jobs: Muse Spark teaches, Muse Glimmer works.

Narration, if any, is a disclosed generated voice; no generated images.

## What was built when

Filled from the commit log at the end of each day.

| Day | Built |
| --- | --- |
| Mon Oct 27 | From an empty folder to a working app (227 commits): the shared contracts, the harness folder format, mentor and student adapters (Meta Model API, Ollama, OpenAI-compatible), the engine (runner, QuickJS tool sandbox, deterministic checker, sealed test vault, keep or revert with a second measurement, budgets, storage), the desktop shell and screens from the design, the agent workspace with its loopback-only guard, the sample job in two versions, and a Windows installer. First real runs: a vertical slice on local Glimmer, two dev noise pilots, and seed 1 of the comparison. |
