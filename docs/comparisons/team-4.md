# Comparisons: the fourth agent-team run

Written on Nov 2, 2026 from the run's stored records, in `runs/team-4`. Code: a pinned checkout of Architect at `e59b4e25` (`team/consult-reads`), unchanged, with no patches. It holds decision 107, the two changes [team-3](team-3.md) pointed to. A teammate can no longer write while the lead asks it something: its write tools fail at once, it says in its answer what should be written, and the lead decides. And `read` now opens a helper's result too long to show, a page at a time, as well as `run` code. The student was hosted Glimmer in both arms. The plan (`team-4/PLAN.md`) was written before any model was called.

## The result

**Still no pass in either arm, over a short run: the team passed 0 of 8 and Inventory desk alone 0 of 8.** The key held only $1.35, so the relay's cap was $1.25. The run stopped after 8 of its 20 pairs, k = 1 and 2 at every lab. The prediction was 1 to 5 team passes, so it was wrong on the attempts that ran. The other 12 pairs didn't run, and the run can't say what they would have done.

| Lab | Request's task (split) | Team | Inventory desk alone |
| --- | --- | --- | --- |
| Fenwick Screening Core | `fenwick-allocate-01` (train) | 0 / 2 | 0 / 2 |
| Alder Row Biosciences | `alder-row-allocate-01` (dev) | 0 / 2 | 0 / 2 |
| Saltmarsh Institute Assay Lab | `saltmarsh-allocate-01` (locked test) | 0 / 2 | 0 / 2 |
| **Corvid Hill Discovery**, the lab neither desk was taught on | `corvid-hill-allocate-01` (locked test) | 0 / 2 | 0 / 2 |
| **All** | | **0 / 8** | **0 / 8** |

Assay desk now reaches the kept plate result: it read it in 15 of the 18 asks whose plate result was cut, against 5 of 47 in team-3. But reaching the plate was not the last obstacle. Every one of those 15 asks still ran out of steps or filled the context before it answered. The new write rule never came into play: no teammate run got as far as a write.

## Against team-3

The rates are per ask that ran, so the two runs compare despite their different lengths.

| | team-3 | team-4 |
| --- | --- | --- |
| Pairs run | 20 | 8 |
| Team replies that asked | 19 of 20 | 7 of 8 |
| Asks that ran / refused at the cap | 69 / 106 | 28 / 42 |
| Asks whose plate result was cut | 47 | 18 |
| Of those, asks that read the kept result (`read` or `run`) | 5 | 15 |
| Asks whose own code found exactly the plate's list (taught labs) | 2 | 1 |
| Asks whose write was refused in a consult | - | 0 |
| Team replies that ended at a teammate's write (`approval_required`) | 1 | 0 |
| Teammate answers that named every compound on the plate's list | 0 | 0 |
| Team passes / solo passes | 0 / 0 | 0 / 0 |
| Median time, team / solo | 398 s / 18 s | 370 s / 7 s |
| Spend, team / solo | $2.38 / $0.16 | $0.98 / $0.03 |

