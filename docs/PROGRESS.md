# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

## 2026-10-27 (Mon), Phase 0 into Phase 1

**Done**
- Docs: spec, agent rules (`CLAUDE.md`), plan, architecture, decisions 001 to 023, harness format, verified model facts (`MODELS.md`), gotchas. Two second opinions from GPT-6 Astra shaped the sample job (decision 005) and the evaluation protocol (decisions 006, 007, 009).
- Merged on main, 946 tests passing, CI green:
  - `packages/shared`: contracts and IPC schemas.
  - `packages/harness`: harness and graduate folders (validation, hashing, diffs, versions, `report.json` and `report.md`, lineage).
  - `packages/adapters`: Meta, Baseten and Modal mentors; Ollama and OpenAI-compatible students. Live-checked: Meta mentor with streaming, JSON-schema output and reasoning on both tiers; local Glimmer through Ollama.
  - `packages/ui` and `apps/desktop`: design tokens, component library, the app shell, settings, command palette; hidden Playwright screenshots in `docs/screenshots/`.
  - `examples/home-services`: Ferncliff Home Services, 180 audited tasks, `businessDate` 2026-11-05, every answer id tied to its own record (decision 018).
  - `packages/engine`: runtime (data, tools, QuickJS sandbox, agent loop, checkers, splitter, vault) and core loop (mentor gate, keep or revert, budgets, seeds, noise pilot, storage, report card, engine host), connected to the real packages by `createEngineDeps`. Runtime failures (server down, model missing, key rejected) stop an evaluation instead of counting as wrong answers.
- Developer scripts: `packages/engine/scripts/calibrate.ts` (bare pass rate, `--traces`) and `scripts/run.ts` (one headless run end to end, with a smoke profile).

**Feasibility checks**
- Meta Model API: key works. `GET /v1/models` lists `muse-spark-1.3` and `muse-spark-1.3-contributor` among others. A Chat Completions call to `muse-spark-1.3` with one tool and `reasoning_effort: "low"` returned a correct tool call (542 prompt tokens, 243 completion tokens, 173 of them reasoning).
- Muse Glimmer locally: works, slowly. `muse-glimmer:30b` (dense 30B, 18 GB at 4-bit) on an RTX 4070 Ti (12 GB) with 31 GB RAM: Ollama splits it 48% CPU / 52% GPU, 11.5 GB VRAM in use, about 9 GB of RAM. First load 27.6 s. Prefill about 520 tokens/s warm. Generation 5.5 to 5.7 tokens/s. One agent step took 143 tokens, about 26 s. GPU stayed at 45 C. `think: false` produced the same tokens with the reasoning hidden, so it saves nothing.
- Fallback applied (spec risk table): train on a hosted copy of Glimmer during development, and run the locked tests and the demo on the local model.
- Bare-student pass rate, measured:
  - Local Glimmer, 15 calibration tasks, 8-turn limit: 5/15 (overdue 5/5, invoices 0/5, scheduling 0/5). Traces showed every write task hitting the turn limit while still reading tables; decision 020 raised the default to 16.
  - Hosted Glimmer (OpenRouter, key added by the owner), 45 dev tasks: 30/45 at first. Scheduling failures were replies cut off by the 2,048-token output cap during reasoning, which the loop took as an empty final answer. Fixed: a cut-off reply now ends the attempt with a clear error, and the cap is 4,096. Re-measured: 34/45 = 76% (invoices 9/15, overdue 13/15, scheduling 12/15). Hosted attempts take about 18 s (p50) and cost about $0.018 each.
  - 76% bare against an 85% target leaves too little room, and a one-shot mentor would likely match Architect. After a second opinion from GPT-6 Astra: one bounded revision of the sample job (cross-customer overdue questions solvable within the turn budget, customer time windows for scheduling, paired boundary cases), then freeze; the current job stays as a secondary benchmark. In progress on its own branch.
