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

## Judging, as checked on Oct 29

From the event page and the participants' event guide:

- A pass/fail gate first: the project fits a problem statement (Build for Your World or Push the Frontier) and genuinely uses the Meta Model API or open-weight models. Architect fits Build for Your World and uses Muse Spark through the Meta Model API and Muse Glimmer's open weights; Muse Spark Open is the self-hosted mentor, with the event's Baseten id `meta-models/muse-spark-open-1026`. It is none of the disqualified kinds (medical or mental-health advice, basic RAG, simple image analyzers, education chatbots, job screeners, nutrition coaches, personality or sports analyzers, politics or war).
- Then a score from 0 to 10: impact 30%, use of Meta's AI tools 25%, demo 25% (working, holds up live, the quality of the 3-minute video), technical depth 20%. The indie track is judged on creativity, technical ambition and whether it works. The top 5 of each track go to a live final on Nov 9, on the same rubric.
- Bonus awards: Best Build on Open Weight Models (Glimmer or Spark Open on your own hardware or partner inference), Best Agentic Use-Case, Most Viral Project (engagement on an X post of the demo through Nov 8, its link submitted on the platform), Community Vote (the public gallery) and Best Creative Build (Muse Image or Muse Wonder, which Architect doesn't use).

## Submission checklist

- [x] Repository public, README complete, licence present
- [ ] CI green on the final commit
- [ ] Installers attached to a GitHub release (0.3.0)
- [x] Sample job and one shipped graduate in the repo
- [x] README results filled from real runs
- [ ] Demo video (3 minutes or less) uploaded and link checked
- [ ] Submission made on the Cerebral Valley platform by Wed Nov 4, 9:00 PM ET, with the problem statement, the track (indie), the repository and video links, and everyone who contributed listed
- [ ] Optional: the demo posted on X, its link added on the platform

## Demo script

A draft, revised on Oct 28 after comparison 2. It is shot on the live app: the training part replays comparison 2's real records in the app's own screens (labeled as a replay), and the agent part runs live on this computer's 2-bit Glimmer. About three minutes; times are targets.

1. **The problem (0:00 to 0:20).** An outdoor-gear shop's returns desk: deciding refunds, answering order questions, booking carrier pickups, from records that are messy (money written with currency signs and commas, values in quotes). Show Glimmer on its own getting a refund wrong in a recorded attempt. Say what the shop needs: an agent on its own computer, with no data going to a cloud model on every request.
2. **Describe and define (0:20 to 0:45).** Type the job in a sentence and attach the shop's records. Spark asks a few questions. The Define screen shows what the agent will and won't do, the 95% bar for the final test, and that writes need approval.
3. **Training (0:45 to 1:35), a replay of comparison 2.** The check score climbs from 31 of 45. Open round 1: the attempt Spark read, its diagnosis (the tools misread messy money), the tool change, what it predicted and what was measured twice, kept. Round 2: undone, no gain. Round 4: kept, and the target is met. The final test runs with Spark disconnected.
4. **Results (1:35 to 1:55).** 58 of 60 on requests teaching never saw, against 44 for Glimmer on its own and 38 for Spark's one-shot setup; a typical answer in 3.5 s instead of 17.7 s; 42 cents of Spark.
5. **On this computer (1:55 to 2:45).** Turn the network off. Open the ready-made agent and ask an order question: each step shows as it runs, then the answer. Ask it to book a pickup: the new row waits for approval with its diff. Ask for something outside its job and show the refusal with its reason.
6. **Close (2:45 to 3:00).** Meta's models do the two jobs: Muse Spark teaches, Muse Glimmer works, on your computer. The plan for this comparison was published before it ran.

Narration, if any, is a disclosed generated voice; no generated images.

## What was built when

Filled from the commit log at the end of each day.

| Day | Built |
| --- | --- |
| Mon Oct 27 | From an empty folder to a working app (227 commits): the shared contracts, the harness folder format, mentor and student adapters (Meta Model API, Ollama, OpenAI-compatible), the engine (runner, QuickJS tool sandbox, deterministic checker, sealed test vault, keep or revert with a second measurement, budgets, storage), the desktop shell and screens from the design, the agent workspace with its loopback-only guard, the sample job in two versions, and a Windows installer. First real runs: a vertical slice on local Glimmer, two dev noise pilots, and seed 1 of the comparison. |
| Tue Oct 28 | The owner's expanded spec, built in parallel branches (354 commits): the coding-agent harness, versioned agents with portable packages and their import checks, failure-specific mentoring with replay, Teach this and Improve agent, the `architect` command, Hugging Face publishing, adapter training and serving built against stand-ins, one GPU lease across processes, the comparisons runner with its money and GPU safeguards, the evidence screens, a ready-made agent, a polish pass from a blind read of every screen, and a context budget for the 16K local model. Real runs: comparison 1 (no gain from two rounds of teaching), then comparison 2, planned and published first (44 to 58 of 60 with teaching); its agent ships with the app. Release 0.1.0 for Windows and macOS. |
