# Misses, post-hoc (the third run)

Written after the release, offline, with no model call. Nothing here was shown to Spark or used to change any arm, and none of it may be used to rerun or tune this comparison. The stored locked-test records keep pass or fail, the stop reason and latency; the checker's reason is stored only as "Failed." and **no trace is kept**, so what the agent did inside an attempt is not known. The causes below come from three things: the stop reasons, a replay of Academy desk's frozen tools (harness v3) on the Real academy's files (`replay.mts`), and matching the frozen retrieval rules against each task's wording. Where a cause is not confirmed by the records it says so. Scripts: `misses.mts`, `replay.mts`. No student name appears here.

## Real academy: Academy desk 3/30, bare 13/30

| Skill | Bare | Academy desk | Academy desk's failed stops |
| --- | --- | --- | --- |
| Diagnose | 6/10 | 3/10 | 5 answered in 1-2 s, 2 at the 30-step limit |
| History | 7/10 | 0/10 | 10 at the 30-step limit (153 to 677 s each) |
| Assign | 0/10 | 0/10 | 10 answered |

**Diagnose: no skill loads.** Academy desk's `retrieval.yaml` loads the diagnose skill on "what topic", "which error", "right choice" or "listed errors". The Real academy's requests ask "Which topic was that, and what was the right answer?", so none of the 10 matches any rule (checked; every Juniper and taught-academy diagnose request matches). Five of Academy desk's seven misses answered within 2 seconds, which fits answering without looking anything up. Even when loaded, the skill reads `errors.csv`, which the Real academy doesn't have, and asks for an `error` field the Real tasks don't use. Bare has no routing and looked the question up. Confirmed: the routing miss. Not confirmed: what the agent did instead.

**History: the tool is right, the process never ends.** Replayed with the inputs the Real academy's policy gives (first attempts only, latest 6, 3 wrong answers), `history_calc` returns the expected attempts, correct, accuracy and escalation on **all 10** tasks, whatever `window_days` is passed (21 or 3,650). Yet every one of Academy desk's 10 attempts ran to the 30-step limit, and none answered. The likely cause, not confirmed without traces: the history skill tells the agent to read a "window days" value from `policy.md` and the tool requires `window_days`, but the Real academy's policy has no days row (the wrong-answer count is over the history window). The skill also names the taught academies ("Copperfield/Bramble use first-only; Thistlewood uses every answer"). With round 2's rule of one tool call per turn, an agent hunting for a number that isn't there uses up its 30 steps. Bare, with no tool and no such step, passed 7.

**Assign: likely unpassable for any arm.** The Real academy's `assignments.csv` is empty, and its drafted policy says to number new rows "from the highest id already in the file, in the same format", without the taught academies' "A-0001 if the file is empty". The checker requires ids `A-0001` onward. So the format is stated nowhere in the Real academy's files. Academy desk's `practice_find` picked the right number of questions on all 10 (2, 3, then 5 each) and returned no next id. Both arms scored 0/10. This is a defect in the drafted policy and task set, not evidence about either arm.

## Juniper Study House: Academy desk 31/48, bare 15/48

Academy desk's 17 misses: tutoring turn 7 of 8 (all answered, wrong), diagnose 4, history 3, assign 2, hint 1. Bare's 33 misses were mostly the step limit (24 of them: assign 7, tutoring turn 6, hint 3, diagnose 2) and history (8 of 8 answered wrong). Academy desk's gains are in assign (+6), history (+5), hint (+4). The tutoring turn, the hardest skill, stayed near zero for both (bare 0, Academy desk 1).

## What this says about Academy desk's harness

The rounds fixed one failure that was all over the taught academies (malformed batched tool calls, so no answer) and that helped on Juniper, whose wording and files resemble the taught academies'. On the Real academy, the harness's request routing, its required policy fields and its named-academy rules didn't fit. Of the 10 tasks bare passed and Academy desk missed, 7 were history and 3 diagnose.
