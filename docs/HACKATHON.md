# Meta Global AI Developer Hackathon

Architect is being built during the Meta Global AI Developer Hackathon (indie developer track, problem statement "Build for Your World"). This file is the only place in the repo, besides one README section, that talks about the event.

## Dates

- Building period: Tue Oct 27 to Wed Nov 4, 2026.
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
- [x] Installers attached to a GitHub release (0.4.0, Oct 30, the first with a signed and notarized Mac app; after 0.3.0 to 0.3.5 on Oct 29)
- [x] Sample job and one shipped graduate in the repo
- [x] README results filled from real runs
- [ ] Demo video (3 minutes or less) uploaded and link checked. The final cut, 2 min 50 s, is rendered (`renders/architect-walkthrough.mp4` in the film folder outside the repo, see PROGRESS) and plays on the site's home page; it still needs uploading where the platform can link to it
- [ ] Submission made on the Cerebral Valley platform by Wed Nov 4, 9:00 PM ET, with the problem statement, the track (indie), the repository and video links, and everyone who contributed listed
- [ ] Optional: the demo posted on X, its link added on the platform

## Submission text (draft, for the owner to edit)

This is a draft for the owner. It is written platform first: the training system is the product, and the specialists are what it makes.

**Name:** Architect

**One line:** The training system for your own AI.

**Why we made this:** Most teams that build with AI rent it, and every request sends their data to someone else's model. Architect works the other way round: a large model teaches a small one the work and then leaves. What's left runs on the team's own computer and comes with a record of what it can and can't do. We started building on October 27, 2026. Y Combinator's Requests for Startups for Winter 2027 came out after that, and three of them ask for what we were already making: [Own Your Intelligence](https://www.ycombinator.com/rfs#own-your-intelligence) (Jon Xu), [AI for the Air-Gapped Economy](https://www.ycombinator.com/rfs#ai-for-the-air-gapped-economy) (Brad Flora) and [Vertical Foundation Models](https://www.ycombinator.com/rfs#vertical-foundation-models) (Diana Hu). They confirm the idea; they didn't give it to us.

**What it does:** A large model teaches a small one by rewriting its instructions and tools. Every change is tested on work neither model has seen, and Architect certifies when the result can be trusted.

You describe a field of work, or bring one: several organizations that do it, for example test-prep academies, each with its own files and policy. Muse Spark studies the material, including recordings, which Muse Voice Transcribe turns into text first. It writes a short brief of the skills and rules it found and asks about anything the material leaves open. Then Spark teaches Muse Glimmer, a model small enough for a PC, on some of the organizations. When Glimmer gets something wrong, Spark finds the step where it went wrong and rewrites Glimmer's instructions and tools. A change stays only if Glimmer then does better on check tasks Spark never sees. A final test runs once, after everything is frozen, on organizations neither model ever saw, one of them real. A program scores it, never wording.

Two more pieces make the result something you can trust:

- **Certified answers.** After qualification Architect states a certificate: how often the specialist is wrong when it answers, with a stated bound and confidence, and how much it handed to a person. A sealed calibration set the teacher never sees sets the point where it answers or hands off, and the report checks whether the bound held on organizations it never saw. The form is built and tested. Its first live run, on the third field run's Academy desk, issued no certificate, because that Academy desk was confidently wrong too often.
- **Counterexample-guided repair.** When a tool Spark wrote gives a wrong result, Architect shrinks the failing case until little is left, Spark repairs the tool against it, and the case stays in the field's regression suite.

The path to fine-tuning and clusters is labeled experimental. Architect exports checker-verified training examples and an outcome scorer, sizes a training job from a model's own configuration, and writes launch bundles for a Slurm cluster or Kubernetes. These are validated against stand-ins and simulated schedulers. No model has been trained on a field, and no cluster job has run.

Architect comes in two editions in one app. Architect teaches an agent one job. Architect Lab is a workbench for people who build models for a field, with fields, preregistered experiments, a registry of model versions with their scores, and compute plans.

What it makes, as examples: Returns desk, Service desk, Academy desk, a pricing desk drafted from a repair shop's files, and a science set (Sweep desk and Assay desk) that is not built yet. Every specialist works offline on the organization's own files and asks before it changes one.

