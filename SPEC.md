# Architect: Spec

Jake Kang · last updated Oct 26, 2026

## Summary

Architect is a desktop app that turns a task into a ready-to-use local agent. A teacher (the mentor: any capable model or coding agent) watches a student model attempt the task, diagnoses its failures, and rewrites the harness around it until the student passes a held-out test alone. The output is a model + harness pair that is saved in Architect. You open it there and work with it the way you would use Claude Code inside Claude's desktop app, except it runs on its own harness and local model, with zero teacher calls.

The default setup uses Meta's models: Muse Spark 1.3 as the teacher and Muse Glimmer as the student.

- **Who it's for:** people with repetitive work and data they can't or won't send to a cloud model on every request: small-business operations, back offices, internal tools teams.
- **Scope:** this version builds a harness by watching a specific student fail and fixing what it actually gets wrong. The broader Architect vision also compiles harnesses from a spec.
- **What's new:** the frontier model is used only during training, then leaves. The graduate is private, free to run, and comes with a report card stating what it can and cannot do.
- **Customizable end to end:** the mentor, the student model, and the starting harness are all choices in the job setup. The mentor can be a model API, a self-hosted open-weight model, or a coding agent like Claude Code.
- **No terminal required:** setup, training, the report card, and day-to-day use all happen in the app.
- **Longer term:** compare mentoring through the harness with mentoring through the weights (LoRA).

## Core loop

Each round, the student attempts a batch of train tasks, the checker scores them, and the teacher turns the failures into one or a few harness changes. A change is kept only if dev pass rate improves; otherwise it is reverted and logged as a failed hypothesis.

Loop, step by step:

1. **Task:** job setup + checker.
2. **Student attempts** train tasks inside the current harness (local open model).
3. **Checker scores** each attempt: pass/fail + reason.
4. **Dev target met?** If yes (or budget spent), go to step 7.
5. **Teacher diagnoses:** the mentor reads the failing traces.
6. **Edit the harness:** one or a few changes (skill, tool, example, rule), each with a predicted effect. Kept only if dev improves, else reverted. Back to step 2 for the next round.
7. **Locked test:** run once, teacher off.
8. **Graduate:** model + harness, saved in Architect, opens in the agent workspace.

Every change records the failure that caused it, the teacher's predicted effect, and the measured effect. That record is what makes the mentoring checkable rather than a story.

## Inputs: the job setup

A new job is one setup screen in the app. The user gives the task, the examples, and the checker; they also pick the mentor and the student; the mentor decides everything else. The app saves the job as a file so runs are reproducible.

| Field | What the user provides |
| --- | --- |
| Job description | Plain-English description of the work |
| Mentor | A model API, a self-hosted open-weight model, or a coding agent (default: Muse Spark 1.3) |
| Student | Any open model the machine can run (default: Muse Glimmer) |
| Starting harness | Blank, a template, or an existing harness to improve |
| Tools and data | What the agent may touch, and whether it can read or write |
| Example tasks | A set of tasks with expected results; the app splits them into train, dev, and a locked test |
| Checker | How a task is graded: an exact answer, an end state, or required facts |
| Requirements | The pass rate and speed the graduate must reach |
| Budget | Limits on teacher spend, rounds, and time |

- **Checker contract:** deterministic pass or fail plus a reason. No LLM judging for pass or fail.
- **Split rule:** the teacher never sees the test split, and test tasks are kept distinct enough from training that near-duplicates can't leak.

## Output: the graduate

A graduate is a folder that pairs a pinned student model with the harness the teacher built for it. It runs with no network calls.

```
graduates/<job>/
  graduate.yaml        # model id + quantization, harness version, requirements met
  system.md            # role, scope, operating rules
  skills/              # step-by-step procedures, one file per task type
  tools/               # small functions the teacher wrote (date ranges, conflict check)
  examples/            # past failures with corrected traces (few-shot bank)
  guardrails.yaml      # refusal list: task types it could not master
  report.md            # report card
  lineage.jsonl        # every change, the failure that caused it, the measured effect
```

**What the teacher may change (the harness surface):**

| Component | What the teacher can do |
| --- | --- |
| System prompt | Add or tighten operating rules |
| Skills | Write step-by-step procedures for task types the student keeps failing |
| Tools | Write small helper functions for steps the student gets wrong by hand |
| Example bank | Add corrected traces for recurring failure types |
| Retrieval rules | Decide which skills and context load for which task |
| Decoding settings | Adjust temperature, reasoning effort, max steps |
| Guardrails | Mark a task type as refused when no fix works within budget |

