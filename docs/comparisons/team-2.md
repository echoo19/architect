# Comparisons: the second agent-team run

Written on Nov 1, 2026 from the run's stored records, in `runs/team-2`. Code: a pinned checkout of Architect at `53b52a38` (field/main), unchanged, with no patches. It holds `team/ask-when`, the change made after [team-1](team-1.md): the lead's system prompt in a team reply now says when to ask a teammate, and `ask_teammate` names each teammate's files (decision 100, amendment). The student was hosted Glimmer in both arms. The plan (`team-2/PLAN.md`) was written before any model was called, with one amendment after the first two attempts.

## The result

**Still no pass in either arm: the team passed 0 of 20 and Inventory desk alone 0 of 20. But the lead now asks.** It asked Assay desk in 18 of its 20 team replies, against 2 of 20 in team-1. The asks didn't bring back what the lead needed: in 66 asks that ran, Assay desk never once returned a plate's list of compounds to re-test.

| Lab | Request's task (split) | Team | Inventory desk alone |
| --- | --- | --- | --- |
| Fenwick Screening Core | `fenwick-allocate-01` (train) | 0 / 5 | 0 / 5 |
| Alder Row Biosciences | `alder-row-allocate-01` (dev) | 0 / 5 | 0 / 5 |
| Saltmarsh Institute Assay Lab | `saltmarsh-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **Corvid Hill Discovery**, the lab neither desk was taught on | `corvid-hill-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **All** | | **0 / 20** | **0 / 20** |

So the change did what it was for: the lead knows when to ask. The gap has moved one step down the chain, to what the lead asks for and what the teammate can do with it.

## Against team-1

| | team-1 | team-2 |
| --- | --- | --- |
| Team replies that asked | 2 of 20 | **18 of 20** |
| Asks that ran (a reply may run at most 4) | 2 | 66 |
| Asks the tool refused at the cap | 0 | 79 |
| Teammate answers that named every compound on the plate's list | 0 | 0 |
| Team replies with a tool call written as text, no tool run | 9 | 1 |
| Team passes / solo passes | 0 / 0 | 0 / 0 |
| Median time, team / solo | 27 s / 19 s | 360 s / 15 s |
| Spend, team / solo | $0.26 / $0.20 | $2.18 / $0.17 |

The relay's journal shows the change reached the model. All 502 of the lead's requests in team replies carried the new line, `ask_teammate` and the teammate's file list. None of the 1,289 requests from the teammate's own runs carried them, and none of the 236 solo requests did.

## What the lead asked, and what came back

Only text crosses between members, by design (decision 100). The tool's cap held: no reply ran more than 4 asks. The lead often kept trying after the cap (79 refused asks, up to 15 in one reply) before it answered or ran out of steps.

**The 66 asks that ran ended like this:**

| How the ask ended | Asks |
| --- | --- |
| Assay desk ran out of its 30 steps | 31 |
| Assay desk's context filled ("This task needs more room than the model's context allows") | 14 |
| Marked answered, but the answer was a tool call written as text, with no tool run | 15 |
| Answered in words | 6 |

The context and step failures are the weakness assay-2 found: Assay desk's `assay_plate` tool returns every well of a plate, and its run fills the 16,384-token context or the step limit before it answers. The 15 markup answers are the same tool-call-as-text output team-1 saw from the lead. Here it came from the teammate's run, and the product passed it to the lead as an answer, because the run ended with text.

**What the lead asked for** (Alder Row and Fenwick, quoted; `team-2/asks-taught.jsonl` has every one). The lead now says what it needs, but mostly in its own terms. It still often calls the plate a compound, and it asks for queued re-tests rather than for the plate's result:

> It's Wednesday, October 21, 2026. For AR-2214, provide the re-test plan: list each re-test that needs stock, with the compound_id for each re-test. If multiple re-tests for the same compound, list them separately or indicate the count per compound. I need the compound IDs to allocate stock from inventory.

> Please read retests.csv and find all rows where request_id is AR-2214. Return the compound_id values for those rows, in order they appear.

> For plate FW-0418, list compound_id values from retests.csv where plate_id = FW-0418. Return up to 100 compound_ids, one per line.

Several asks name `retests.csv`, a file the new file list showed the lead. That file is Assay desk's queue of re-tests already booked, not the plate's results. The compounds a plate needs re-tested come from reading its QC export against the lab's policy, which is Assay desk's plate report.

**What came back.** At Alder Row, Assay desk twice read `retests.csv` and answered with its one row for AR-2214, `R-105, ARX000486, edge, 2026-10-14`. That was a re-test booked a week before the request's day, for a compound not on the plate's list. In two team replies (attempts 1 and 3) the lead then allocated stock for ARX000486 from its own store: lot LOT919 at F4/Box33/A7, 15 µL. That is a real chain: the teammate's text crossed, and the lead's answer was built on it, but on the wrong list. At Fenwick, Assay desk found no FW-0418 row in `retests.csv` and said so ("Total count: 0"). In one reply (team-fenwick-1) the lead ended by asking the person: "I need the list of compounds for re-test plate FW-0418 from the Assay desk. Could you provide the compound IDs and the number of re-tests required for each?"

