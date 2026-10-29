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
- [x] Installers attached to a GitHub release (0.3.0, Oct 29; a later fix release goes the same way)
- [x] Sample job and one shipped graduate in the repo
- [x] README results filled from real runs
- [ ] Demo video (3 minutes or less) uploaded and link checked
- [ ] Submission made on the Cerebral Valley platform by Wed Nov 4, 9:00 PM ET, with the problem statement, the track (indie), the repository and video links, and everyone who contributed listed
- [ ] Optional: the demo posted on X, its link added on the platform

## Submission text (draft, for the owner to edit)

**Name:** Architect

**One line:** A large model teaches a small one your job, and the small one then does it on your own computer.

**What it does:** Architect turns a job you describe into an AI agent that runs on your own computer. You describe the job in a sentence and attach the records it works from. Muse Spark reads them, asks about anything your policy leaves open, and drafts the job. Architect works out every expected answer from your files itself, and nothing trains until you've confirmed the rule it made. Then Spark watches Muse Glimmer, a model small enough for a PC, try the job. When Glimmer gets something wrong, Spark finds the step where it went wrong and changes Glimmer's instructions and tools. A change stays only if Glimmer then does better on check tasks Spark never sees. Once Glimmer passes a final test on its own, it's your agent: it works offline, on your files, and asks before it changes one.

**Results:** in a comparison planned and published before it ran, teaching took a returns desk from 44 to 58 of 60 requests right, where Spark's one-shot setup got 38. It cost 42 cents of Spark. A pricing job drafted from a repair shop's files went from 22 of 30 check tasks to 40 of 40 on its final test after one round.

**How it uses Meta's models:**
- Muse Spark 1.3, through the Meta Model API, drafts the job from the person's files, reads each failed attempt's trace, and edits the agent's harness: its instructions, skills and small sandboxed tools.
- Muse Glimmer 30B is the agent. It trains against a hosted copy of the open weights and then runs offline on the person's computer through Ollama.
- Muse Spark Open can be the teacher instead, served by Baseten or Modal.

**Track:** indie developer. **Problem statement:** Build for Your World.

**Links:** https://github.com/echoo19/architect, https://echoo19.github.io/architect/, the latest release for Windows and macOS, and the video (to add).

**X post (draft):** I built Architect: Muse Spark teaches Muse Glimmer a job you describe, then Glimmer does it offline on your own computer. In a comparison planned before it ran, teaching took a returns desk from 44 to 58 of 60 right. Open source: github.com/echoo19/architect

## Demo script

The film as recorded on Oct 29 from the real app in hidden windows (`apps/desktop/demo/architect.ts`). Every screen is the app's own; a wait for a model is shown four times faster, with a 4x mark. No sound yet.

1. **Opening card.** Muse Spark teaches Muse Glimmer your job; then Glimmer does it on your computer.
2. **Describe a job, live.** A repair shop's job in one sentence and its three files. Spark reads them, asks how half-hour labor is billed and what an empty parts cost means, and drafts the job. Define shows the rule it made from the policy, each answer beside its question, worked examples, and the rule is confirmed.
3. **Training, replayed from that job's own run.** Before teaching, Glimmer got 22 of 30 check tasks. Round 1, Spark's first draft (a ticket-cost tool and a lookup harness), took it to 30 of 30.
4. **The final test.** 40 of 40 on requests it had never seen, graded by the confirmed rule, for 11 cents in all.
5. **On your computer (slot held).** The ready-made returns desk agent on 2-bit Glimmer with no network: an order question, a pickup booking that waits for approval, a refusal. It needs about ten minutes of GPU use, which the owner allows when it suits them.
6. **Measured.** In a comparison planned before it ran, teaching took the returns desk from 44 to 58 of 60.
7. **Closing card.** Where to get it.

The working cut without scene 5 runs 1:28; with it, about 2:30.

## What was built when

Filled from the commit log at the end of each day.

| Day | Built |
| --- | --- |
| Mon Oct 27 | From an empty folder to a working app (227 commits): the shared contracts, the harness folder format, mentor and student adapters (Meta Model API, Ollama, OpenAI-compatible), the engine (runner, QuickJS tool sandbox, deterministic checker, sealed test vault, keep or revert with a second measurement, budgets, storage), the desktop shell and screens from the design, the agent workspace with its loopback-only guard, the sample job in two versions, and a Windows installer. First real runs: a vertical slice on local Glimmer, two dev noise pilots, and seed 1 of the comparison. |
| Tue Oct 28 | The owner's expanded spec, built in parallel branches (354 commits): the coding-agent harness, versioned agents with portable packages and their import checks, failure-specific mentoring with replay, Teach this and Improve agent, the `architect` command, Hugging Face publishing, adapter training and serving built against stand-ins, one GPU lease across processes, the comparisons runner with its money and GPU safeguards, the evidence screens, a ready-made agent, a polish pass from a blind read of every screen, and a context budget for the 16K local model. Real runs: comparison 1 (no gain from two rounds of teaching), then comparison 2, planned and published first (44 to 58 of 60 with teaching); its agent ships with the app. Release 0.1.0 for Windows and macOS. |