**Fixed (not the teacher's to change):** the student's weights, the checker, the splits, the tool permissions set in the job.

**Report card fields:** test pass rate (overall and per task type), latency p50/p95, teacher cost to train, rounds used, refused task types, and the 3 interventions that helped most. Optionally, the same job can be trained on two students and compared side by side, to see whether a smaller model is enough.

## The app

Architect is a desktop app with four screens, one for each stage of a graduate's life. There is no command line anywhere.

| Screen | What the user does there |
| --- | --- |
| New job | Fill in the job setup, upload tasks, pick or write a checker, set the budget |
| Training | Watch rounds live: student attempts, the teacher's diagnosis, each harness change, and the dev pass-rate curve; pause or stop |
| Report card | See test results per task type, cost, refused task types, and the changes that helped most; accept the graduate |
| Agent workspace | Chat and work with the graduate, offline |

**The agent workspace is the product people use.** Every graduate is saved in Architect. Open one and you get a coding-agent-style session, like Claude Code inside Claude's desktop app, running entirely on that graduate's own harness and local model:

- A chat thread where you give the agent tasks in plain English
- Each step shown as it runs: which skill it loaded, each tool call and its result
- Changes to data shown as a diff before they apply, with approve or reject for write actions
- Clear refusals for task types on the guardrail list, with the reason from the report card
- A status bar showing the graduate's version, local model, and "teacher: off"
- Several graduates side by side in a sidebar, one per job

**Comparison mode** (for the report, hidden behind a setting): runs the bare-student, one-shot, and self-reflection baselines on the same job and budget, with a seed per run.

## Architecture and models

The app sits on three engine components, kept separate so the teacher can never grade itself.

| Component | Options | Role |
| --- | --- | --- |
| Teacher (mentor) | A model API, a self-hosted open-weight model, or a coding agent. Default: [Muse Spark 1.3](https://dev.meta.ai/models/muse-spark/) via Meta Model API | Reads failure traces, diagnoses, edits the harness, predicts the effect |
| Student | Any open model on local hardware. Default: [Muse Glimmer](https://dev.meta.ai/models/muse-glimmer/) | Attempts tasks inside the current harness |
| Runner | Local | Executes attempts in a sandbox, calls the checker, enforces budgets and split permissions, logs everything |

- **Mentor adapters:** one interface, three kinds. Model APIs (Meta Model API, any OpenAI-compatible endpoint). Self-hosted open weights, such as [Muse Spark Open](https://dev.meta.ai/models/muse-spark-open/) on Modal or Baseten, so task data never reaches a closed API during training either. Coding agents like Claude Code, which get the trace files and the harness folder and edit them directly.
- **Student adapters:** Ollama, llama.cpp, vLLM, or a hosted endpoint for development.
- **Portable harness:** a plain folder, so an existing harness can be imported, improved, and exported.
- **Fair comparisons:** one fixed mentor version across all comparison runs.
- **Isolation:** the mentor can read training attempts and dev scores, never the test split; the runner owns it.

**App shell:** a desktop app (Tauri or Electron, with a Next.js UI) that starts the runner and the local student in the background. Training needs the network for the teacher; the agent workspace does not.

## Evaluation and baselines

The claim: a teacher that diagnoses this student's actual failures produces a better graduate than simpler ways of spending the same budget.

| Method | What it does | Tests whether |
| --- | --- | --- |
| Bare student | The student with only the task description and tools | The task is hard enough to need help |
| One-shot guide | The teacher writes a full harness up front from the job setup and train examples, never sees attempts | Watching the student adds anything |
| Self-reflection | The student reviews its own failures and edits its own harness (Reflexion-style), same round budget | A stronger teacher adds anything |
| Architect | The teacher watches attempts, diagnoses, edits, predicts the effect, keeps or reverts | (proposed method) |

**Rules for every method:** same student, same tools, same train/dev data, same checker, same budget caps (rounds, teacher dollars, wall clock). Final numbers come only from the locked test set, run once per graduate.

**Measurements:**

- Primary: test pass rate of the graduate, teacher disconnected
- Per task type pass rate, latency p50/p95, refusal rate
- Cost to graduate: teacher tokens and dollars, rounds, wall clock
- Process: dev pass rate per round, share of interventions that helped vs hurt, how often the teacher's predicted effect matched the measured one
- Overclaim rate: how often the teacher said "ready" and the test disagreed

**Runs:** 3 seeds per method if budget allows; report every run, including failures. Three seeds on one task family is initial evidence, and the report says so.

**Related work to address in the README:** prompt optimization (DSPy, TextGrad), skill libraries (Voyager), self-reflection (Reflexion), ML-engineering agents (AIDE, MLE-bench). Architect's distinguishing points: student-specific diagnosis, enforced graduation on a locked test, and a teacher-off deployment.

## Scope, timeline, risks

The build runs Oct 27 to Nov 4, 9:00 PM ET. Must-haves first; anything else waits until the core loop produces a curve.

| Dates | Work |
| --- | --- |
| Oct 27 | First task + checker |
| Oct 28 to Oct 31 | Core loop + baselines |
| Nov 1 to Nov 2 | Main runs, 4 methods |
| Nov 2 to Nov 3 | Workspace UI, generality |
| Nov 3 to Nov 4 | Demo video + README |
| Nov 4, 9:00 PM ET | Submission deadline |

If the loop isn't producing a dev curve by Oct 31, cut the second task family and spend that time on more runs.

**In scope:** the desktop app (job setup, training view, report card, agent workspace); mentor adapters for Meta Model API and a self-hosted Muse Spark Open; Muse Glimmer as the student; one task family; the four comparison methods.

**Stretch, in order:** a second task family to test generality; a coding-agent mentor adapter (Claude Code); a second student for side-by-side comparison; a lineage explorer in the app; a LoRA weight-update mode for the harness vs weights comparison.

**Out of scope:** multiple students, cross-task memory, a hosted product.

| Risk | Fallback |
| --- | --- |
| Student runs too slowly locally, so few rounds fit | Hosted student endpoint during development, local for the demo |
| Bare student already passes most tasks, so no room for a curve | Harder tasks before the main runs |
| Teacher edits overfit to training tasks | Keep or revert on dev only; report the dev to test gap |
| Rules allow only work built during the event | Write all code Oct 27 to Nov 4; commit history and the README show what was built when |

Event notes (rules, submission, eligibility) live in [docs/HACKATHON.md](docs/HACKATHON.md).

## Open questions

- [ ] Does the student run fast enough locally to fit many rounds?
- [ ] Which demo job? It should be clearly not an education chatbot; ops or back-office work is safest.
- [ ] Which task family first, and which second one tests generality?
