# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

## 2026-10-27 (Mon), Phase 0

**Done**
- Read the spec, the build brief and the design canvas (Describe, Clarify, Define, Train, Graduate, Use, and a design-system board).
- Wrote the spec, agent rules (`CLAUDE.md`), plan, architecture, decisions 001 to 012, harness format, gotchas.
- Sample job chosen (decision 005) after a second opinion from GPT-6 Astra.

**Feasibility checks**
- Meta Model API: key works. `GET /v1/models` lists `muse-spark-1.3` and `muse-spark-1.3-contributor` among others. A Chat Completions call to `muse-spark-1.3` with one tool and `reasoning_effort: "low"` returned a correct tool call (542 prompt tokens, 243 completion tokens, 173 of them reasoning).
- Muse Glimmer locally: works, slowly. `muse-glimmer:30b` (dense 30B, 18 GB at 4-bit) on an RTX 4070 Ti (12 GB) with 31 GB RAM: Ollama splits it 48% CPU / 52% GPU, 11.5 GB VRAM in use, about 9 GB of RAM. First load 27.6 s. Prefill about 520 tokens/s warm. Generation 5.5 to 5.7 tokens/s. One agent step (a correct `read_table` tool call at `think: low`) took 143 tokens, about 26 s, so a 4 to 6 step task takes 2 to 3 minutes. GPU stayed at 45 C. `think: false` produced the same 147 tokens with the reasoning hidden, so it saves nothing.
- Fallback applied (spec risk table): train on a hosted copy of Glimmer during development, and run the locked tests and the demo on the local model. A 60-task locked test takes about 2.5 hours locally, so local tests run overnight or on a smaller set.
- Bare-student pass rate on the sample job: not measured yet; needs the runtime (in progress).

**Merged:** `packages/harness` (folders, validation, hashing, diffs, versions, graduate folders with `report.json` and `report.md`, lineage) and `packages/adapters` (Meta, Baseten and Modal mentors; Ollama and OpenAI-compatible students). 523 tests pass on main.
**Live checks through the adapters:** Meta mentor with streaming, JSON-schema output and reasoning works on both tiers (contributor $0.00004, standard $0.0008 for a tiny call). Local Glimmer answers through the Ollama adapter (`/api/show` reports `thinking` and `tools`; Q4_K_M, 27.9B parameters) and unloads afterwards.

**In progress (parallel, one branch each):** design tokens, component library and desktop shell; the sample job; engine runtime (data, tools, sandbox, agent loop, checkers, splits, vault); core loop (mentor, keep or revert, budgets, storage, report card, host). Next to start: the workspace agent host (brief ready), once the runtime merges.

**Mentor spend:** about $0.01 of the $150 credit.
