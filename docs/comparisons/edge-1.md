# Comparisons: an offshore wind farm's maintenance desk, offline at the edge

Written on Nov 2, 2026 from the run's stored records (`runs/live-edge-1`, with `run.json` and `RUN.md`). Code: branch `qa/live-world` from `field/main` at `5d166650`, the app built with electron-vite and driven hidden through the QA driver's live world. The student was hosted Glimmer and the teacher Muse Spark 1.3 on Meta's API. The keys came from the environment by name; none was typed or saved.

## The result

On the sealed final test, Glimmer with the harness Spark wrote passed **32 of 32** tasks. Glimmer on its own passed **11 of 32** of the same tasks.

Paired task by task, that is **+66 points (95% interval +45 to +80)**: 21 wins and no losses. The interval is far above zero, so by the app's rule a gain is shown.

The agent trained in 5 minutes 17 seconds, from the first score to graduation. Everything in this report, the run and the experiment that measured Glimmer on its own, cost **$0.47**.

## What was asked

Merrow Bank is a fictional offshore wind farm of 40 turbines, run by a fictional operator. Its link to shore is a slow satellite connection that drops out, so its maintenance desk runs offline on the substation computer: Glimmer's 2-bit build on one 12 GB graphics card. The desk:

- triages SCADA fault alarms: shut the turbine down, dispatch a crew, or keep it running under watch, and names the policy rule that decides it;
- books the earliest crew transfer the weather, the vessels and the crew's certificates allow;
- checks whether a technician can go out as an alarm's specialist on a date.

The records are generated (`turbines.csv`, 40 rows; `alarms.csv`, 171; `crew.csv`, 30; `vessels.csv`, 7; `forecast.csv`, 96 hours) with a written policy (`maintenance-policy.md`). The policy is specific on purpose:

- gearbox levels that depend on the turbine's model;
- two readings that are bad when they run low;
- a dispatch rule for the third alarm of a code within 24 hours;
- departures from 06:00 to 14:00, 2 hours after the request at the earliest;
- a four-hour wave window against each vessel's limit, its area limit and the cheapest vessel;
- certificates checked on the day of the transfer, in a fixed order of reasons.

The job is checked on 96 worked cases with the answers the policy gives: 40 triage, 32 transfers, 24 specialist checks. A generator works them out from the policy, and a second implementation, written from the policy text alone, agrees on all 96. The checker is Architect's own and compares the decision and the rule, the departure, vessel and specialist, or the eligibility and its reason. It never compares wording.

## How it ran

A person's steps in the app, in the Lab edition:

1. Describe the job in plain words and attach the records and the worked cases.
2. Spark drafts the job in one call and asks nothing ($0.02).
3. Review Define and set the caps: 4 rounds, Spark at most $1, 2.5 hours. Train online, and run the sealed final test on the hosted copy.

The sets: 8 calibration, 32 practice, 24 held-out checks (Spark sees only their score) and 32 sealed in the vault.

| Step | Held-out checks | Note |
| --- | --- | --- |
| Glimmer before any teaching | 8 of 24 (33%) | triage 4 of 10, transfers 2 of 8, specialist checks 2 of 6 |
| Spark's first draft of the harness | 24 of 24 (100%) | Spark expected +14 to +20; measured +16. Kept. |

The draft met the 90% target, so training stopped after 1 of 4 rounds and went to the sealed final test.

**What Spark wrote.** It named the risks itself: the model-specific gearbox levels, the low-side readings, the 24-hour count, the transfer search and the order of reasons. Then it wrote three small tools that work each one out from the site's own files: `triage_alarm`, `find_transfer` and `check_specialist`. Each tool reads the tables through the sandbox and carries the policy's levels and rules; none holds an answer or a task's id. Around them are a skill for each kind of request, a worked example of each, five rules in `AGENTS.md`, and decoding at temperature 0.

## Glimmer on its own

The training run's report compares the base harness only on the held-out checks. Glimmer on its own was measured on the sealed test with the Lab's Experiments, in the app, on this job's own sealed split. The experiment was preregistered with its hypothesis, primary comparison, arms, seeds and caps frozen. Its arms:

- **Glimmer alone**: Glimmer on the base harness;
- **One-shot harness**: a fresh draft by Spark, before any practice, as this agent's harness was made.

Both took the same 32 sealed tasks as the graduate, under seed 101, with hosted Glimmer pinned to DeepInfra.

| | Glimmer alone | One-shot harness |
| --- | --- | --- |
| Sealed final test | **11 of 32 (34%, 20% to 52%)** | **32 of 32 (100%, 89% to 100%)** |
| Alarm triage | 4 of 13 | 13 of 13 |
| Crew transfers | 4 of 11 | 11 of 11 |
| Specialist checks | 3 of 8 | 8 of 8 |
| Held-out checks | 4 of 24 | 24 of 24 |
| Answer time, median and 95th percentile | 1.8 s, 22 s | 3.7 s, 6.9 s |
| Cost per 1,000 requests, hosted | $1.97 | $0.78 |

The intervals are Wilson 95% intervals; the paired difference uses Newcombe's method. The harness was cheaper per request than Glimmer alone: its tools need fewer tokens than reading the files by hand.

## Money

| | Spark | Hosted Glimmer |
| --- | --- | --- |
| Drafting the job | $0.0217 | |
| Training | $0.0649 | $0.0693 |
| Sealed final test | | $0.0237 |
| Experiment (calibration included) | $0.1010 | $0.1884 |
| Total | $0.188 | $0.281 |

The training run itself, with the drafting and the sealed final test, cost $0.18: $0.0866 of Spark and $0.0930 of hosted Glimmer. With the experiment, $0.47 in all, against a $4 cap for the session. OpenRouter's usage rose by $0.2814 over the session, the same as the app's records. No GPU was used.

## Limits

- The graduate was tested on the hosted copy, the full model, not on the 2-bit build it runs on at the edge. That build hasn't taken this test.
- One generated site, 32 sealed tasks, one seed.
- The experiment was registered after the training run's sealed test was read. Its one-shot arm is a fresh draft, not the graduate's own harness.
- The training run routed hosted Glimmer to any provider; the experiment pinned DeepInfra.
- The policy's levels live in the tools' code, so a revised policy needs a new version.
- The worked cases were attached, not made by Architect from the tables: its four templates make lookups, lists, totals and numeric rules, and a shutdown decision or a booking is none of these.

## What the run found in the product

The run found three bugs, each fixed on `qa/live-world` with a test:

- **Lab experiments couldn't run any arm that writes tools.** The app gave the experiment runner no sandbox entry, so every such arm paused at once (`5a008e01`).
- **The agent home and Models called the 2-bit build "4-bit"** (`7fba4716`).
- **Models showed every trained version's harness hash as "sha256-"** (`e56ce687`).

`RUN.md` in the run folder lists the open UI and copy issues, each with its screenshot.