At Saltmarsh and Corvid Hill (locked test, not quoted), the asks ended the same ways. There were 9 "answered" asks there, 7 of them markup. No answer named every compound on the plate's list.

## How the replies ended

| | Team | Alone |
| --- | --- | --- |
| No ANSWER line: out of steps, the context full, or a question back | 14 | 6 |
| Wrote a tool call as text and stopped, with no tool run | 1 | 6 |
| Gave an ANSWER line, wrong | 5 | 8 |
| Listed exactly the plate's compounds | 0 | 0 |

Alone, Inventory desk does as in team-1: it guesses or searches its own files for the plate. At Fenwick it twice answered without FWC-13399, and at Alder Row once without ARX000492.

## What this says about the team feature

- **When to ask: fixed.** One line in the lead's prompt and the teammate's file names took asking from 2 of 20 replies to 18 of 20.
- **What to ask for: not yet.** The lead asks for rows of a file it saw named (`retests.csv`), or for "the re-test plan", not for the work only the teammate can do: read plate X and say which compounds need a re-test. A file list tells the lead where data is, not which of the teammate's skills produces what it needs. The teammate's skills are already listed ("It handles: ..."), and the lead still asked for file rows.
- **The teammate has to be able to do it.** Assay desk's plate work overflows its context on these plates (assay-2), so even a well-put ask would often fail. That weakness is the Assay desk agent's, not the team's.
- **An answer that is markup isn't an answer.** A teammate's run that ends on a tool call written as text is recorded as answered, and the lead reads markup. The consultation could tell this case apart, as `no_answer`, so the lead knows to ask again or answer without it. That is a candidate fix, not made here.
- **Cost.** Asking costs: a team attempt averaged about $0.11 and 6 minutes, against $0.008 and 15 seconds alone, mostly in the teammate's failing runs and the lead's asks after the cap.

## The student, and how it was reached

Hosted Glimmer, `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback. As in team-1, both agents were installed on `openai_compatible` at `127.0.0.1:8431`, and a relay outside the product, in the run folder, forwarded each request to OpenRouter as the runner's `openrouter-glimmer` endpoint would (`team-1.md`, "The student"). The relay also wrote three yes/no flags per request (team line, tool offered, files listed), and no text. The agent host and its network guard saw only 127.0.0.1. All 2,027 requests returned 200 from DeepInfra.

## The amendment

The first team attempt (Fenwick) asked five times and cost $0.163, about twelve times a team-1 team attempt. At that price the run would pass the $3 cap, and in the planned order (lab by lab) the cap would have cut Corvid Hill, the last lab. After that attempt and its solo pair, and before any other, I stopped the run. Amendment 1 (`team-2/PLAN.md`) changed only the order and the stopping: k outer and the labs inside it, and a pair starts only with $0.45 still free. The attempt that had just begun (team-fenwick-2, 46 seconds in) was stopped and not counted; its $0.024 counts. The guard never stopped a pair, so all 40 ran.

## Spend

**$2.37 of the $3 cap**: team arm $2.18 (1,778 requests), alone $0.17 (236), the stopped attempt $0.02 (13). Every request was journalled before it was sent and settled at OpenRouter's billed cost. The one exception is the stopped attempt's last request, cut off before its usage came, which is counted at its reservation (`team-2/SPEND.md`). No mentor, no Spark, no training. No local GPU: Ollama held no model before or after, and nothing ran `architect verify` or llama-server.

## Limits

- **Few requests.** Four plates, five attempts each per arm. With zero passes on both sides, the run can't say how much a working ask would add.
- **One batch.** Each reply took the host's own random seed; both harnesses decode at temperature 0.
- **The read-only skill only.** No write and no approval was exercised.
- **The chat path.** Both arms ran as CLI conversations; both agents were developed in task mode.
- **Two of four tasks were seen in development.** Fenwick's is a train task and Alder Row's a dev task for Inventory desk.
- **Order.** After amendment 1 the labs ran round-robin, where team-1 ran them lab by lab. Every attempt is a fresh process and a fresh chat, so the order changes no attempt's input.
- **One change measured.** The prompt line and the file list went in together, so this run can't say which of the two raised the asks.

## Where the records are

`C:/JakeOS/projects/architect/runs/team-2`: `PLAN.md` (with amendment 1 and the run record), `SPEND.md`, `spend.jsonl`, `requests.jsonl` (identical to team-1's), `attempts.jsonl`, `results.jsonl` (one line per attempt; a locked-test lab's has no reason and no quoted text), `asks-taught.jsonl`, `hashes/`, the taught labs' stdout and stderr in `attempts/`, the saved chats in `data/`, the scripts in `scripts/`, `run.sh` and `run2.sh`, and both packages in `packages/`.
