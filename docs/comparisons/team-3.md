# Comparisons: the third agent-team run

Written on Nov 2, 2026 from the run's stored records, in `runs/team-3`. Code: a pinned checkout of Architect at `57fa006e` (`team/plate-fits`), unchanged, with no patches. It holds decision 106, the change made after [team-2](team-2.md). When a harness helper's result is too long to show, the agent still sees it cut, but `run` code can now read the whole of it. A teammate's run that ends on a tool call written as text now comes back to the lead as no answer. The student was hosted Glimmer in both arms. The plan (`team-3/PLAN.md`) was written before any model was called, with one amendment for the provider's rate limit.

## The result

**Still no pass in either arm: the team passed 0 of 20 and Inventory desk alone 0 of 20.** The prediction was 2 to 8 team passes, so it was wrong. Assay desk found exactly the plate's list in two asks (first reported as one; corrected in [team-4](team-4.md), where the other filled its context two steps later). In one, at Fenwick, team attempt 3, it read plate FW-0418 whole through the new path and found FWC-13399 (inconclusive) and FWC-13444 (borderline), the two compounds the lead needed. No ask had done that in team-1 or team-2. It then tried to queue them in `retests.csv`. Without a terminal that write needs an approval no one can give, so the whole reply ended there (`approval_required`), and the lead never got the list. The plan named this risk in advance.

