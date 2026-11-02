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

## Participant guide, re-read Nov 1

Read in the owner's signed-in browser on Nov 1. What it adds to the notes above:

- Original work is a disqualification rule: "Failure to clearly identify your original contributions will result in immediate disqualification at Judges sole discretion." The submission text below says it in its first lines, and the README's "Built during" section says the same.
- One project per team, entered by one representative, with every contributor listed on the submission page. The repository must be public and the video link accessible.
- The video is a "three minute demo video" of the work made during the event; judges use it alongside the code and the live product.
- The deadline reads Nov 4, 9:00 PM EST in the submission section and 9:00 PM ET in the schedule. Nov 3 is the last full day for questions in Discord's #questions and #office-hours.
- "Push the Frontier" names scientific experiments and physical systems, which the screening-lab desks also fit; the entry stays on "Build for Your World" unless the owner picks otherwise.
- Muse Glimmer and Muse Spark Open are the open-weight options; Baseten's event id for Spark Open is `meta-models/muse-spark-open-1026`.
- The page doesn't define the indie track beyond its prizes.

## Submission checklist

- [x] Repository public, README complete, licence present
- [ ] CI green on the final commit (green on 0.8.0's, Nov 1; check again on the last one)
- [x] Installers attached to a GitHub release (0.8.0, Nov 1: Windows, Mac on Apple silicon and Intel; the Mac app signed and notarized, the Windows installer not signed)
- [x] Sample job and one shipped graduate in the repo
- [x] README results filled from real runs
- [ ] Demo video (3 minutes or less) uploaded and link checked. The final cut, 2 min 41 s, is `renders/lab-walkthrough-final-3.mp4` in the film folder outside the repo (its record is that folder's `BRIEF.md`) and plays on the site's home page; it still needs uploading where the platform can link to it (the owner's account)
- [ ] Submission made on the Cerebral Valley platform by Wed Nov 4, 9:00 PM ET, with the problem statement, the track (indie), the repository and video links, and everyone who contributed listed
- [ ] Optional: the demo posted on X, its link added on the platform

## Submission text (draft, for the owner to edit)

This is a draft for the owner. It is written platform first: the training system is the product, and the specialists are what it makes.

**Name:** Architect

**One line:** The training system for your own AI.

**Original work:** all of Architect was built during the event, from an empty repository on October 27, 2026: the desktop app, the engine, the site, the film and every run in the results. The idea came first; no code did. The commit history shows when each part was written.

**Why we made this:** Most teams that build with AI rent it, and every request sends their data to someone else's model. Architect works the other way round: a large model teaches a small one the work and then leaves. What's left runs on the team's own computer and comes with a record of what it can and can't do. We started building on October 27, 2026. Y Combinator's Requests for Startups for Winter 2027 came out after that, and three of them ask for what we were already making: [Own Your Intelligence](https://www.ycombinator.com/rfs#own-your-intelligence) (Jon Xu), [AI for the Air-Gapped Economy](https://www.ycombinator.com/rfs#ai-for-the-air-gapped-economy) (Brad Flora) and [Vertical Foundation Models](https://www.ycombinator.com/rfs#vertical-foundation-models) (Diana Hu). They confirm the idea; they didn't give it to us.

**What it does:** Architect is an R&D platform for specialist models. A frontier model, Muse Spark, trains a small one, Muse Glimmer, on an organization's own work: it engineers Glimmer's harness (its prompts, tools and lessons), and when the harness isn't enough it fine-tunes Glimmer's weights with LoRA or QLoRA. Every refinement is a hypothesis tested on held-out checks Spark never sees, and the result is judged once, on a sealed final test that includes organizations neither model has seen. The specialist that comes out runs on-premise and offline, and it can carry a risk certificate that bounds how often it is wrong.

How it works:

- **A field, not a prompt.** You describe a kind of work done across several organizations, such as test-prep academies or screening labs, each with its own files and policy. Spark studies all of it (recordings too, through Muse Voice Transcribe) and writes a brief where every rule is traced to its source.
- **Harness engineering.** Spark drafts the harness, then reads Glimmer's failed attempts, finds the step that went wrong, and refines it. A refinement stays only if it beats held-out checks; otherwise it is rolled back. Every change is logged with the failure that caused it, the predicted effect and the measured one.
- **Counterexample-guided repair.** When a tool Spark wrote gives a wrong result, Architect shrinks the failing case (2,312 rows down to 4 in one repair), Spark fixes the tool against it, and the case joins the field's regression suite.
- **Fine-tuning.** Architect exports checker-verified training data, sizes a LoRA, QLoRA or full fine-tune from the model's own config, trains on Hugging Face Jobs, and writes launch bundles for Slurm, Kubernetes and SkyPilot clusters.
- **Risk certificates.** A sealed calibration set sets when the specialist answers and when it hands off to a person, with a stated bound and confidence, then the bound is checked on organizations it never trained on.
- **Agent teams.** Specialists work together: a lead asks a teammate when the answer is in the teammate's files. Each still reads only its own files and asks before it writes.
- **Two editions in one app.** Architect teaches one job, for anyone. Architect Lab is the R&D workbench: fields, preregistered experiments, a registry of model versions with their scores, and compute plans.

**Results:** from the reports in `docs/comparisons`. The organizations are generated, except the anonymized real academy.

- **Test-prep academies:** on Harborview Prep, an academy neither model saw, the Spark-engineered harness passed 43 of 48 tasks, against 24 for Glimmer alone.
- **A screening lab:** Inventory desk, which reserves compound stock for re-tests, passed 27 of 32 at Corvid Hill Discovery, a lab neither model saw, against 4 for Glimmer alone.
- **LoRA fine-tuning:** with Inventory desk's harness held fixed, a QLoRA adapter trained on 22 of Glimmer's checker-passed attempts took it from 22 of 30 to 32 of 32 at Corvid Hill Discovery. Task by task that is 8 wins and no losses, +26.7 points (95% interval +9.8 to +44.4), for $4.42 of GPU. It is one seed, and the adapter also stopped Glimmer writing its reasoning, so part of the gain may come from that.
- **The first risk certificate:** when Academy desk answers, it is wrong on at most 5% of requests like these, at 95% confidence, and the bound held at Harborview Prep: 53 of 54 answered, none wrong.
- **An open-weight teacher:** with Muse Spark Open as the teacher, served by Baseten, the whole pipeline runs on Meta's open weights. Its engineered harness took Glimmer from 18 to 39 of 60 requests on a returns desk's sealed final test.
- **On-premise:** the same Academy desk passed 103 of 120 on one 12 GB graphics card, against 99 of 120 hosted.

**How it uses Meta's models:**

- **Muse Spark 1.3**, through the Meta Model API, is the teacher: it studies the field, diagnoses failures, engineers the harness and drafts the training data.
- **Muse Spark Open**, open weights, can teach instead, here served by Baseten.
- **Muse Glimmer 30B**, open weights, is the specialist: hosted while it trains, on-premise when it works, and the base its LoRA adapters are trained on.
- **Muse Voice Transcribe 1.0** turns an organization's recordings into study material.

**Bonus fits:**

- **Best Build on Open Weight Models:** Spark Open teaching through Baseten, Glimmer on-premise on a 12 GB card, and LoRA fine-tuning on Glimmer's open weights through Hugging Face Jobs, which took Glimmer on its taught harness to 32 of 32 at a lab it never saw.
- **Best Agentic Use-Case:** specialists that act on an organization's records and work as a team, checked by a program on the state they leave behind.

**Track:** indie developer. **Problem statement:** Build for Your World.

**Links:** https://github.com/echoo19/architect, https://echoo19.github.io/architect/, the latest release for Windows and macOS, and the video (to add).

**X post (draft):** I built Architect: an R&D platform that trains specialist AI on your own work. A frontier model engineers a small model's harness and fine-tunes it with LoRA, every refinement tested on held-out checks and the result judged on a sealed test. On a lab it never saw: 27 of 32, up from 4, and 32 of 32 with a LoRA adapter. Open source: github.com/echoo19/architect

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
