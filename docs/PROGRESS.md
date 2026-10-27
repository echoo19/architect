# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

## 2026-10-27 (Mon), Phase 0

**Done**
- Read the spec, the build brief and the design canvas (Describe, Clarify, Define, Train, Graduate, Use, and a design-system board).
- Wrote the spec, agent rules (`CLAUDE.md`), plan, architecture, decisions 001 to 012, harness format, gotchas.
- Sample job chosen (decision 005) after a second opinion from GPT-6 Astra.

**Feasibility so far**
- Meta Model API key works. `GET /v1/models` lists `muse-spark-1.3` and `muse-spark-1.3-contributor` among others. A Chat Completions call to `muse-spark-1.3` with one tool and `reasoning_effort: "low"` returned a correct tool call: 542 prompt tokens, 243 completion tokens (173 of them reasoning).
- Muse Glimmer is a dense 30B model (Hugging Face config: 52 layers, no experts). `muse-glimmer:30b` is already pulled in Ollama (18 GB). With 12 GB of VRAM it partly runs from system RAM; speed not yet measured because only 4 GB of RAM was free (another program held 14 GB).

**Next**
- Scaffold the monorepo, CI, tokens and component library; push the public repo.
- Measure Glimmer tokens per second and memory once RAM is free.
- Contracts in `packages/shared`, then parallel work on engine, adapters, harness, sample job and UI.

**Open issues**
- No hosted Glimmer endpoint key yet (OpenRouter, Together or Fireworks), and no Baseten or Modal credits for self-hosted Spark Open.

**Risks**
- Local Glimmer speed decides how many rounds fit. Fallback from the spec: hosted student for development, local for the demo and the locked test.

**Mentor spend:** under $0.01 of the $150 credit.