| Lab | Request's task (split) | Team | Inventory desk alone |
| --- | --- | --- | --- |
| Fenwick Screening Core | `fenwick-allocate-01` (train) | 0 / 5 | 0 / 5 |
| Alder Row Biosciences | `alder-row-allocate-01` (dev) | 0 / 5 | 0 / 5 |
| Saltmarsh Institute Assay Lab | `saltmarsh-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **Corvid Hill Discovery**, the lab neither desk was taught on | `corvid-hill-allocate-01` (locked test) | 0 / 5 | 0 / 5 |
| **All** | | **0 / 20** | **0 / 20** |

The change fixed the cause it was aimed at, but Glimmer seldom used it. 47 asks got a cut plate result whose note named the path, and in only 5 of them did Assay desk's code read the whole result.

## What changed, and why

team-2's stored consultations showed why Assay desk never answered. Every one of the 67 `assay_plate` calls at the taught labs returned more than the 8,000 characters a tool result may take. FW-0418's result is 16,124 characters. The helper writes its per-well maps first and its per-compound summary last, so the cut kept the wells and dropped most of the compounds, the part every Assay desk skill reads. The note said "ask for less", which a helper can't be asked. So Assay desk called the helper again, got the same cut, and rebuilt the plate from the raw files with as many as 14 pieces of code. Its own calls stay in the context, so the run filled the context or used up its 30 steps.

Decision 106 keeps such a result whole where `run` code can read it. The note now ends `run code has it whole as JSON.parse(files.read("results/assay_plate.json"))`. Checked with no model, a four-line `run` on that path reads FW-0418's Z′ and all 74 compounds' means and ranges. Nothing changed in either agent: no harness, checker, split, vault or weight. Codex (GPT-6 Astra) reviewed the branch before the run. It found two gaps, both fixed with tests: a teaching correction from a checkpoint lost the kept results, and the markup check matched tags like `<cfg:parameter-set>`.

## Against team-2

| | team-2 | team-3 |
| --- | --- | --- |
| Team replies that asked | 18 of 20 | 19 of 20 |
| Asks that ran (a reply may run at most 4) | 66 | 69 |
| Asks the tool refused at the cap | 79 | 106 |
| Asks whose plate result was cut, with the new note | - | 47 |
| Asks whose code read the whole result | - | 5 |
| Asks in which Assay desk found the plate's whole list | 0 | 2 (corrected in [team-4](team-4.md); first reported as 1) |
| Teammate answers that named every compound on the plate's list | 0 | 0 |
| Team replies that ended at a teammate's write (`approval_required`) | 0 | 1 |
| Team passes / solo passes | 0 / 0 | 0 / 0 |
| Median time, team / solo | 360 s / 15 s | 398 s / 18 s |
| Spend, team / solo | $2.18 / $0.17 | $2.38 / $0.16 |

## How the asks ended

| How the ask ended | team-2 | team-3 |
| --- | --- | --- |
| Assay desk ran out of its 30 steps | 31 | 33 |
| Assay desk's context filled | 14 | 14 |
| A tool call written as text, with no tool run | 15, passed to the lead as answers | 12, now settled as no answer |
| Answered in words | 6 | 9 |
| Stopped by the reply ending at its write | 0 | 1 |

Asks that ran out of steps or filled the context went from 45 of 66 to 47 of 69. The plan predicted fewer than half, and that prediction was wrong too. The markup change did what it was for: the lead now reads "Assay desk wrote a tool call as text instead of running it, so it gave no answer. Ask it again." where team-2's lead read the markup itself.

## What Assay desk did with the note

Of the 5 asks whose code read the whole result, 4 still ran out of steps and 1 found the list. Across all 47 asks with a cut result (`scripts/habits.mts`, counts only):

| What Assay desk did after its plate result was cut | Asks of 47 |
| --- | --- |
| Read or grepped `compounds.csv` or the export, to rebuild the plate | 47 |
| Called `assay_plate` again | 42 |
| Ran code that started with `require(...)`, which the sandbox doesn't have | 39 |
| Tried the `read` tool on the path, which only `run` serves ("There is no results/assay_plate.json. Your folders are data/, skills/.") | 15 |
| Read the whole result in `run` code, as the note says | 5 |

So the note was seen more often than it was followed. In 15 asks Assay desk went for the path with `read`, the tool it reaches for first, and was told the file isn't there.

**The one ask that worked (Fenwick, team attempt 3, a train task, quoted).** The lead asked:

> It's Wednesday, October 14, 2026. For work identifier FW-0418, provide the re-test plan: list each compound_id that requires a re-test, and the number of re-tests needed per compound. Return a list of objects with compound_id and retest_count.

Assay desk read `plates.csv`, `policy.md` and `retests.csv`, called `assay_plate`, and first tried to rebuild the plate from the export, which failed. It called `assay_plate` again, then read the kept result in code, merged compound ids that differ only in case, and applied the policy's band and agreement rule. Its code printed:

> candidates 2 | [{"compound_id":"FWC-13399","mean":null,"range":null,"missing":true,"inconclusive":true,...},{"compound_id":"FWC-13444","mean":45.31107738998482,"range":0,"missing":false,"inconclusive":false,"borderline":true,...}]

That is the list in the team demo (`examples/inventory-desk/README.md`). Its retest skill then took it to queue the two: `next_ids` gave RT-0006 and RT-0007, and it appended `RT-0006,FW-0418,FWC-13399,INCONCLUSIVE,2026-10-14` and `RT-0007,FW-0418,FWC-13444,BORDERLINE,2026-10-14`. Those are the rows the demo expects. In a non-interactive run that write ends the reply (decision 100), so nothing was written, and the lead never saw the list. The reply took 91 seconds.

**The other answers in words.** At Alder Row the lead again asked for rows of `retests.csv`, and both answers came from the one row booked a week earlier (`R-105, ARX000486`), as in team-2. At the locked-test labs (not quoted), 7 asks were answered in words, and none named every compound on the plate's list.

## How the replies ended

| | Team | Alone |
| --- | --- | --- |
| No ANSWER line: out of steps, the context full, a timeout, a question back, or the teammate's write | 16 | 7 |
| Wrote a tool call as text and stopped, with no tool run | 1 | 10 |
| Gave an ANSWER line, wrong | 3 | 3 |
| Listed exactly the plate's compounds | 0 | 0 |

## What this says about the team feature

- **The overflow had a clear cause, and it now has a way out.** When Assay desk used the kept result, it found the right list. That had never happened before. But in 42 of 47 asks it didn't use it. The note comes at the end of 8,000 characters of digits, and Glimmer mostly goes back to its old habit of rebuilding the plate from files. In 15 asks it tried to open the path with `read`, which says the file isn't there. Serving the kept result to `read` as well as `run` is the obvious next change; it isn't made or measured here.
- **A teammate's write ends a non-interactive team reply.** Assay desk's re-test skills always queue what they find, and a run with no one to approve stops the whole reply at that write. So even a perfect read can't reach the lead on this path. The person approving on a card, as in the demo, would let it through. A lead asking a read-only question has no way to say "don't queue". Either is a product decision, not made here.
- **The lead still asks for the wrong thing at Alder Row.** It asks for rows of `retests.csv` rather than for the plate's result, as in team-2.
- **Cost.** A team attempt averaged about $0.12 and took a median 6.6 minutes, against $0.008 and 18 seconds alone.

## The student, and how it was reached

Hosted Glimmer, `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback, through team-2's relay on 127.0.0.1:8431, as in team-1 and team-2. The agent host and its network guard saw only 127.0.0.1. The relay's journal adds one yes/no flag per request: 689 requests carried the new note, which shows the change reached the model.