- **Vertical slice with real models, verified end to end.** One run on local Glimmer with the contributor-tier mentor (smoke profile: train 9, dev 6, test 6, one round): bare dev 4/6. Round 1 diagnosis, from the trace: "Invoice task failed after correct manual math because 10+ sequential reads+calculates exhausted the 16-step budget before append_rows/ANSWER." The mentor wrote `tools/price_invoice` (a deterministic pricer reading the job's tables in the sandbox), a skill that uses it, a retrieval rule that loads the skill for invoice requests, and raised `max_steps` to 24; predicted +1 to +2, measured +2 (dev 6/6), kept; mentor cost $0.0019. Frozen, mentor released, locked test on local Glimmer: 5/6 (invoices 2/2, overdue 2/2, scheduling 1/2). Then a workspace chat with that graduate through the real agent host and its loopback guard: "Job W-2401 is done. Can you bill it?" loaded the skill, called the tool, asked to append one row (approved), and answered INV-2401, $270.91, in 106 s; the sample job's reference pricer gives the same 27,091 cents. The guard blocked zero network attempts.

**Merged since:** creation-flow screens, workspace and first-run screens, the workspace agent host (loopback-only guard, offline test), the desktop integration (supervised utility processes, encrypted keys, all IPC domains, packaging). 35 hidden e2e specs pass against the real engine. An independent review (Fable) found one real security issue, fixed: a job file could send a stored key to any host; keys are now bound to their service's hosts. Then the review's other fixes (rejected rounds visible to the mentor, split refusals end the run, locked-test reasons without expected values, wider leak fingerprint, firmer caps, secrets file safety, `devRepeats`, the incumbent measured again each round); version 2 of the sample job, frozen with a 95% bar (decision 021: bare hosted dev 36/45, calibration 11/15); where the locked test runs and a local re-test of a frozen graduate (`runs.start` `lockedTestOn`, `runs.retest`, one report per target); the experiment runner (`packages/engine/scripts/experiment.ts`).

**Dev noise and the keep rule (decision 022)**
- Noise pilot, starting harness, 45 dev tasks, three student seeds on hosted Glimmer: 39, 33, 36 at temperature 1 (14 tasks flipped); 37, 38, 34 at temperature 0.6 (15 flipped). Lower temperature didn't help, so decoding stays at Glimmer's recommended settings.
- One dev run's score moves with a standard deviation of about 2.3 tasks. Simulated with the pilot's per-task pass rates, the old rule kept a do-nothing change about 28% of the time.
- Now a change that clears the limits is measured again, both versions under new seeds, and kept only if the totals clear twice the limits: 11 to 15% for a do-nothing change in simulation, about 80% for a +4.5 change. Patience for the sample job is four reverts. GPT-6 Astra reviewed it first and agreed.
- The first start of seed 1 showed the one-shot baseline losing its only reply to a format slip in its worked examples, so it would have measured a typo. Every author now gets one fix for a reply the runner can't use (decision 023), and the mentor's guide shows the exact example format. That start was discarded and seed 1 restarted.

**Next**
- Main runs on version 2: four methods, seed 1 first, then seeds 2 and 3 if the cost fits. Hosted training and locked tests; local locked tests for one seed per method and the shipped graduate.
- Merge the screen clarity pass (in progress on its own branch); then show the second measurement in the round drawer, plot dev as pass rates, and count the possible second measurement in Define's time estimate.
- A real run through the app's screens, and a workspace chat with the graduate on the local model; real screenshots for the README.

**Open issues**
- Two commits reached main red today (a filtered local check hid failures); `pnpm check` now gates commits on its exit code.
- `docs/screenshots/` holds e2e screenshots with fixture data; the README must use screenshots of real runs.
- OpenRouter spend is the owner's money and the key is capped at $50: $4.05 used so far (calibration, both pilots, $0.70 on the discarded start), $45.95 left. Seed 1 of the main runs comes first, to measure the real cost before seeds 2 and 3.
- Self-hosted Spark Open needs Baseten or Modal credits, and the Baseten id must be confirmed with `GET /v1/models` once a key exists.

**Mentor spend:** about $0.01 of the $150 credit.
