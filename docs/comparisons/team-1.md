# Comparisons: the first agent-team run

Written on Nov 1, 2026 from the run's stored records, in `architect-runs/team-1`. Code: a pinned checkout of Architect at `3b29a8e4` (field/main), unchanged, with no patches. The student was hosted Glimmer in both arms. The plan (`team-1/PLAN.md`) was written before any model was called.

## The result

**No pass in either arm. The team passed 0 of 20 and Inventory desk alone passed 0 of 20.** Per lab, team against solo:

| Lab | Request's task (split) | Team | Inventory desk alone |
| --- | --- | --- | --- |
| Fenwick Screening Core | `fenwick-allocate-01` (train) | 0 / 5 | 0 / 5 |
| Alder Row Biosciences | `alder-row-allocate-01` (dev) | 0 / 5 | 0 / 5 |
| Saltmarsh Institute Assay Lab | `saltmarsh-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **Corvid Hill Discovery**, the lab neither desk was taught on | `corvid-hill-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **All** | | **0 / 20** | **0 / 20** |

So this run doesn't show that a team answers what the lead can't answer alone. It shows something earlier in the chain: **the lead almost never asked.** Inventory desk called `ask_teammate` in 2 of its 20 team replies, once at Alder Row and once at Corvid Hill. Neither ask brought back the plate's list of compounds. In the other 18 it looked for the plate in its own files, which never name it, or it didn't run a tool at all.

## What was asked

Each lab's first `allocate` task allocates exactly the list Assay desk queues for one plate (`examples/inventory-desk/README.md`, "The team demo"). The run rewrote each one as a request that names only the plate. The request was built in code from the task itself: its first sentence (the lab's day), the fixed question "Which lot should each of `<plate>`'s re-tests come from?", and the task's own answer line. For Fenwick:

> It's Wednesday, October 14, 2026. Which lot should each of FW-0418's re-tests come from? End with: ANSWER: {"allocations": [...]}

Code checked that no request names a compound, that none of Inventory desk's files for the lab names the plate, and that Assay desk's `plates.csv` does. Every answer was graded by the Inventory desk job's own checker (`createChecker`, its `allocation` validator) against that allocate task's expected result. Two of the four tasks are in Inventory desk's locked test, Saltmarsh's and Corvid Hill's. They were read through the vault's `openForLockedTest`, the way a locked test opens once the mentor is released, and kept in memory. This report gives only their ids and pass or fail. Fenwick's task is a train task and Alder Row's a dev task, so their details are quoted below.

## The arms

Each request ran 5 times in each arm, every time as a fresh `architect run ... --non-interactive --save`, with the one request on stdin and no history.