## The amendment

From 05:04:59 to 05:06:01 UTC, OpenRouter answered 18 requests with 429 (rate limited). Three attempts got them: team-saltmarsh-5, solo-saltmarsh-5 and team-corvid-hill-5. The two at Saltmarsh ended at the 429, and I stopped the third. That was a fault in the bridge, not the agents, so amendment 1 (`team-3/PLAN.md`) changed only the relay: it now waits out a 429, up to 4 times, before passing anything back. The three attempts were set aside and run once more. It was written before any result was graded or read. At that point I had seen only the locked labs' exit codes. The fixed relay never had to retry. One slip in the re-runs is in the plan's run record: a shell timeout cut the script while team-saltmarsh-5 ran on to its end, so that attempt's exit code was lost. Its saved chat is graded like every other.

## Spend

**$2.62 of the $4 cap**: team arm $2.38 (1,895 requests, the re-runs included), alone $0.16 (233), the three set-aside attempts $0.07 (62). The relay held a $3.80 cap, under the key's $3.95 balance. Every request was journalled before it was sent and settled at OpenRouter's billed cost, except one cut off by the stop, which is counted at its reservation (`team-3/SPEND.md`). No mentor, no Spark, no training. No local GPU: Ollama held no model before or after, and nothing ran `architect verify` or llama-server.

## Limits

- **Few requests.** Four plates, five attempts each per arm. With zero passes on both sides, the run can't say how much a working ask would add.
- **One working read, at one lab.** The kept result led to the right list once, at Fenwick, on a train task. That is one case, not a rate.
- **The write path wasn't measured.** The one right list ended at its write, as it must without a terminal. What the lead would have done with it is unknown.
- **One batch.** Each reply took the host's own random seed, and both harnesses decode at temperature 0.
- **The chat path.** Both arms ran as CLI conversations. Both agents were developed in task mode.
- **Two of four tasks were seen in development.** Fenwick's is a train task and Alder Row's a dev task for Inventory desk.
- **Two changes measured together.** The kept result and the markup outcome went in together. Their effects are told apart only by how each ask ended.

## Where the records are

`C:/JakeOS/projects/architect/runs/team-3`: `PLAN.md` (with amendment 1 and the run record), `SPEND.md`, `spend.jsonl`, `requests.jsonl` (identical to team-2's), `attempts.jsonl` (the counted attempts) and `attempts-set-aside.jsonl`, `results.jsonl` (one line per attempt; a locked-test lab's has no reason and no quoted text), `asks-taught.jsonl`, `hashes/`, the taught labs' stdout and stderr in `attempts/`, the saved chats in `data/`, the scripts in `scripts/` (with `diagnose-team-2.mts`, which read team-2's taught consultations, and `plate-fits.mts`, the check with no model), `run.sh` and `run3.sh`, and both packages in `packages/`.