**Results:** all from the reports in `docs/comparisons`.
- Academy desk, taught on three generated academies and tested on a sealed set of 120 tasks, passed 99 of 120 where Glimmer on a blank setup passed 54. On Harborview Prep, an academy it never saw, it passed 43 of 48 against 24, a difference of 39.6 points (95% interval 22.9 to 53.7). On the real academy, an anonymized one it never saw, it passed 12 of 24 against 9 and the interval includes zero, so no gain is shown there.
- Returns desk: teaching took Glimmer from 44 to 58 of 60 requests it had never seen, in a comparison published before the run. It cost 42 cents of Spark.
- Glimmer on the owner's own GPU: the same Academy desk passed 103 of 120 locally against 99 hosted, a difference of +3.3 points with an interval of -4.3 to +11.0, so no difference is shown.
- A third Academy desk run, taught on three other generated academies: on Juniper Study House, which neither model saw, it passed 31 of 48 against 15 for a blank setup, +33.3 points (95% interval +16.2 to +47.5). On a second snapshot of the real academy it did worse, 3 of 30 against 13, -33.3 points (-50.3 to -14.2). Replaying its tools after the test points to why: its diagnose instructions never loaded on the real academy's wording, every history attempt ran out of steps, and no setup could pass the assign tasks.
- The first live certificate, on that Academy desk with hosted Glimmer (60 calibration tasks, five attempts each, at most 10% wrong at 95% confidence): no certificate. Answering only when all five attempts agreed, it would have answered 46 of 60 and been wrong on 14, an upper bound of 43.5%. On the real academy it got 0 of 10. The run also found a flaw, five "no answer" results counted as agreement, which was fixed afterwards. It cost $4.42.

All numbers come from one seed per arm. The gains come from rewritten instructions and tools, not trained weights.

**How it uses Meta's models:**
- Muse Spark 1.3, through the Meta Model API, is the teacher. It drafts the job, studies the organizations' material, diagnoses each failed attempt and edits Glimmer's instructions and tools.
- Muse Glimmer 30B, open weights, is the student. It is hosted while it is being taught and runs locally through Ollama when it is used.
- Muse Voice Transcribe 1.0 turns an organization's recordings into study material for Spark.
- Muse Spark Open, self-hosted, can be the teacher instead.

**Bonus fits:**
- Best Build on Open Weight Models: Glimmer runs on the owner's own GPU and kept the hosted result, 103 of 120 against 99 of 120.
- Best Agentic Use-Case: the specialists are agents that act on an organization's records, and a program checks the state they leave behind.

**Track:** indie developer. **Problem statement:** Build for Your World.

**Links:** https://github.com/echoo19/architect, https://echoo19.github.io/architect/, the latest release for Windows and macOS, and the video (to add).

**X post (draft):** I built Architect, the training system for your own AI. A large model teaches a small one by rewriting its instructions and tools, every change is tested on work neither has seen, and Architect certifies when the result can be trusted. Open source: github.com/echoo19/architect

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
| Tue Oct 27 | From an empty folder to a working app (227 commits): the shared contracts, the harness folder format, mentor and student adapters (Meta Model API, Ollama, OpenAI-compatible), the engine (runner, QuickJS tool sandbox, deterministic checker, sealed test vault, keep or revert with a second measurement, budgets, storage), the desktop shell and screens from the design, the agent workspace with its loopback-only guard, the sample job in two versions, and a Windows installer. First real runs: a vertical slice on local Glimmer, two dev noise pilots, and seed 1 of the comparison. |
| Wed Oct 28 | The owner's expanded spec, built in parallel branches (354 commits): the coding-agent harness, versioned agents with portable packages and their import checks, failure-specific mentoring with replay, Teach this and Improve agent, the `architect` command, Hugging Face publishing, adapter training and serving built against stand-ins, one GPU lease across processes, the comparisons runner with its money and GPU safeguards, the evidence screens, a ready-made agent, a polish pass from a blind read of every screen, and a context budget for the 16K local model. Real runs: comparison 1 (no gain from two rounds of teaching), then comparison 2, planned and published first (44 to 58 of 60 with teaching); its agent ships with the app. Release 0.1.0 for Windows and macOS. |
| Thu Oct 29 | A job of your own (256 commits): describe it and attach your records, and Spark drafts it, asking what the records leave open. A pricing policy becomes a rule that Architect works out exactly, shown as steps with worked examples, and nothing trains until you confirm it; Architect itself asks whether N/A or a dash means zero. You choose what the teacher may change, a run says what it needs before it starts, and more time is one click away when training won't fit. A hidden recorder for the film, and its working cut. Three blind reads of the new screens and second readings by GPT-6 Sol and Astra, each acted on. Real runs: Spark drafted jobs from a made-up bike repair shop's records, with Glimmer online as the student; its pricing job went from 22 of 30 check tasks before teaching to 40 of 40 on its final test after one round. Releases 0.3.0 to 0.3.5. |