A correction to team-3's report: it counted one ask whose code found exactly the plate's list. There were two, both at Fenwick (`scripts/found-detail.mts`, run on team-3's records). One ended at its write, as reported. The other, team-fenwick-2's fourth ask, filled the context two steps later. At Alder Row, team-alder-row-5's code also found the two compounds and a third, ARX000486, which is already queued (`R-105`) and so drops out. team-2's records hold the same near miss once, at Alder Row. None of these asks answered.

## How the asks ended

| How the ask ended | team-3 | team-4 |
| --- | --- | --- |
| Assay desk ran out of its 30 steps | 33 of 69 | 15 of 28 |
| Assay desk's context filled | 14 | 2 |
| A tool call written as text, settled as no answer | 12 | 6 |
| Answered in words | 9 | 5 |
| Stopped by the reply ending at its write | 1 | 0 |

Asks that ran out of steps or filled the context: 68% in team-3, 61% here. The context filled less often (2 of 28 asks, against 14 of 69), and running out of steps took its place.

## What Assay desk did with the kept result

Across the 18 asks with a cut plate result (`scripts/habits.mts`, counts only):

| What Assay desk did after its plate result was cut | Asks of 18 |
| --- | --- |
| Read or grepped `compounds.csv` or the export | 18 |
| Read the whole result in `run` code | 11 |
| Opened the kept result with `read` (every one succeeded) | 10 |
| Called `assay_plate` again | 10 |
| Ran code that started with `require(...)` | 14 |

So `read` did what it was for: the 10 asks that went for the path with `read` got it, where team-3's 15 were told it wasn't there. But Assay desk still rebuilt the plate from the raw files in every ask, and spent its 30 steps going back and forth.

**The one ask that found the list (Fenwick, team attempt 2, a train task, quoted).** The lead asked:

> It's Wednesday, October 14, 2026. For compound FW-0418, give me the re-test list: each re-test entry with compound_id and how many re-tests are needed (or individual re-test entries).

Assay desk read its policy, `plates.csv` and `retests.csv`, grepped `compounds.csv` for FW-0418, and called `assay_plate`. Its first code on the kept result listed every compound's mean and range. Then it read the policy, `plates.csv` and `retests.csv` again and, because the lead had called the plate a compound, searched `compounds.csv` for a compound named FW-0418 and found none. It paged through the kept result with `read` (lines 1, 201 and 339), read its files again in code, and listed the result's keys. Near its step limit, its code printed:

> total candidates 2 [ { "id": "FWC-13399", "mean": null, ... "reason": "INCONCLUSIVE" }, { "id": "FWC-13444", "mean": 45.31107738998482, ... "reason": "BORDERLINE" } ]

That is the list. One more piece of code counted something, and the run stopped at 30 steps without an answer. The lead got "Assay desk stopped after 30 steps without an answer."

**The lead's asks got worse at naming the plate.** At the taught labs, 13 of the 16 asks called the plate a compound ("For compound FW-0418"), against 8 of 31 in team-3 and 12 of 30 in team-2. Half of them (8) named `retests.csv`. Assay desk spends steps looking for a compound that doesn't exist. Of the 3 answers in words at the taught labs, two gave rows of `retests.csv` and one listed every compound on the plate, not the ones to re-test. At the locked-test labs (not quoted), 2 asks were answered in words, and neither named every compound on the plate's list.

## How the replies ended

| | Team | Alone |
| --- | --- | --- |
| No ANSWER line: out of steps, a question back or the context full | 7 | 1 |
| Wrote a tool call as text and stopped, with no tool run | 0 | 5 |
| Gave an ANSWER line, wrong | 1 | 2 |
| Listed exactly the plate's compounds | 0 | 0 |

## What this says about the team feature

- **The two changes work as built, and neither was the last obstacle.** `read` opened the kept result every time it was asked to, and 15 of 18 asks used the result one way or the other. The write rule can't be judged from this run: no teammate got as far as a write. It does remove the failure team-3 hit, by construction and in tests.
- **Thirty steps is not enough for Assay desk on these asks.** With the plate in reach, it still reads its files again, rebuilds the plate from raw rows and pages through results. The one ask that computed the list did so at about step 28.
- **What the lead asks shapes how long the teammate takes.** The lead calls the plate a compound in most asks, and Assay desk spends steps on that. This is the lead's delegation, which decision 100 says no one has taught yet.
- **Cost.** A team attempt averaged about $0.12 and took a median 6.2 minutes, against $0.004 and 7 seconds alone.

## The student, and how it was reached

Hosted Glimmer, `meta/muse-glimmer-30b` on OpenRouter, pinned to DeepInfra with no fallback, through the same relay as team-3 (with its wait for a 429, which wasn't needed) on 127.0.0.1:8431. The agent host and its network guard saw only 127.0.0.1. The relay's flags show 199 requests carried the new note, and none carried the consult's write refusal.

## A fix made during the run

While the run went on, Codex's release review found that decision 106's markup check took prose quoting XML, such as "The setting `<cfg:parameter name="timeout">5</cfg:parameter>` means a five-second timeout", for a tool call. The check now counts a reply as a written-out call only when nothing is left of it once the call tags are taken out, or when it invokes one of the teammate's own tools (decision 107). That fix landed after the pinned checkout, so this run used the old check. On this run's 6 markup asks, and on team-2's and team-3's 32, the old and new checks agree (`scripts/markup-check.mts`).

## Spend

**$1.01 of the $4 cap, and of the key's $1.35**: team arm $0.98 (779 requests), alone $0.03 (47). Every request was journalled before it was sent and settled at OpenRouter's billed cost (`team-4/SPEND.md`). No mentor, no Spark, no training. No local GPU: Ollama held no model before or after, and nothing ran `architect verify` or llama-server. The key has $0.34 left.

## Limits

- **A short run.** 8 of 20 pairs, two per lab, because the key ran low. With zero passes on both sides and so few attempts, this run measures the asks more than the arms.
- **The write rule is untested live.** No teammate reached a write, so its effect on a reply is shown only by tests.
- **One found list, at one lab.** The one ask whose code found exactly the list was at Fenwick, on a train task.
- **One batch.** Each reply took the host's own random seed, and both harnesses decode at temperature 0.
- **The chat path.** Both arms ran as CLI conversations. Both agents were developed in task mode.
- **Two of four tasks were seen in development.** Fenwick's is a train task and Alder Row's a dev task for Inventory desk.
- **Two changes measured together.** `read` on the kept result and the write rule went in together. Only the first came into play.

## Where the records are

`C:/JakeOS/projects/architect/runs/team-4`: `PLAN.md` (with the run record), `SPEND.md`, `spend.jsonl`, `requests.jsonl` (identical to team-2's), `attempts.jsonl`, `results.jsonl` (one line per attempt; a locked-test lab's has no reason and no quoted text), `asks-taught.jsonl`, `hashes/`, the taught labs' stdout and stderr in `attempts/`, the saved chats in `data/`, the scripts in `scripts/`, `run.sh`, and both packages in `packages/`.