- **Team:** `architect run --team "Screening logistics"`, a team made with the engine's own `teams.create`. Inventory desk (`grd_mvxet7nj59cab32f6c`, inventory-1's taught agent) leads and Assay desk (`grd_mvxiq84u45d329855b`, assay-2's taught agent) is its teammate.
- **Alone:** `architect run grd_mvxet7nj59cab32f6c`, the same chat path with no teammate.

Both agents went into one fresh data folder through `architect export` and `architect install`. Before each lab, each agent's `data/` folder was bound to its own job's files for that lab: the job folder's for a taught lab, the vault's own folder for Corvid Hill. Every bound file hashed the same before and after each lab, so nothing was written.

## How the replies ended

| | Team | Alone |
| --- | --- | --- |
| Ran out of its 30 steps without an answer | 8 | 9 |
| Wrote a tool call as plain text and stopped, with no tool run | 9 | 7 |
| Gave an ANSWER line, wrong | 3 | 4 |
| Listed exactly the plate's compounds | 0 | 0 |

**Out of steps.** The lead reads `policy.md`, then searches `inventory.csv` and `reservations.csv` for the plate, again and again, in every form it can think of: `FW-0418`, `FW-0`, `0418`, `^FW-`. Its files hold compounds and lots, not plates, so nothing matches, and the reply stops at step 30.

**A tool call written as text.** In 16 of the 40 replies, Glimmer's first turn after loading a skill was a tool call written out as text (`<…:invoke>`, `<…:parameter name="path">data</…>`) rather than a real call. The reply ended in 2 to 6 seconds with no tool run and no answer. This isn't something the bridge introduced: the same text shows up in the comparison runner's own traces from inventory-1, which called OpenRouter directly (34 of the taught arm's 192 traces, 9 of bare's 24). It happened more often here (40% against 18%). The arms differ in two ways that may explain it: this run uses the chat path rather than task mode, and its requests name no compounds.

**Wrong answers.** None of the seven ANSWER lines listed exactly the plate's compounds. The three at Alder Row all left out ARX000492 (`allocations has no entry for ARX000492`). Alone or not, the lead guessed a list, because nothing in its files tells it what the list is.

## The two asks, and what crossed

Only text crosses between members, by design (decision 100). The lead writes a request, the teammate works on its own files in task mode with no history, and the lead gets back the teammate's final text.

**Alder Row, team attempt 5 (dev task, quoted whole).** The lead asked:

> It's Wednesday, October 21, 2026. For compound AR-2214, provide the re-test plan: list each re-test (e.g., re-test 1, re-test 2, ...) that needs to be performed on that date. Return the compound ID and the number of re-tests required.

It called the plate a compound, and asked how many re-tests there were rather than which compounds needed one. Assay desk read its policy, `plates.csv` and `retests.csv`, then ran its `assay_plate` tool on AR-2214 three times, grepped `compounds.csv` eight times and ran code over it seven times. It spent all 30 of its steps and never answered. The lead got back: "Assay desk stopped after 30 steps without an answer." The lead then went back to its own files and ran out of its own steps (29 tool calls besides the ask). The run took 161 seconds, the longest in the run.

**Corvid Hill, team attempt 2 (locked test, not quoted).** The lead's request (205 characters) named the plate. Assay desk answered in 294 characters without running a single tool, so it had not read the plate. Its answer didn't name every compound on the plate's list. The lead then ran out of steps without an ANSWER line.

## What this says about the team feature

The mechanics worked end to end, without a terminal and with nothing to approve. The CLI opened both members in one agent host under the network guard. It offered the lead `ask_teammate`, ran the teammate in its own folder, and saved each consultation with its outcome (`out_of_steps`, `answered`). Each member read only its own job's files for the lab.

What failed is the delegation, and decision 100 names this limit in advance: no lead was taught to delegate, and it asks only because the tool's description invites it. In practice Inventory desk treats a plate it doesn't recognise as something to find in its own files. When it did ask, it didn't say what it needed back (the list of compounds to re-test). Assay desk, for its part, has the weakness assay-2 found: its `assay_plate` tool returns every well of a plate, and on the one ask where it read the plate it ran out of steps.

Before a team result can mean anything here, the lead has to ask. That points to the team check decision 100 calls phase 2: team tasks the mentor can measure delegation on, so Improve agent can teach Inventory desk when to ask and what to ask for.

## The student, and how it was reached

Hosted Glimmer, `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback, as in inventory-1 and assay-2. The product opens an agent only on a model at a loopback address (invariant 3). So both agents were installed on `openai_compatible` at `127.0.0.1:8431`, and a relay outside the product, in the run folder (`scripts/relay.mjs`), forwarded each chat completion to OpenRouter. It sent what the runner's `openrouter-glimmer` endpoint sends: Glimmer's reasoning level as `reasoning.effort` and as the system line, and the DeepInfra pin. The agent host and its network guard saw only 127.0.0.1. All 627 requests returned 200 from DeepInfra.

## Spend

**$0.47 of the $4 cap**: team arm $0.26 (333 requests), alone $0.20 (294), every request billed at OpenRouter's reported cost and journalled before it was sent (`team-1/SPEND.md`, `spend.jsonl`). No mentor, no Spark, no training. No local GPU: Ollama held no model before or after, and nothing ran `architect verify` or llama-server.

## Limits

- **Few requests.** Four plates, five attempts each per arm. With zero passes on both sides, the run can't tell the arms apart, and it can't say how much a working ask would add.
- **One batch, one seed source.** Each reply took the host's own random seed, and both harnesses decode at temperature 0, so repeats are close to one another rather than independent.
- **The read-only skill only.** Only `allocate` was asked, so no write and no approval was exercised. A team reply that reserves stock, with an approval on each member's card, is untested live.
- **The chat path, not task mode.** Both arms ran as conversations through the CLI, while both agents were developed and tested in task mode. The tool-call-as-text failure was more common here than in the runner's traces.
- **Two of four tasks were seen in development.** Fenwick's allocate task is one of Inventory desk's train tasks and Alder Row's is one of its dev tasks, with the compound list in the request. The plate-only wording is new to it.
- **No lead taught to ask.** The result measures the tool's description as the only cue for delegating.

## Where the records are

`C:/JakeOS/projects/architect-runs/team-1`: `PLAN.md` (with its run record), `SPEND.md`, `requests.jsonl`, `attempts.jsonl`, `results.jsonl` (one line per attempt; a locked-test lab's has no reason and no quoted text), `hashes/`, the taught labs' stdout and stderr in `attempts/`, the saved chats in `data/`, the scripts in `scripts/`, and both packages in `packages/`.
