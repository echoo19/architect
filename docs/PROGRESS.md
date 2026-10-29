# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

## 2026-10-29 (Wed), what the teacher is told of the records, said exactly

**Done** (on `rule-fixes-4`, from main at `0f86c10`; decision 061 amended; no model was called, the GPU stayed off, and every run used stand-ins only)
- Four findings of GPT-6 Sol's read of the third round, each decided by the owner and each with a test that fails without its fix:
  - A reason a draft was sent back for could say a value of a row the teacher had not read. A list that kept a value no row has quoted the first twelve values of the column (the ids of rows 5 to 11 of a table), a total quoted the cells it could not read, a lookup and a rule quoted a key that rows share, and a rule quoted the one answer every row comes to and its longest answer. Every reason now names the column and gives counts, and says a value only when it is one of the column's examples, which the teacher had read already. The person still reads the whole of it, in the error that ends the draft. `drafting-diagnostics` walks each reason over tables whose later rows each hold values no earlier row has, and finds none of them in anything the teacher is sent.
  - `CaseX` in one row and `casex` in another counted as one value shared by two rows, and the profile named the first's spelling, which is the exact answer of a row the teacher had not read. A value is now said only in a spelling that two rows or more write alike or that a row the teacher was shown writes.
  - Two lookups with the same words over `tickets.csv` and `archive.csv`, with the same ids in both, gave an agent one prompt with two right answers, and last round's table key kept both. The second kind is now sent back with the reason, whether one of its requests reads the same or all of them, and is told to say which table. With ids that differ, or words that name the table, both stay.
  - Decision 061 no longer says that nothing the teacher is sent names a row a set is made from. It says what the teacher is kept from: the check tasks and the final test as tasks (what they ask, their answers, which rows they are about, how tasks are divided, any score), since the records are shared by every set and the practice traces show the teacher rows anyway. A task about one row is never about a shown row. A total or a list is left out when the rows shown decide its answer. The code did that only when every row of the group was shown, so a shown row with a hidden row that adds nothing, or a list whose pending orders were all shown, was kept; both are now left out, and a total or a list with a hidden row that counts is still kept. The decision lists everything the teacher is sent, and says that the person's own words go as written.
- A passage a rule cites but leaves out of its steps is still caught only by the person's reading on Define. It stays in the prompt and is not checked in code, as decided; the decision names it a known limit.
- Verified: `pnpm check` exits 0 (232 test files, 3,013 tests passed, 2 skipped; it was 231 and 2,993). Hidden e2e on the rebuilt app: `rule.spec.ts` (3), `flow.spec.ts` (25) and `drafting.spec.ts` (5) pass. Each fix was switched off in turn, and the tests written for it failed.

**Next**
- Merge the branch into main. The next test of the rule is still the owner's real run on the bike shop.

**Open issues**
- An id or a value the person types in the description, a text file or an answer goes to the teacher as written, and a task may be about it. Someone who wants a record kept out of the tests should not name it there.
- A passage a rule cites and leaves out of its steps is caught only by the person's reading on Define.
- Of two kinds that read alike over two tables, the first keeps its requests, so the second is the one the teacher has to change.

## 2026-10-29 (Wed), what the teacher reads of the records, and a fifth thing seen in use

**Done** (on `rule-fixes-3`, from main at `5cd891b`; decision 061 amended; no model was called, the GPU stayed off, and every run used stand-ins only)
- Four findings of GPT-6 Sol's read of the second round, each with a test that fails without its fix:
  - The teacher could read a row that a set was later made from. A column's examples were sampled across the file (rows 0, 6, 12, 18 and 24 of thirty) while only the first five rows were left out of the sets, so a row whose unique id and amount the teacher had read could be sealed into the final test. A column's examples now come from the first five rows, which no set is made from, plus, for a column with a few values (a status), the values more than one row has, which name no row. One function says which rows the teacher is shown, for what it is told and for what the sets leave out. The decision lists exactly what reaches the teacher.
  - The reason for a refused division carried a proposed final test's counts to the teacher ("27 (82%) of the final-test tasks"). The teacher is now told only that a copy could pass, for which kind of task and what to do about it, with no set, count, share or column; the person gets the detail. No other message to the teacher comes from a proposed or a sealed set.
  - Two lookups that asked the same words of two tables (`tickets.csv`, `archive.csv`) were one question, and the second lost every request. The table is part of the key.
  - Two kinds of rule that ask about one ticket in other words, another order and another family column could still land on both sides of the final-test boundary. A row of a table is now the subject of one request whichever kind of lookup or rule asks it, so there is no twin: the kinds take turns, the one with the fewest rows first, and a kind that came away short says so in the job's notes. Putting every task about a row in one set was not built: two coarse families on one table chain every row they share into a family too large for any set (the decision).
- From a live draft in the app: Spark cited "in half-hour steps" and wrote no rounding step and no question about it. The prompt now says every passage a rule cites must be carried out by the steps or listed in `rule.ambiguities`. There is no check in code, since whether steps carry out a passage is a question of meaning (a check on the numbers in a passage passes "half-hour steps", which has none, and fails "10% off" written as 0.9); the person's reading of each passage beside the rule in words and its examples, on Define, is the check.
- Verified: `pnpm check` exits 0 (231 test files, 2,993 tests passed, 2 skipped; it was 2,979). Hidden e2e on the rebuilt app: `rule.spec.ts` (3), `flow.spec.ts` (25) and `drafting.spec.ts` (5) pass.

**Next**
- Merge the branch into main. The next test of the rule is still the owner's real run on the bike shop.

**Open issues**
- Two requests with the same words over two tables read as one prompt with two answers to an agent unless the words name the table, which is the teacher's to write.
- A row is asked about once among lookups and rules. Lists and totals, which are about many rows, are not held to it, and a question worded differently about a different row is a different question.
- When two kinds ask about one table's rows and the table has too few for both, each keeps what is left; the notes of the job say how many requests a kind lost.

## 2026-10-29 (Wed), the rule read again by GPT-6 Sol, and two things seen in use

**Done** (on `rule-fixes-2-work`, from main at `ce90f59`; decision 061 amended; no model was called, the GPU stayed off)
- Four findings of the second read, each with a test that fails without its fix:
  - A job's making could delete a folder it never made. An id was free when the library and the vault had nothing under it, so a job file whose id matched `jobs/orders` (a person's notes, no job, no seal) was made inside it, and a failed import removed the folder with the notes. An id is now free only with no folder under it, the folder is made without recursing, and only a folder a making created is ever taken back.
  - "Count it as zero" for one table was taken for another table's column of the same name, and the question about the second was never asked. The answer now names its table, a rule takes the answer about its own table, and the other table's question is asked. Drafts made before still read.
  - The copy guard measured all of a rule's cases, so with an 80% target 79 copies in 100 passed, and a final test of 33 could hold 27 of them (82%). The final test and the check tasks are held to the guard as they are divided. A division that fails is made again with the next seed, up to twelve, and when none is safe the draft is refused with the reason.
  - Two rules that add labor and parts in either order, with one request, were two questions and could land on both sides of the final-test boundary. The same words put to the same row are now one question, whatever rule or template is behind them.
- From the owner's look at the `rule-define` capture: an answer such as "No, labor only" read as a fragment. Define, Results (under Details), the report and `scripts/draft.ts` now show the question it answered, found in the answers the draft kept, and none when two answers to different questions hold the same words. It is worked out when the plan is made and never stored, so a draft made before shows its questions too.
- A sentence-case name is asked for in the prompt and in the reply format, with an example. A proper noun keeps its capitals, and the name is not rewritten in code.
- Verified: `pnpm check` exits 0 (231 test files, 2,979 tests passed, 2 skipped; it was 229 and 2,934). Hidden e2e on the rebuilt app: `rule.spec.ts` (3), `flow.spec.ts` (25) and `drafting.spec.ts` (5) pass. Looked at in both themes: `rule-define` and `flow-report-rule`. The captures that came out a few pixels different (a scrollbar) were put back.

**Next**
- Merge the branch into main. The next test of the rule is still the owner's real run on the bike shop.

**Open issues**
- A request worded differently is a different question, so two rules that ask the same thing in other words can still land on both sides of the boundary. Nothing here can tell them apart.
- The copy guard holds each rule to its own tasks in a set, so a rule with few tasks in a set is refused when they are all copies, though a copy would not pass the whole set. It errs on the side of caution, and another seed usually makes the set safe.

## 2026-10-29 (Wed), the rule on main, a drafted pricing job trained for real, and the demo's first scene live

**Done** (Spark and online Glimmer called: about $0.10 of Spark and $0.19 of online Glimmer; the GPU stayed off)
- The rule branch is merged into main (e16ebe8). `pnpm check` exits 0 on main (229 test files, 2,934 passed, 2 skipped) and CI passed.
- The rule, live, from drafting to final test. `scripts/draft.ts` with real Spark on the bike shop's three files: Spark asked how labor is rounded (answered: round up to the next half hour) and what an empty parts cost means (count it as zero). It left open one thing the policy doesn't settle (a markup it mentions but gives no rate for) and drafted "Repair ticket pricing helper". The rule: labor hours rounded up to a multiple of 0.5, times 65, times 0.9 for members, plus parts. The 35 empty parts costs count as 0, as answered, and 27 rows with N/A or a dash are left out. Ten requests about rows the teacher had read were left out too.
- `scripts/run.ts --job repair-ticket-pricing-helper --student openrouter-glimmer --test-on hosted --confirm-rules` trained it in 12 minutes:
  - Before any teaching, Glimmer got 26 of 30 check tasks. All four misses were pricing replies with no ANSWER line.
  - Round 1 was Spark's first draft: a `ticket_total` tool that works the rule. It was kept as the starting point (26 to 26), but it read a formatted parts cost such as "$96.47" as nothing, so four totals came out short by exactly their parts.
  - Round 2: Spark first asked to train the weights, which this run had no compute budget for, and was sent back once. It then found the cause in its tool (`parseFloat` on a formatted cost, with NaN turned into 0) and fixed the parsing: 26 to 30 of 30, and measured again on new seeds, 52 to 60 of 60. Kept.
  - Final test: 40 of 40 (contacts 12 of 12, ticket costs 28 of 28), typical answer 2.3 s, slowest 5% within 3.4 s, $0.085 of Spark over the two rounds and $0.19 of online Glimmer.
- GPT-6 Sol re-reviewed the rule branch read-only. Ten of the fourteen fixes are complete. Two are partial: the copy guard measures every eligible case rather than the final test as picked, and two rules that differ only in the order of their terms can still put one question on both sides of the test. It found two new P1s: a failed import can delete a job folder it didn't make, and a blank-means-zero answer for one table reaches another table's column of the same name. All four went back to the rule's builder, with two clarity fixes: an answer listed under "From your policy" shows the question it answered, and Spark names jobs in sentence case.
- The flaky lease test waits through three one-second stale windows instead of one of 300 ms (ce90f59).
- The demo (d95710c) now opens with Spark drafting this job live in the app: keys come from the environment in a development build, the scene answers Spark's questions and confirms the rule, and it keeps the app's data so that exact job is trained and its run replayed in the next two scenes. Each new scene was recorded as a trial and looked at frame by frame: the drafting (46 s with the waits shown four times faster), the training replay with both rounds' pages, the results, and the two closing cards.

**Next**
- Merge the rule fixes and the teacher's change menu (two branches in progress), then release 0.3.0, which replaces 0.2.0 and its known leak.
- Record the film: the drafting scene on its own, train its job online, then the replay, the returns desk on this computer (a short use of the GPU) and the closing cards.

**Open issues**
- A recording's hidden window sometimes takes a second for a screenshot, so a few frames are held that long. Most come every 31 ms.


## 2026-10-29 (Wed), main merged into the rule branch, three times

**Done** (on the rule branch; nothing pushed; no model was called, the GPU stayed off)
- Main moved a lot while the branch waited, so it was merged in three times: the job files with the final-test choice and the pre-flight, then the four fixes from the review of the app (decision 062), then the demo's scenes. Wherever the two sides met, both were kept:
  - Define keeps main's rows for what a run needs, its choice of where the final test runs, "Up to N rounds" and the dialog for adding a key. The rule review sits between them and the training place. Start training stays off until the plan is read and the rule is confirmed, and the footer says which ("Couldn't check the job", "Confirm the rule first"). The plan is read again whenever a job opens.
  - Results keeps main's verdict for an agent tested online and adds the note on what the score is, with the rule under Details.
  - A job imported from a file reads it the way main does (`readJobFile`, `readTasks`) and, like a job made from a draft, is then made all at once or not at all. Saving a job still keeps its checker (`keepChecker`).
  - README is main's short one with a single line about the rule. Architecture, the expansion checklist and the decisions say both: decision 061 (the rule) and main's 062.
- Define now asks for the job's plan to know whether a rule waits, so a stand-in engine that shows Define has to answer for it. The shared sample replies (`SAMPLE_ENGINE`, used by the populated-screens test and by the demo recorder's second scene) did not, and the sample job's Define said it couldn't check for a rule. They answer with a plan that has no rule.
- Captures made again and looked at in both themes: `describe` and `sample-agent-new` (the quiet line about the files drafting reads), `drafting-examples` and `drafting-tasks` (examples picked to show the variety), `rule-confirmed` and `rule-changed-dark` (they follow main's Define: the estimate for this small job is under a cent, and there is no setting for opening files outside a job that has none). `rule-define`, `flow-define-unreadable`, `define-sample` and the others that came out a few pixels different (a scrollbar, the edge of a letter) were put back.
- Verified: `pnpm check` exits 0 (229 test files, 2,934 tests passed, 2 skipped). Hidden e2e on the app after the second merge: `rule`, `flow`, `drafting`, `retest`, `runs`, `runs-engine`, `sample-agent` and `job-files`, 76 passed; the screenshots spec, 3 passed once the sample plan was answered. The third merge touched only the demo recorder, which `pnpm e2e` does not run.

**Next**
- Merge the branch into main. The next test of the rule is still the owner's real training run on the bike shop with the answer Zero (the entry below).

**Open issues**
- A new channel that Define reads has to be answered in `SAMPLE_ENGINE` too, or the populated-screens test and the demo's second scene show an error where the sample job's Define should be.
- `gpu-lease.test.ts` ("keeps a busy holder that goes on saying it is there") failed once in a full run while the machine was busy, and passed alone and in the next full run. It depends on the timing of other processes.

## 2026-10-29 (Wed), the first real session on the rule, and fourteen fixes from it and two reviews

**Done** (on the same branch; decision 061 amended; no model was called, the GPU stayed off)
- From the real session on the bike shop (Spark, three calls, $0.09, every step of the rule right the first time): Spark asked what a ticket with no parts cost counts as, the person answered Zero, and the rule left all 62 of those tickets out anyway. An empty cell now counts as 0 when the person chooses it, and only then. The question names its column, Architect puts the two answers a rule can do (Count it as zero, Leave those rows out) whatever the teacher wrote, and sets the rule from the answer. N/A and words still leave their row out, "Leave those rows out" keeps the old behavior, and Define says it in the rule in words, in how numbers are read, in how many rows it reaches and in an example.
- From GPT-6 Sol's review of the rule: a rule whose answers need more than 13 digits is refused (a checker that compares numbers would take two answers one step apart for the same); a branch counts as changing an answer only when the final answer changes; a rule is a copy at the job's own pass rate, not only at nine in ten; one list of currency codes (KRW and RUB were refused as not numbers); a file added to a job asks for the confirmation again, by name as well as by hash; every way a run goes on (resume, restart, released hold, stop for the final test) meets the confirmation check, and so do a re-test, a repeat and a reference; the rows the teacher is shown are left out of every set, the final test included; Start training stays off until the plan is read, and says so when it can't be.
- From GPT-6 Astra's review of the drafter on main: two orders of the same list conditions made the same questions with different families, so the same question could be a practice task and a final-test task (23 in a reproduction, five of them review examples). Every request now carries the question it asks; a later kind of task that asks what an earlier one asks is left out or sent back with the reason; a list's family is the varying column that tells the most requests apart. A lookup keeps the day-first or month-first the person said, a count of filled cells no longer needs them to be numbers, a column named as the date column may be written 20260131, and a job is made all at once or not at all, with the engine taking back one the app left half made.
- Verified: `pnpm check` exits 0 (219 test files, 2,782 passed, 2 skipped). Hidden e2e on the rebuilt app: `rule.spec.ts` (3, with the scripted teacher now asking what an empty parts cost counts as), `flow.spec.ts` (15, with a new test of Start training staying off while the plan is read and when it can't be) and `drafting.spec.ts` (5) pass. Each fix has a test that fails without it: the reproduction of the P1 (a list's conditions in two orders, split as a job is, with no question in both a practice set and the final test), the 13-digit answers, the final-answer branches, the pass-rate copy, KRW and RUB, a file added, every way a run goes on (the tests never give the student a chance to be reached), a failing database at the last step of making a job, the empty cell in the conversation and in the examples. Looked at in both themes: `rule-empty`, `flow-define-unreadable` and `rule-define` (the rule in words with the empty cell, how many rows it reaches, and an example whose parts cost is empty); `drafting-examples` and `drafting-tasks` were made again since the tasks differ.

**Next**
- The owner's real training run on the bike shop with the answer Zero: 62 more tickets are tasks, so the final test and the examples change.
- The two other findings of the Astra review that are not the drafter's (a fully online run needing the local model to pin at the end, and three screens that read stale data when left and entered again) are not in this branch.

**Open issues**
- An empty cell the policy itself says counts as zero still has the question asked once: only the person's own answer declares it.
- The first five rows of each table are left out of the tasks even when a very wide table's description is cut before it shows them, which errs on the side of caution.

## 2026-10-29 (Wed): four things a review found in the app, fixed

**Done** (on a branch; decision 062; no model was called, the GPU stayed off)
- GPT-6 Astra read the app on main and found nine defects. Five are in the drafter and the job library and were taken up elsewhere; these four are the app's (items 3, 4, 5 and 8 of its review). Each was confirmed in the code before it was changed, and each has a test that fails without its fix.
- Fully online training still needed the model on this computer. Define left it out of "Before it can start" when practice and the final test both ran online, but freezing always asks the local runtime for the build the agent runs on (`freeze` describes the local student), so a person without Ollama or the model paid for the training and met the pause at the end. An engine test shows it: a run wholly online pauses at freezing with no final-test attempt made, and finishes once the model is there. Chosen: say so before Start. The row now stays for every run, and for one that runs nothing here it reads "The finished agent runs on it, so it has to be here when training ends." Not chosen: letting freezing put off the pin with a note, which files an agent whose model nobody looked at, with a package whose base has no digest for the install checks and nothing for a later test here to hold the model to. The comparisons runner already checks the same thing before it spends.
- "Needs you" could stay a placeholder for good. Leaving the Train screen before Spark asked and coming back showed the question as loading, because the records of the earlier visit were kept and never read again, and training waited for an answer nobody could give. The records are now read again each time the screen opens (`refreshOnMount`), and a waiting round whose question is missing from them has them read once more, once for each round, and says so with Try again if it still isn't there.
- A test on this computer could stay "testing". Leaving Results during one and coming back after it ended or stopped showed the last visit's detail: no verdict, no Try again. A run's detail is read again whenever a screen using it opens. And a read asked for while the same key is being read now waits for one more read that starts after the ask (any number of asks share it; the older answer is dropped, never shown as current), where it used to be answered with the read under way, which may have started before the event that made the ask. This is the cache's rule for every screen, not only these two.
- A paused online final test was diagnosed as if it ran here: its missing key went unnamed and the notice said to start Ollama. `runs.get` carries `lockedTestOn`, the training screen's view keeps it, and one rule (`activeTarget`) says which student works in the phase: where the job trains while the run practices, where it takes its final test once it is testing. The notice looks at that endpoint. The same rule replaces the Train screen's own function for where the student runs, which assumed the final test ran here.
- Tests: unit `needs` (a run wholly online still needs the model; Ollama first; nothing once it is there), `pause` (the online key for an online final test and not Ollama, either way practice went; the reverse for a final test here; earlier phases ignore it), `run-state` (`lockedTestOn`, `activeTarget`), `questions` (a missing question, the waiting view, the error after a second read), `query` (15: a read asked for during a read, shared asks, a dropped answer, a failure of the newest or of the older read, and what a component does when it comes on screen), engine `test-targets` and `host`. Hidden e2e: `flow.spec.ts` (a run wholly online is held for the model and starts once it is downloaded), `runs.spec.ts` (an online final test's notice and a final test here's; the question Spark asked while the person was on another screen; the records read at each opening; a missing question read once more, then said, then found on Try again), `retest.spec.ts` (a test that ended, and one that stopped, while the person was elsewhere). Each rule was checked by taking its code out: the needs row, the pause diagnosis, the detail's refresh, the records' refresh, the question's own read and the cache's rule each made a test fail, and with the records' refresh and the question's read both out the e2e waits on the placeholder for good, as the review said.
- Verified: `pnpm check` exits 0 (219 test files, 2,775 tests passed, 2 skipped). The hidden e2e specs for these screens passed: `flow.spec.ts` (21), `runs.spec.ts` (19) and `retest.spec.ts` (11), and `drafting`, `evidence`, `runs-engine`, `shell` and `teaching` (34), which read the same records and details. Nothing a person sees changed except the one new row on Define, so no capture was made again; the ones the runs rewrote came out a few pixels different and were put back. The new row was looked at in the dark theme.

**Next**
- One real run of a fully online job, to see Define hold Start for the model, and the paused notice for an online final test with its key removed, on a real engine and a real host. Neither has run against a real service.
- The pre-flight asks for the model only as far as it can see it. If a job's local runtime is not Ollama at the address Define looked at, a fully online run still finds out at freezing; an engine check at the start of a run, like the comparisons runner's, would close that.

**Open issues**
- A run paused at freezing because Ollama went away during an online run is explained by the engine's sentence under "Press Resume to try again", not by a line of its own.
- Opening Train or Results reads the run's records or detail again, and the last visit's copy shows for the moment that takes: a test that has ended can read "Testing" for an instant.
- The paused notice doesn't look at a kept adapter, which is served on this computer even when the job practices online.
- `peekQuery` exists for the cache's tests.

## 2026-10-29 (Wed), a recorder for the demo

**Done**
- A developer tool in `apps/desktop/demo`, written by GPT-6 Sol through Codex and checked here: a scene script (routes, clicks, typing at a human pace, waits, scrolls, the native file dialog, window size), frames captured from the hidden window with their real timestamps, a drawn pointer and click ripple, title cards in Architect's look, a speed-up mark for long waits, and ffmpeg assembly into a 1440x900, 30 fps H.264 video with cross-fades. It has its own Playwright config, so `pnpm e2e` never runs it, and it never writes a key.
- Its sample, on the stand-in engine, recorded a 10.6 s video in 16 s; frames from it show the cards, the pointer and the screens cleanly. Codex's sandbox couldn't launch Electron or commit from a worktree, so the run and the commit were done outside it.

## 2026-10-29 (Wed), a rule a person can confirm, and the first things a reviewer meets

**Done** (on a branch; decision 061; no model was called, the GPU stayed off)
- The four things a reviewer meets first, each fixed and tested:
  - A list keeps rows by a set the teacher states ("status is one of Open, Waiting on parts, Ready"), never by what a row is not. A reply with "is not" is sent back with the reason, and the notes say what else the column holds. Older drafts still read.
  - A text file goes to the teacher whole, up to 30,000 characters (60,000 in all), not cut at 4,000. A longer one ends the conversation before the teacher is asked and says to attach the section that matters.
  - The Describe screen says, before anything is attached, that drafting reads CSV, text and Markdown files with at least 30 rows of records in all.
  - The examples of a type show its variety: an empty or zero answer when there is one, then small, middle and large answers, each of a different size, not the first three requests.
- A fourth template, a rule: one numeric answer per row, worked out from a policy.
  - The teacher configures a small typed expression: exact decimals, columns of the row or of one looked-up row, plus, minus, times, division by a number, smallest, largest, rounding to a stated step (up, down or half up), and if over a category or a threshold. Architect checks it against limits (32 parts, 6 nested, 2 ifs), evaluates it with exact fractions, and writes the rule in words and the working of every example itself.
  - It is written as a list of steps that name each other by id, not a tree inside a tree, which a provider that limits a schema's depth would refuse. A step that is wrong is named by its id.
  - A blank, N/A or unreadable input leaves its row out, counted with its reason, never read as zero. Currency is declared, and a column that mixes currencies refuses the rule. A rule is refused when its answers are one constant, the key, or a copy of a column, or when a side of an if never changes an answer.
  - What the policy leaves open and would change a number is asked of the person, up to three questions, and "Draft it now" doesn't skip it.
  - The holdout stays: the rule is written from the policy and the person's answers, never from the rows, and the examples come only from practice and starting tasks.
- Define shows the rule before anything trains: the passages of the policy it rests on, the rule in words, examples that take every side of every condition and a rounding edge (made-up numbers, said so, when no record needs rounding), the rows left out, and how numbers are read. Start training waits for Confirm the rule, and "Describe the job again" is beside it for a rule that isn't right.
- The confirmation binds. It holds the rule's version and the hash of every data file. A changed file or rule makes the state changed and sends the person to describe the job again (a new job, new tasks); the controller refuses every kind of run on a rule that isn't confirmed, not only the button.
- The score says what it is, beside it on Results and right after the score in the report: the expected answers follow a rule Architect calculated from Spark's reading of the policy and the person confirmed, and the score does not establish that the rule matches the business. Under Details: the rule in words and exactly as evaluated, passages, confirmation date, how numbers are read, rows left out, what each side of an if did, and whether teaching ran.
- `scripts/draft.ts` prints the rule with its passages and examples, and `--confirm-rules` on it and on `scripts/run.ts` is the person's say-so for a headless run.
- The owner's bike shop files through the template, with a hand-written rule and no model: 118 of the 180 tickets can be worked out, and the 62 with no parts cost are left out and counted. No real record needs rounding (the hours are already half hours and the amounts already cents), so both roundings are shown with made-up numbers.

**Next**
- The owner's real session on the bike shop: `scripts/draft.ts "<description>" customers.csv tickets.csv policy.md`, read the rule it prints (labor $65 an hour in half-hour steps, members 10% off labor and never parts), then `--confirm-rules` and `scripts/run.ts --job <id> --confirm-rules`. Watch how often the steps come back wrong and how many fixes that takes, whether Spark asks if the discount also applies to parts, what the conversation costs against its $1 cap, and whether Glimmer needs any teaching on the rule. Calibration decides that, and nothing here promises it.
- Merge, then look at a drafted rule in the app once with a real Spark reply.

**Open issues**
- The prompt and the reply format have been tried only on a scripted teacher.
- A blank that means zero can't be declared: those rows are left out and counted.
- A record that changes after confirming needs a new job, and the old one stays in the library.
- The statement of a deep rule is mechanical and its parentheses nest.
- The made-up rounding examples go through the same evaluator as everything else, so they show what the rule does, not that the evaluator is right. That rests on the unit tests with hand-worked values.
- Only the dark theme has a capture of the changed state (`rule-changed`).

**Verified**
- `pnpm check` exits 0 (217 test files, 2,729 passed, 2 skipped). The new unit tests: `rule-expression` (20), `rule-template` (20), `rule-examples` (5), `drafting-rule-reply` (11) and `drafting-rules` (20), `drafting-plan` (5), plus more in `drafting-templates`, `drafting-envelope`, `drafting-conversation`, the harness report and the desktop's words for the screens. Taking out the controller's confirmation check, the file-hash check, the dead-branch guard and half-up rounding each made a test fail; each was put back.
- Hidden e2e on the rebuilt app: `rule.spec.ts` (3, the real engine with a scripted teacher: the question, the rule and its examples, training waiting, confirming, starting in both themes; a changed record and a second drafting asking for confirmation again), `flow.spec.ts` (13) and `drafting.spec.ts` (5) all pass, 21 in 5 minutes. The captures `rule-question`, `rule-define`, `rule-confirmed`, `rule-changed` and `flow-report-rule`, and the changed `describe` and `drafting-examples`, were looked at in both themes.

## 2026-10-29 (Wed): new jobs take your choices, and a run says what it needs

**Done** (on a branch with the drafter and the runs branch merged in; decision 059; no model was called, the GPU stayed off)
- The gap, found in the code before changing it: the teacher and model picked in setup or Settings only wrote `defaultMentor` and `defaultStudent`, and nothing put them on a job, so the sample job asked for Spark and the 4-bit model whatever setup had steered the person to, had no hosted copy, and "Train online" said "Choose a host". A run could start with no teacher key and no model and fail long after. The engine could take the final test online and test an agent here later, and no screen offered either. `jobs.importFile` had no caller. Three Define settings did nothing, and the Privacy tab was wrong about Teach this.
- New jobs: one function in the main process, `applyChoices`, puts the person's teacher, their model on this computer (build, runtime, address), a hosted copy of Glimmer when a host that serves it has a saved key (OpenRouter first), and training online when there is a copy, on every new job. Main's handlers call it for the sample job (when it is new), an imported job file and a drafted job in either reply; a job that exists keeps what it has. The drafter is merged in: the engine makes its job from the shipped models, and the handler saves it again with the person's choices. A job file's own hosted copy is dropped, and a model that isn't Glimmer gets none.
- Define says what a run needs before Start training: the teacher's key, the model on this computer (with its download), and the online copy and its key, each with the one action that fixes it, a footer that names the first thing missing, and a live ask of the online copy when a run is about to start, so a copy that doesn't answer stops the run there.
- Where the final test runs: Advanced settings, Ready when, "On this computer" (default) or "On the online copy", each with its time and cost. Start sends `lockedTestOn` (also to the comparison's baselines) and `interactive: true`; the plan's time and bills follow the choice.
- An agent tested online is badged "Passed online" and "finished training", never "Ready" or "graduated" (a drafted job's 28 of 30 included); the offer "Test on this computer" sits right under the badge, with how long it takes and that it uses the graphics card, how far it has got, and the result. The agent's own Results tab has it too. `runs.get` lists a run's re-tests so a page opened mid-test knows.
- Job files: "Import a job file" on the new-agent screen (a file that isn't a job fails with `not_a_job` and says what a job folder holds; a bad line of tasks.jsonl is named by its number) and "Export the job file" in Advanced settings through a save dialog (`files.save`). The file holds the settings only.
- Settings that did nothing: a checker file chosen by its full path is copied into the job's folder (content-named, so an old run still finds its own), the task sets are read-only once split with one line why, "Opening files outside the job" is gone from Define and from the agent's settings. The Privacy tab says the teacher never sees a chat, except the one exchange Teach this sends after the person confirms.
- Tests: unit, `job-choices`, `engine-handlers` (the sample job, an imported file, a drafted job in either reply, an existing job left alone, a checker path the person didn't pick), `needs`, `hosted`, `final-test`, `estimates`, `verdict`, `retest`, `job-file`, `job-editor`, `validate`, the engine's `job-files` and `host`. Hidden e2e: `flow.spec.ts` (the pre-flight and each action, the online ask, the final-test choice both ways), `retest.spec.ts` (9: from Results and from the agent's settings, each phase, the result, a 28 of 30 final test, and the offer placed before the figures), `job-files.spec.ts` (5, on the real engine: an import, a file that isn't a job, an export that imports again, a checker copied in, task sets read-only), `drafting.spec.ts` (the drafted job arrives with the person's teacher and model, then trains on them), `shell.spec.ts`. Each new rule was checked by taking its code out and watching a test fail: 41 of 41 caught, the drafted-job call, the verdict for an agent tested online and where its offer sits included.
- The runs branch (decision 060) merged with no conflict, since it left the Define screen alone. Define's comparison baselines now come from `isBaselineMethod` instead of a list of their own, which that branch's entry asked for.
- Verified: `pnpm check` exits 0 (218 test files, 2,738 tests passed, 2 skipped). The whole hidden e2e run passed (175 passed, 2 skipped, none failed; the skips are the packaged-app spec and a refusal that only applies to a build without the ready-made agent), and `flow.spec.ts` (20) and `retest.spec.ts` (9, one of them a 28 of 30 final test, as a real drafted job had) passed again after the last changes. The captures `flow-define-needs`, `flow-advanced-final-test`, `flow-advanced`, `report-online*`, `workspace-agent-report-online`, `define-sample`, `workspace-agent-permissions` and the new-agent screens were looked at in both themes.

**Next**
- One real run with a connected host: the live ask of the online copy, a final test online, "Test on this computer" on the graphics card, and a question from Spark, asked because Define now sends `interactive: true`, reaching the Train screen's answer box. None of these has run against a real service.
- Read Define, Train and Results once more together on a real drafted job tested online.
- Take drafted jobs nobody went on with out of the library (still open from decision 058).

**Open issues**
- "Faster training" is any host with a saved key, since that is all setup's last step records. A key saved only for the teacher counts too.
- The online final test is chosen on each visit to Define; it isn't saved with the job.
- An agent tested online and then here shows "Ready" on Results while its version's own record still says tested online (versions are immutable).
- The pre-flight can tell only about Ollama at the address it looked at, and reads the model when the screen opens or the person asks again, not at the moment Start is pressed.
- An exported job file holds the job's settings, not its tasks or data; to give a job away, hand over its folder.
- `permissions.unseenFiles` stays in the job and its package contract, where the package format carries it, though no screen shows it.
- A drafted job is saved twice, once as the engine makes it and once with the person's choices; nothing runs between.


## 2026-10-29 (Wed), the first real drafted job, end to end

**Done**
- A fresh dataset nobody had seen (a made-up bike repair shop: 40 customers, 180 tickets with messy hours and costs, a short policy) went through the whole journey with real models, using the new `scripts/draft.ts` and `scripts/run.ts --job`:
  - Spark drafted it in one call ($0.02) from one sentence and three files, with no unresolved rules: contact lookups, a customer's open tickets (the policy's "Open, Waiting on parts or Ready", which Spark turned into "status is not Picked up"), and a mechanic's labor hours over a date range.
  - Architect made 90 tasks (8 calibration, 29 practice, 23 check, 30 final test). Six expected answers recomputed by hand from the raw files all matched, including totals over values like " 0.5 " and "$1,204.00".
  - Trained with Glimmer served online: it passed 22 of 23 check tasks before any teaching, above the 90% target, so no round ran, and passed 28 of 30 on the final test (contacts 14/14, open tickets 11/12, labor hours 3/4), typical answer 9.3 s, $0.18 of online Glimmer.
- The Train screen now says when no teaching was needed, instead of waiting for a first round that never comes.
- Merged: getting back to a run (decision 060).

**What it shows**
- The drafted task types are retrieval and arithmetic over the records, which Glimmer already handles well. Teaching earns its keep where a job has rules to learn, as the returns desk's policy showed in comparison 2; the catalog doesn't make such tasks yet.

## 2026-10-29 (Wed), getting back to a run

**Done** (on a branch; decision 060; no model was called, the GPU stayed off)
- An audit of the real app found seven places a run was lost or a person left guessing. Each was confirmed in the code before it was changed.
- Finished runs stay reachable. The sidebar has a row for each job's newest run of its agent: Training, Paused, Needs you (waiting for an answer), Results ready (finished, agent not accepted yet; opens the Results page), and Stopped and Error (open the run). A finished run whose agent is accepted has no row, since the agent is in the list.
- A job's row opens its agent's own run, never a baseline a comparison started after it: a job's summary is its newest run that isn't a baseline, with whether its version is accepted.
- A new agent is in the list at once. One hook the App mounts reads the agents and jobs when the engine says a graduate is ready or a run changes status, so it works on the training and results screens too, which have no sidebar. Before, nothing read the list again until a restart.
- A paused run says why whenever it is opened: a notice looks at the computer now (the teacher's key, the online student's key, Ollama running, the model downloaded) and offers Add the key, Check again or Download, with the engine's sentence under Details or leading when nothing explains the pause. The live line it replaces is gone.
- Spark's question has its place on the training screen, in the current round's panel: the question, a box for the answer, and the choice that the answer changes what counts as success (which says the run will stop before it is sent). It goes through `mentoring.answer`. The round then says what became of it, the rounds list reads Needs you and Answered, and the round's page names the question. The engine now sets the run's phase to `clarifying` while it waits and announces the answered question, so the sidebar and the screen both know.
- Quiet mode reaches agents already open: a student reads the thread cap and the rest at every request. The workspace host follows the cap it last received (the app no longer sends it as an agent opens), and a run's student follows both. A hidden e2e switches quiet mode in Settings between an open agent's replies and sees the cap on each request.
- Not done, and why: the runtime meter isn't wired into the app (never run against a real runtime, unloads the person's model and holds the GPU to time a first reply, and its GPU figure is the whole card's), and rests still don't apply to chats (decision 060 says what each would take).
- A run that ended with a question still open offers no box for an answer it could no longer take: its round says what was asked and that training ended before it was answered.
- Verified: `pnpm check` exits 0 (201 test files, 2,516 passed, 2 skipped), and the whole hidden `pnpm e2e` passes (140 passed and 2 skipped in 27 minutes; the skipped ones are the packaging spec and the real engine's test of a shipped package, which waits for the owner's file). The new specs are `runs.spec.ts` (a stand-in engine), `runs-engine.spec.ts` (the real engine) and the quiet mode test in `agent-host.spec.ts`; the two tests of an agent appearing fail with the hook taken out. The captures of other screens that the full run made again came out a few pixels different (the recorded run's wall time, anti-aliasing), so the committed ones stay. Every new capture was looked at in both themes: `runs-sidebar`, `train-paused`, `train-question`, `train-answered` and `train-question-round`.

**Next**
- Decide whether a stopped or failed row should be dismissible, and whether a run that ends while the app is behind other windows should tell the person (a toast or the system's own).
- If rests should reach chats, put them in front of the next turn rather than after the last, and say so in Settings.
- The meter, when there is a go-ahead and a supervised run on a real card: per-process GPU memory, the job's endpoint, and the unload asked for.

**Open issues**
- A run paused on a question before this change reads Paused in the sidebar (its phase wasn't `clarifying`), though its training screen shows the question.
- The paused notice says what the computer lacks now; a key that is saved but refused is only in the engine's sentence under Details.
- `DefineScreen` keeps its own list of the three baseline methods instead of using `isBaselineMethod`. It was left alone so this branch doesn't touch the file the branch that makes Define start interactive runs changes.

## 2026-10-29 (Wed): a job of your own can be described, drafted and trained

**Done** (on a branch; decision 058; no model was called, the GPU stayed off)
- The gap, found in the code: in the app, describing a job ended in "Drafting a job with the mentor isn't available in this build". Nothing implemented `JobDrafter`, the desktop never passed one, and the hidden flow spec passed only because it stubbed the engine's turns. So only the sample job, an imported job and the ready-made agent could be trained. The design was reviewed with GPT-6 Astra before it was built: the teacher understands the job and configures it, Architect works out every expected answer, and the teacher never writes code that decides a right answer.
- The conversation (`packages/engine/src/drafting`): the attached files are read in full when the description is sent. A CSV gives its row count, each column (what kind of values, how many different, how many empty, examples) and its first rows; text and Markdown give their start; a tasks file gives only its count and its types. Anything else, a spreadsheet or a PDF, is refused with a sentence that says what to attach. The teacher answers in one JSON object, a question with two to four options or a draft, and asks at most three questions. Every question also offers "Draft it now", and an early draft says what it left open and never invents a rule. A reply that can't be used goes back once with its reasons. The teacher is the one the person chose in Settings (the main process passes it on every call), the calls go through the mentor gate with a $1 cap for the whole conversation, and what they cost is kept with the job.
- Three templates Architect owns: lookup (expected as facts), filtered list (an answer compared as a set) and group total (an answer compared as a number, with a tolerance of half the last decimal place for a sum). Values are read the same way every time (currency signs and codes, thousands separators, decimal commas, brackets, dates in either order, `N/A` and the like as empty), cases are chosen with a seeded generator, a family is its key, and a configuration that names a column the table lacks, a placeholder that isn't there, or gives every request the same answer is refused with the reasons.
- Coverage, not a quota: up to 120 tasks, split by the sample jobs' rules. 30 is the least that can train (10 in the final test, 8 check tasks, 9 practice and 3 for calibration): with fewer, the check tasks can't tell the two-task gain the keep rule asks for from luck, and a final test under 8 can't tell a 90% agent from a 70% one. With fewer, or no table at all, the conversation ends without calling the teacher and says how many tasks the files support and what to attach.
- A tasks file skips all of it, and its contents never reach the teacher.
- The engine builds the job: the files copied byte for byte, the tasks validated and split, the final test sealed in the vault, and the job recorded with a `drafting.json`, so `jobs.save` and Start training work as for an imported job. Its models are the shipped defaults; putting the person's own on every new job is the main process's, in another branch.
- The screens. Define's Example tasks tab shows where the tasks came from, how many sit in each set, what the teacher left open and, for each type, the rule Architect understood with three examples and their answers (from the practice and calibration tasks only, never the check tasks or the final test). Describe takes only CSV, text, Markdown and task files, hides the reply box once a job is drafted, shows what the draft left open, and puts the description back to edit when the files can't make a job or the conversation is gone. Results' Details and `report.md` say what drafting cost and that the final test's answers are checked against a job the teacher drafted, not certified as right for the business.
- Tests, engine: `drafting-values` (17: how money, dates and empty markers are read), `drafting-templates` (20: each template on messy tables, and every refused configuration), `drafting-generate` (15: coverage, the caps on repeats, the split sizes and the least that can train), `drafting-conversation` (30: the questions, "Draft it now", the three-question limit, one fix for a reply that can't be used, the cap on cost, the job built from a draft with its files copied and its final test sealed, review examples never from the final test, a tasks file never reaching the teacher, files too few to make a job), `drafting-envelope` (10) and `drafting-host` (3, through the engine's API), and more in `host`, `report` and the harness's report tests. Desktop: the Example tasks text, the results' note, and the conversation's drafted and ended states.
- Tests, hidden e2e: `drafting.spec.ts` runs the real engine with a scripted teacher on a messy shop's records: describe, answer a question, review the draft on Define with its example tasks (each example's answer worked out again from the records), train, and the final test in the vault never in a request the teacher got or a task the run used; "Draft it now" with a rule left open; files too few to make a job. `flow.spec.ts` covers the screens around it: a draft with a note, an ended conversation, a lost one, and the results' details.
- Verified: `pnpm check` exits 0 (203 test files, 2,576 passed, 2 skipped); `drafting.spec.ts` (5 passed), `flow.spec.ts` (11 passed) and `evidence.spec.ts` (7 passed, the results page the report change touches) pass hidden on the rebuilt app. The captures `drafting-*`, `flow-advanced-tasks`, `flow-clarify` (changed: no reply box after a draft), `flow-clarify-open`, `flow-clarify-ended` and `flow-report-drafted` were looked at in both themes.

**Next**
- One real drafting session with Spark after merging: how often a reply needs its one fix, which templates it picks on a real shop's files, and what a conversation costs against the $1 cap.
- Merge the branch that puts the person's own models on every new job, then check that a drafted job takes them.
- Take drafted jobs nobody went on with out of the library.

**Open issues**
- The teacher's reply format has been tried only on a scripted teacher.
- A conversation left after its draft leaves an unused job, with its data and its sealed final test, in the library.
- Spreadsheets, percentages or mixed units in a column, and delimiters other than a comma are not read; a table over 200,000 rows is refused.
- The sample job still takes its models from its job file, not from Settings (the other branch's change).
- When the files hold too little to make a job, "Architect" answers, not the teacher: the teacher was not asked.

## 2026-10-28 (Tue), late night: published, and an audit of what doesn't work end to end

**Done**
- With the owner's go-ahead: release v0.1.0 (the Windows installer and the macOS disk images for Apple silicon and Intel, built by the release workflow from the tag, with plain notes), and the ready-made agent published privately to Hugging Face (`jke-kang/architect-returns-desk`) and installed again by its commit into a fresh data folder (A12 done).
- An audit of the real app, tracing every call a screen makes to the engine, found that describing your own job was never built: `JobDrafter` has no implementation, so the Describe screen ends in an error, and the e2e passed only on stubs. It also found that setup's choice of teacher and model never reaches a job, so the sample job asks for the 4-bit model and has no hosted copy; that finished runs can't be reached again; that a paused run doesn't say why; that the engine can test on the hosted copy and test again later, but no screen offers it; and three Define settings that do nothing.
- GPT-6 Astra reviewed the drafting design: Spark configures templates from a catalog Architect owns (a lookup, a filtered list, a group total) and Architect computes every expected answer; review examples never come from the final test; an attached tasks file never reaches Spark; the report says the tasks came from a Spark-drafted specification.

**Next**
- Three branches: the drafter (decision 058), new jobs and Define (059), and runs you can always get back to (060). Then one real drafting session with Spark on a fresh dataset, through training.
- The website, rebuilt on comparison 2's real run, published on GitHub Pages after the next release.

## 2026-10-28 (Tue), night: comparison 2 shows a gain, and the agent it made ships

**Done**
- Comparison 1 read with GPT-6 Astra: two rounds of teaching showed no gain on the final test (+3.3 points, -11.5 to +18.0). Astra advised one more comparison, planned and published before it ran, then delivery.
- Comparison 2, planned in `docs/comparisons/returns-desk-2-plan.md` before anything was generated or measured: a new returns desk from generator seed 20261029 (the split now follows the generator's seed, and the committed job is byte for byte the same), Glimmer on its own against teaching with the job's own budget (the runner took `--rounds`), the one-shot draft as a secondary checkpoint, and a gain counted only if the paired 95% interval is above zero.
- Its first run was set aside: when attempts cost more than calibration said, the runner dropped the teaching arm, as it is built to, and opened the other two arms' final tests. It was stopped 84 seconds later, unread, and ran again with a wider total cap (each arm's own share still bounds what it spends). Both amendments are in the plan.
- Results (hosted bf16 Glimmer, 60 final-test requests, seed 101): on its own 44, one-shot draft 38, taught 58. Teaching against Glimmer on its own: 15 won, 1 lost, +23.3 points (+10.9 to +35.9), a gain by the plan's rule; against the draft, 20 won and 0 lost. Teaching met the 95% target on the check tasks after 4 rounds (two kept, both tool changes that read messy money and quoted values), so it stopped there. Typical answer 3.5 s against 17.7 s. Spent: Spark $0.42, hosted Glimmer $3.38.
- The taught agent ships as the ready-made agent: `examples/gear-returns/graduate/returns-desk.architect.zip`, with its shop's records in `graduate/data` (a test holds them to seed 20261029 byte for byte). It is marked experimental, since the 2-bit build it runs on locally hasn't taken the final test (decision 009).
- Both reports are published in `docs/comparisons`, with an index; the README's Results section now reports both comparisons and the earlier service desk result, in plain words. Its images are now captures of comparison 2's real run, opened in the app from its own records (`docs/comparisons/screens`), not fixtures.
- A one-request check of a comparison 1 agent on this computer's 2-bit Glimmer failed after 13 steps: seven file reads filled the 16K context, and Ollama cut the reply off inside a tool call. Online runs have far more room, so nothing had shown it. A context budget keeps every prompt inside the student's context (decision 057, merged).
- EXPANSION rows A01 (not done, by the owner's choice of hosted inference only) and A12 (a Hugging Face token now exists; a live private test waits for the owner) say where they stand.

- The shipped agent, installed through the CLI into a fresh data folder on this computer: every installation check passed (it answered in 8.2 s with loading), and one order question on the 2-bit Glimmer with the context budget merged came back right, every order and line, in 96.9 s and 12 steps. The model was unloaded afterwards. Two small fixes came out of it: the model check no longer calls the local build "the build that was tested" for an agent whose final test ran online, and installing into a data folder that doesn't exist yet now starts it.

**Next**
- Merge the website, rebuild the installer for the owner to try, and update the demo script for the returns desk.

**Open issues**
- The owner's go-ahead is needed for a live private Hugging Face test, a GitHub release and where the website goes.

## 2026-10-28 (Tue), the student's prompt kept inside its context

**Done** (on a branch; decision 057; no model was called, the GPU stayed off)
- The cause of the failed local run, found in the code: nothing kept a conversation inside the model's context, and a turn that had shown text was never asked again (053 asked again only before any text was shown, and the agent host always streams text). Hosted runs have a 131K context and never met either.
- A budget for every turn, on every backend: students say the context they run under (`StudentAdapter.contextLength`: Ollama, llama.cpp, OpenAI-compatible hosted or local; the mentor's model as the agent says `null`). A prompt may take the context less the reply's room, which is the harness's output limit but at most a quarter: 12,288 of 16,384 by default.
- An estimate from the usage the adapter reported for the turn before (prompt and output) plus what came after, counted by characters the way Glimmer's tokenizer spends them (a digit costs a token, so a table runs near 1.7 characters a token and prose near 3.8). The constants were fitted to 143 samples of the two sample jobs' files counted with Glimmer's own vocabulary (`llama-tokenize` on the 2-bit blob, vocabulary only, GPU hidden): none came out under; of the 127 over 100 characters the typical one is 34% high and the highest 68%, where the lowest flat ratio that never undercounts is 112% high at the 90th percentile. In a closed loop on the returns desk's files with real counts (twelve reads, 16,384 context), the prompt without a budget went from 1,384 tokens at turn 1 to 40,419 at turn 13; with it, eight results were cleared oldest first and no prompt passed 10,728 of 12,288. The estimate was 1.48 times the real count at turn 1 and 1.04 to 1.30 after, never below.
- Clearing: the oldest tool results become `[Cleared to make room: read data/orders.csv, lines 1-119. Read it again if you need it.]` until the prompt fits; the system prompt, the person's messages, the model's own messages, the latest results and a result no longer than its note are never touched. The trace keeps every message whole and records each clearing (`Trace.cleared`); the mentor's compact trace marks the results the student no longer had. If the request, the instructions and the latest results don't fit, the attempt ends before the model is called with "This task needs more room than the model's context allows." and the figures.
- A reply cut off at its length limit is named as one and asked again with the prompt sized again (the cut-off call shows how big it really was) and the whole output limit kept free; an OpenAI-compatible reply cut inside a call comes back as a cut-off, not as bad JSON. The replies thrown away are paid for in the turn that follows.
- A turn asked again after text was shown: `runAgent` takes `onRetract(chars)` beside `onText`. The agent host's reply goes back to how its text stood, published at once, so the app's chat shows only the retried turn's text; the CLI conversation prints `(asked again)` on its own line and then the new text; a JSON result's answer holds only the final text. 053's limits stand.
- Tests: `token-estimate` (16 fixtures with their real Glimmer counts: never under), `context-window` (budget, clearing order, protected messages, stubs for each tool, usage-based sizing and the scaling after a clearing, the cut-off, can't fit), `agent-context` (the loop on a 600-row table in an 8,192 context with an independent token rule: every prompt inside the room, the trace whole, the turn of each clearing, the cut-off retry's room), `agent` (taking text back, a cut-off named and paid for), `agent-host` (text taken back in the reply, and a prompt that Ollama's reported usage says is near the end cleared), the CLI conversation and JSON answer, the OpenAI-compatible stream, and the schema. Each new test was checked by taking its code out (11 changes, all caught). Hidden e2e `agent-host.spec.ts`: a turn whose call can't be read shows its words and then takes them back, and the chat never holds both; with the host's retract taken out it fails.
- Verified: `pnpm check` exits 0 (193 test files, 2,397 passed, 2 skipped), and the hidden e2e specs that use the model stand-ins pass: `agent-host.spec.ts` (5 passed), `engine.spec.ts` and `hub.spec.ts`.

**Next**
- Try it on the real local model after merging. A 16K context holds about two full reads of a table beside the instructions and the tool list, so the agent will read again what it cleared; watch the turn times (changing an old message makes the runtime read the prompt again from there) and whether it loops on re-reads. A tool-heavy job is better with 32K (about 0.2 GiB more here) or a smaller tool result.
- Decide whether the Spark reference and corrections should run under the student's limit too; they are unbudgeted now.

**Open issues**
- Ollama reports a call cut off by the end of the context as one it could not parse, with no usage, so that case is asked again as in 053 and can't be named; with the budget it should not come from a full context.
- Ollama's `prompt_eval_count` is taken as the whole prompt. That is unverified live on 0.40.9; a report under 40% of the character count isn't believed.
- A long chat's earlier messages (up to a quarter of the context) are never cleared, so a long chat with a long harness can end with "needs more room".
- The estimate errs high by the reasoning of the turn before, which the template does not send back.
- The CLI prints a step's line before the text that arrived with it (as before), so a short text can be split by a step line.

## 2026-10-28 (Tue), night: comparison 1's report says what it measured

**Done** (on a branch; decision 056; no model was called, the GPU stayed off, and nothing of comparison 2 was read, run or changed)
- A reviewer read comparison 1's report as an outsider and found eight faults. Each is fixed in the code that writes the report (`packages/engine/src/comparisons/report.ts` and `markdown.ts`), never in its output. The report's format is now `architect.comparisons/3`.
  - Seeds: it says which declared seeds ran and for whom, and that a declared seed with no result (102 here) was not run. The seeds and the adapter protocol come from the confirmed plan, not from the flags of the command that asks for the report.
  - Settings: a row of temperature, top_p, top_k, reasoning, turn limit and output tokens for every row of results, and the sentence that the harness sets them.
  - Where it was measured: each frozen agent is "set to run on `muse-glimmer:30b-iq2` on Ollama once installed". All its numbers are from the hosted student, and the local build was not measured, unless a local table has the arm.
  - Money: the attempts' recorded costs ($3.7630), what the provider settled ($3.8075) and the uncertain requests at their worst ($0.1359) are named for what they are and shown to a tenth of a cent, so they add up ($3.9434 in the journal, $0.1804 more than the attempts record). The projection is a section of its own.
  - Development: the first dev measurement and the last kept round's own before and after (60/90 to 73/90), beside the rounds used of the most allowed and why training ended (2 of 2, cap reached).
  - Words: an arrow reads "to", and typographic marks are ASCII.
  - Adapters: the protocol is printed only when an adapter arm ran; otherwise one sentence says every reported agent is harness-only. Arms the plan never asked for are listed as not run.
  - Pairs: the difference in pass rate with Newcombe's hybrid score interval (his method 10), from the wins, losses, both and neither counts.
- Comparison 1's report was made again from its records with the `report` command and published as `docs/comparisons/returns-desk-1.md`, with no path, user folder or key in it. Nothing was spent, and its database, request journal and plan are byte for byte as they were (the old `report.md` and `report.json` sit beside the new ones as `.bak`). Targeted mentoring against the bare student is +3.3 points (-11.5 to +18.0), and the draft against the bare student +6.7 (-8.8 to +21.8): no gain was shown.
- Tests: Newcombe's interval against the 18 intervals of Table III of his paper (the same limits to four decimals, but for one lower limit the paper prints as 0.8736 for 0.87367), two cases worked by hand, and the mirror image; the Markdown on a report shaped like the first real one; how each run's rounds ended; the plain-text pass; and the dry run and the runner through the store (seeds, pairs, rounds, where each arm was measured, money, no arrow, no folder name). The tests of the logic (the interval, the seeds, the rounding of the money, the plan's settings over the request's, the plain-text pass) were each checked to fail with their fix taken out.
- Verified: `pnpm check` exits 0 (192 test files, 2,384 passed, 2 skipped).

**Next**
- Comparison 2 runs from `docs/comparisons/returns-desk-2-plan.md`; its report will be made by this code once it is merged.

**Open issues**
- "A01" in 037's statement is the owner's own label and is not explained in the report; the statement stays among the disclosures, beside the opening's "harness-only".
- The identity line of a backend still prints fields that do not apply to a hosted copy ("GGUF none").
- Ollama reports the local build's quantization as Q4_K_M though its name says iq2; the report names the build by its name and says nothing of its bits.
- The app does not read a report in the earlier format, so a `report.json` made before this change shows nothing until `report` makes it again.

## 2026-10-28 (Tue), the polish pass

**Done** (on a branch; decision 055; no model was called, the GPU stayed off)
- Phase 1, everything but the welcome, import and new-agent screens, after a blind review of all 114 screens: every failure a screen words has a code (engine, router, bridge and renderer; a plain sentence and what to do, with the precise message under Details), one verdict on Results and in the agent's settings, one set of words for practice tasks, check tasks and the final test and five outcomes for a round, versions in plain states and actions, Spark and Glimmer named alone with their ids and prices in Settings or Details, numbers that agree across the captures, Settings > Models with the teacher and the agent's model first, Define's training place above the fold, and plainer chat states.
- Phase 2, after merging the ready-made agent (054): the welcome flow (what Architect does in a line, and what Spark and Glimmer are; Model, Teacher, Faster training, Done; "Glimmer · Recommended" and "Glimmer · Smaller" with what each downloads and gives up and whether it runs on the graphics card; Ollama mentioned only when it isn't running; one action in the footer; Spark with a Meta key first and the other three ways under one line), the new-agent screen and the empty workspace ("Try the sample job" a real button beside "Try a ready-made agent", two equal choices), and the import (what the agent does under its name, llama.cpp as its own row that shuts the way on, with a line saying why, until it is set up, folders named by what they hold, "Where are its files?", saving asked once, undone steps marked in the pills, one sentence on the result with the checks under Details, "Not now" until the install is done, a package edited after it was made or not a package said in a sentence, and one field for a Hugging Face address, read as a page address too). A Hub repository that holds no package is coded, in main, and says so in a sentence.
- Found by the full e2e run after the merge: the status line says "Stand-in trained weights" since phase 1, and the real-engine spec for an imported adapter still looked for "Stand-in adapter".
- Blind reads, four rounds of readers who saw only images: 30 screens, 18 teaching screens, 25 welcome, new-agent and import screens, and the 11 of those that changed. Each said what every screen was for and what to do next; what they stumbled on was fixed or is listed below. The last two rounds scored 6.6 and 7.5 of 10 on average.
- Tests: unit tests for the folders' sentences and marks, the stepper's marks, the build names and trade-offs, the repository as typed, when the way on is shut, and the code a Hub repository without a package carries; the e2e specs and their stand-in engines say the new words, the model weighs what the catalog says on every screen, and the stand-in import can say that llama.cpp was set up since the package was first checked.
- Verified: `pnpm check` exits 0 (190 test files, 2,317 passed, 2 skipped), and the hidden `pnpm e2e` passes (122 passed and 2 skipped in 25 minutes; the skipped ones are the packaging spec, which runs against the built archive, and the real engine's test of a shipped package, which waits for the owner's file). Every capture that changed was looked at in both themes; the old `import-weights-attention-*` captures are gone, since a package that needs llama.cpp can no longer be taken past its first step.

**Next**
- The owner adds the real ready-made package (054); look at the import's first step once with its own evidence.

**Open issues**
- In captures made from several fixtures, one run reads differently from the comparison beside it (two example agents with the same name), by the fixtures' design.
- A teacher skipped in setup is said only in the footer of that step and in Settings.
- "llama.cpp" and "trained weights" are named as they are, with a row that says what the program is; no size is given for its download.
- An engine failure that has no code reaches the person in the engine's own words.

## 2026-10-28 (Tue), a ready-made agent that opens through the import

**Done** (on a branch; decision 054; no model was called, the GPU stayed off)
- The app ships a ready-made agent. `sample-agent/` in its resources holds the returns desk's own data (`examples/gear-returns/job/data`) and, when the repository has it, the agent's package, `examples/gear-returns/graduate/returns-desk.architect.zip`. The owner adds that file from the real comparison run; none is committed here, and the tests make their own package from the returns desk job. Main finds both the way it finds the sample job (`processResources`, in development and packaged) and gives them to the engine; electron-builder only warns about a package that isn't there, so a build without it still builds and the app doesn't offer the agent.
- Engine, additive with zod schemas: `graduates.hasSampleAgent` (the package is a file and the data folder holds a file; changes nothing) and `graduates.prepareSampleAgent`, which copies the data to `samples/returns-desk/data` of the app's data folder the first time, as a graduate made here gets its own copy of its job's data, keeps a copy already there as it is, and returns the package's path and the copy's. A copy that can't be made says why. Main allows exactly those two paths for the import that follows.
- "Try a ready-made agent", with a package icon, sits beside "Try the sample job" on the new-agent screen and on the empty workspace, and the welcome flow's last line names it when the build has it. It opens the import on the package with `data/` already chosen: the person still sees Package, Folders (data/ shown as chosen, still theirs to change), Permissions (nothing granted until they choose) and the install checks. A build without the package or its data shows no entry and says nothing of it, and so does an engine that can't answer.
- The sample job's link on the new-agent screen is now a ghost button of the UI package like the new one, so `describe-*` moved by two pixels.
- Tests: engine `sample-agent.test.ts` (whether a build has it; the first copy; a copy kept after the agent changed it; a copy that can't be made; a package made from the returns desk job installing ready from its own data once allowed to open it, and with nothing granted before) and `host.test.ts` over the port; desktop unit tests for the paths in development and packaged, the engine's start message, the paths main allows and the import session's start (the copy that is kept and the allowed paths were each checked to fail without their code); hidden e2e `sample-agent.spec.ts` on a stand-in engine (from the new-agent screen through folders and permissions to a ready install, the welcome flow and the empty workspace, a build without the agent, a copy that fails; captures `sample-agent-*` in both themes) and, on the real engine, `engine.spec.ts` (hidden when the build has no package; when it has one, its data is copied once and kept and the package previews), which also runs against the packaged app. The existing stand-in engines now say the build ships no agent, so their captures never depend on whether the repository holds the file.
- Tried by hand with a throwaway package made from the returns desk job (never committed): the built app copied the 8 data files on first use, its import found `data/` satisfied, edits to the copy survived removing the agent and opening it again, other paths stayed refused, and deleting the package hid the entry; `electron-builder --dir` carried both into `resources/sample-agent`, and the packaged app did the same, and without the package only warned and hid the entry. The model was never loaded (Install wasn't pressed against the running Ollama; the import was made with `loadModel: false`).
- Verified: `pnpm check` exits 0 (186 test files, 2,279 passed, 2 skipped), and the hidden `pnpm e2e` passes (122 passed, 2 skipped, 24 minutes: the packaging spec, and the real engine's test of a shipped package, which waits for the owner's file). Every new capture was looked at in both themes. Four captures of other screens came out 2 to 8 pixels different (timing and anti-aliasing), so main's copies stay; `describe-*` changed because the sample job's link is now a ghost button.

**Next**
- The owner adds the package at `examples/gear-returns/graduate/returns-desk.architect.zip`. From then the real engine's test in `engine.spec.ts` opens it without any other change, `pnpm package` carries it, and the entry shows in the app. Look at the import's first step once with the real package's own evidence.

**Open issues**
- The Package step names the bundled file (`returns-desk.architect.zip`) under the agent's name, as it names any package; it could say the agent comes with Architect.
- The data the agent writes stays through removing and opening the agent again, by design (a copy already there is kept), and nothing on screen resets it.
- The entry appears a moment after its screen, since it asks the engine whether the build has the agent; it never shows an offer that can't be taken up.

## 2026-10-28 (Tue), afternoon: merges, three bugs the real run found, and the comparison started

**Done**
- Merged the evidence screens (decision 049), the GPU lease (046), Teach this on screen (048), Hugging Face on screen (050) and the comparisons runner's safeguards (051). GitHub CI had failed on Linux since fe07109 while local checks passed on Windows; package tests now state the computers they depend on, and CI is green again.
- Every run keeps the events it sent in `events.jsonl` beside its records (decision 052), so a paid run can be shown again for the demo and screenshots without running it again.
- Three bugs found while preparing the real run, each fixed with a test: llama-server's build read as 0 from its newer version line; a command exited with code 0 in the middle of a 30-second retry wait (`AbortSignal.timeout` doesn't hold Node open; `waitOnClock` does); and a tool call Ollama couldn't parse counted as an outage instead of the model's unreadable reply (decision 053: such a turn is asked for again, twice, with seeds derived from its own).
- The owner chose remote inference only, spent sparingly, with development as the must and one graduate to test. The comparison runs hosted with four arms (Glimmer alone, Spark's one-shot draft, targeted mentoring, Spark as a reference), capped at $15 of OpenRouter and $10 of Spark, in `C:/JakeOS/projects/architect-runs/comparison-1`. Calibration measured $0.0062 an attempt, 31.7 s p50, 11 of 15 passed. The trained-weights arm and local tests are out of this comparison.
- A short local probe (owner-approved) measured the 2-bit build at about 90 s an attempt, 6 s a model call, 230 to 250 W; the bare student failed all 3 tasks locally while the hosted bf16 copy passes 11 of 15 on calibration.
- The Windows installer builds (`apps/desktop/release/Architect-Setup-0.1.0.exe`) and the packaged app passes its 21 hidden e2e specs.

**Next**
- When the comparison finishes: the report, the README's results, and the targeted arm's graduate exported as the shipped sample agent.
- Merging the running passes: a ready-made sample agent in the app, a polish pass from a blind review of all 114 screens, and a public website in `site/`.

**Open issues**
- Local inference on a 12 GB card (the 2-bit build) is much weaker than the hosted copy and unmeasured on the final test; the README must say so.
- Trained weights are built and tested against stand-ins but have never run end to end.

## 2026-10-28 (Tue), the evidence screens

**Done** (on a branch; decision 049)
- Train: a Worked examples panel lists every correction Spark wrote with what the checker said of it and whether it passed, how it was obtained (replayed from a step, a full-task demonstration, practice on a similar task) and a count of those that passed; one from a change that wasn't kept says so. Rounds names each round's kind of change and how its experiment ended (kept, reverted, rejected, invalid, stopped), with why in a few words when it isn't kept, and why training ended. The current round says how it ended, the chart marks the score where it was last measured, a cap past its limit says so (the time's, that the final test ran after it), and the screen reads the records again whenever the engine says one changed.
- The round drawer gives the reason in plain words, Spark's findings with a way into the attempt at the step each names, the examples and what the teaching plan set aside, the check tasks per type before and after with failures, regressions and answer times, the gates, the cost (Spark, compute, time, attempts) and the files changed, with ids, versions, seeds and provenance folded under Details.
- An example opens with its verdict, the student's answer with what the checker found wrong beside the correction's, Spark's finding, and the correction step by step: the student's replayed steps named as such, the line where Spark takes over, Spark's steps in its color. Attempts play back step by step from the keyboard and the mouse; each call reads in the workspace's words with its evidence, a wide row as its fields, and the raw call folded.
- Report: a capability breakdown with practice, check tasks and the final test in columns of their own, each with its own mark and bar, Spark's tick only where a reference measured it, install checks on a line of their own; comparisons from the run's records, or the comparisons runner's report when the app runs on its data folder, every arm not run saying so with its reason; peak memory and a cold start only where 045's meter read a final test here. The final test is never set against check tasks, and a card short of its targets says the agent finished training.
- Engine, additive: a correction's trace beside its lesson (`mentoring.lessonTrace`), one practice or check attempt by id (`runs.attempt`, never a final-test one), lessons with their requests, `runs.runtimeMeasurements`, and `reports.comparisons` with `reportBeside` in the comparisons records. The step words moved to `@architect/shared` so the workspace and the playback share them.
- `packages/ui`: EvidenceMark and EvidenceMeter, StepList, Disclosure and DetailList, DrawerSection, and a way back in a drawer that leads to another.
- Recorded data for the e2e specs and screenshots, made with the engine's fakes before each e2e run: a run on the returns desk (`examples/gear-returns/test/recorded-run.ts`; five rounds that end kept, rejected, reverted, invalid and stopped by the wall clock, a final test read by a fake meter, Spark on dev only) and the comparisons runner's dry run of every arm (`packages/engine/scripts/record-dry-comparison.ts`).
- Blind reads of the screenshots (fresh reviewers who saw only the images): the first misread the examples' count, rejected against reverted rounds, the chart's last dot, the phase strip, a validator's record as the right answer, and the comparisons' totals; the second read every screen's purpose right and stumbled on undefined marks and terms, "Before and after" as the agent's own work, jargon, a garbled stopped reason and error states that showed verdicts without their proof. The third answered every question right and stumbled on smaller things: examples from changes not kept listed like the rest, a time over its limit, an undone change's files, unnamed memories and columns, rows not run with no reason, and error states that left a result unsaid or gave no way to read again. Each was fixed with a label or with the data, and the engine's reasons were reworded at the source (decision 049 lists all three).
- Merged main four more times (the comparisons runner, decision 045; Hugging Face on screen, decision 050; one GPU lease, decision 046; Teach this and Improve agent, decision 048, with the comparisons runner's safeguards, decision 051). The evidence views work in an improvement's Train screen (the teaching spec opens a round's drawer there), and the comparisons table reads 051's report: Spark's second reference, an adapter tested with and without it, partial repeats. The held test's reason and an untested arm's read in plain words at the source.
- Tests: hidden e2e `evidence.spec.ts` (a lesson opens its attempt at the right step; rejected, stopped and invalid rounds show as such; Train and the Report reconcile with the stored records, A05; the split marks; the meter's figures; a comparison's report), unit tests for the playback, the words, the comparisons and the meter's figures, and the engine API additions. Screenshots `evidence-*` in both themes, filled and failing.

**Next**
- Dev outcomes case by case, if wanted: the records keep counts per type only.
- A few reasons are still the engine's records as written: a task id in a teaching plan's skip ("pickup-018"), an expected record cut at 80 characters, and a passed answer-time rule on a job with no latency limit; plainer records would carry through.

**Open issues**
- The recorder points `performance.now` at its clock while it records, since the agent loop times turns with `performance.now`; a clock passed to the loop would remove that.

## 2026-10-28 (Tue), the comparisons runner made safe to spend (decision 051)

**Done** (on a branch; no model was called, the GPU stayed off)
- Nothing resumes before the checks: the engine opens without resuming, and the runner checks the plan's pinned inputs, the request against the confirmed plan, and sets up its guards before anything an earlier process left active goes on. `plan` and a mismatched request resume nothing. After merging the GPU lease (decision 046): when the command may work on this computer (the plan or the request has local work, and `--gpu-minutes` grants a window), it checks through the lease that the app has none of the GPU before anything is paid, and stops at once with the busy error if it has, instead of finding out through a run's retries. `probe` checks the same way; `plan` and hosted-only runs never ask. The GPU window's release goes through the lease too, so it never unloads a model of the app's.
- Money is held at each request. Every hosted request is reserved at its worst case against `--student-usd` and written to `requests.jsonl`, flushed, before it is sent, so what is paid and in flight never passes the cap. A request cut off by a crash or a failure, or one that reported no usage, counts as spent at its worst; a student with no known price sends nothing. OpenRouter's per-call charge (`usage.cost`) now reaches the trace and the cost ledger, calibration reconciles it against the listed price, and the projection prices an attempt at what was billed. The holds of 045 read what was paid from the journal.
- `--gpu-minutes` is a hard window from the first local request: when it ends, local requests in flight stop as runtime failures (never scored), none start, and llama-server and Ollama let go of the GPU. With 0 nothing runs locally, the probe included.
- The test-release barrier: once a locked result is released no arm starts or develops, and a dropped arm, a held test or a stopped repeat is never reconsidered. The plan pins the job's tasks, data, checker and job file, and the regression job, by sha256, and refuses a run on changed files.
- The report claims only what its records show: weights by their training, measurement and test records, with 037's statement when no real adapter took the locked test; partial repeats marked; the adapter table headed "Development only"; each graduate's cumulative cost with the shared draft, the totals counting each dollar once; the second job's sweep called a runtime regression check that is no evidence about mentoring; targets as observed counts, with the Wilson interval of 57 of 60. Report format 2, plan format 2.
- Options fixed before any run: `--adapter-protocol reduced` (a smoke check on 3 train tasks, then the locked test of H1 with and without the one-shot adapter on one llama-server); `reference-targeted`, Spark with the targeted arm's frozen harness beside the primary blank-harness reference; and the one-shot adapter's 12 demonstrations named a pilot recipe in the report and here.
- Tests on fakes: `comparisons-guards` (the journal and the cap, the window), `comparisons-runner` (each fix; every new test was checked to fail with its fix taken out), `comparisons-dry-run` (every arm, and the reduced protocol), `comparison-protocol` (the smoke check in the engine), `agent` and `openai-compatible` (the billed charge). The dry run's report was made again from the fakes.

**Next: the first real run, with the owner's go-ahead.** From the repository root, with `OPENROUTER_API_KEY` and `META_API_TOKEN` in the environment, Ollama running with `muse-glimmer:30b-iq2` installed (freezing reads its metadata and loads nothing; no GPU window is needed), and `<out>` a new folder outside the repository, the same for every command. About $20 more OpenRouter credit first, for a balance near $34 against the $30 cap.
1. Calibration and the plan, which spend only the 15 calibration attempts: `pnpm --filter @architect/engine exec tsx scripts/comparisons.ts plan ../../examples/gear-returns/job --out <out> --arms bare,draft,targeted,reference,reference-targeted,repeat --student-usd 30 --spark-usd 15 --headroom 1.5 --regression ../../examples/home-services/job`. Read `<out>/report.md`: the Money section's billing line (billed against the listed price) and the projection.
2. The run, the same command with `run` in place of `plan` (and `--confirm` only if the plan stopped for it): the regression check, arms 1 to 3, the release, both Spark references (arm 4), then the repeat (arm 5).
3. If it ends incomplete (exit 4), the same `run` command again: it goes on from its records.
- The second reference (`reference-targeted`, at most $4 of Spark) is in the arms above because the claim is about approaching Spark; leave it out to keep only the primary reference. Arms can't join once the plan is confirmed.
- Weights, only if the owner adds a Hugging Face token and a GPU window before step 1: add `weights-one-shot` to `--arms` with `--compute --llama-server --adapter-protocol reduced --compute-usd 2.70` and `--gpu-minutes` covering the projection in the command that confirms the plan; its local steps wait, paused, for a command with a window (`probe ... --tasks 3 --meter --gpu-minutes 20` first times the 2-bit build).

**Open issues**
- OpenRouter's per-call charge and the DeepInfra pin are unverified live; the first `plan` shows both in its billing line and identity.
- A request a crash cut off counts at its worst instead of being looked up by its generation id, which the student doesn't keep. Spark calls aren't journaled: one cut off by a crash is paid again and counted once.

## 2026-10-28 (Tue), Teach this, the teaching queue and Improve agent on screen

**Done** (on a branch; decision 048)
- Teach this: every settled reply has a flag beside Copy ("Flag for teaching"). Its sheet asks what was wrong and, optionally, what it should have done, with what it should have used (the files its job lists, as chips, or pasted rows), and says what leaves before anything does: "Only this exchange, its steps and what you add go to Spark. Up to $0.25", beside Share with Spark, in the words of the status line's "Private from Spark" (decision 050). An exchange the leak check refuses says "Spark can't read this exchange" in the form's place; any other failure keeps the form to send again. The proposed lesson shows its kind, what the person said, the change it would make, whether it needs training, why, and its cost; it is queued for Improve agent, saved as the next version (no final test yet, and the active version keeps answering), discarded, or said again. The first send gives the job's leave to share flagged answers, which nothing on screen could set before (`teach.shareCorrections`). An agent from another computer says why it can't be taught here, in the sheet and in Teaching.
- Teaching: Lessons above the versions. Flagged answers, with what waits and what is queued and a drawer to review each; Teach it something new (a new chat, then a flag); Improve agent with every cap it keeps to (rounds, Spark dollars, compute where weights may train, time), whether it would wait for another run, a dialog before it starts, Open and Stop while it runs, and the version it made with "See what changed".
- The improvement runs on the Train screen with its own steps (Lessons, Improve, Report), the lessons it teaches at the top, "Not taken" for the final test and Stop at every point; its report (`/runs/:id/improvement`) gives what improved and what didn't per task type, on the check tasks, what it spent, its lessons, and whether the new version may be promoted, with Promote. The sidebar's training list now follows runs as they start and end.
- Engine, all additive but one fix: Stop ends an improvement that keeps failing while it writes its candidate (decision 042's gap), with its lessons back in the queue; `teach.overview`; `teach.shareCorrections`; a run's `improves` in its detail; Improve agent's budget cut to one improvement's limits, since the job's 12 rounds would have been refused by the improve route.
- A blind read of 23 screenshots, its findings fixed with words (decision 048 lists them): "Save as version 3" for "Apply", "No final test yet" for "Not evaluated", "Queue for Improve agent", the note named in what leaves, You said and Why in the lesson, no second send of a refused exchange, the rounds cap in Improve agent's dialog, no win colors for what didn't improve, and a way forward for an agent from another computer. A second blind read of 13 screens, by a different model, after those fixes: it got what leaves, which version answers, when a queued lesson is used, Improve agent's caps and the report right, and its remaining stumbles were fixed the same way (the files under "What it should have used", the reply's steps named in what leaves, "No, an instruction is enough", the refusal shown as a refusal, a computer rather than a lock for an agent from elsewhere, "practice and check tasks" rather than a fourth name, "Improving from version 2", and each report figure against its own cap).
- Tests: engine `teach-this.test.ts` (the stop while writing fails, a stop during the rounds, the overview, sharing, an imported agent, the budget's limits) and `host.test.ts` (the overview, sharing and an improvement's run detail over the port); unit `apps/desktop/test/unit/workspace/teaching.test.ts` and routing; hidden e2e `teaching.spec.ts` (six tests, each in both themes, 44 captures: `teach-*`, `agent-teaching-lessons*`, `agent-teaching-empty`, `agent-teaching-imported`, `agent-teaching-improving`, `agent-teaching-made`, `improve-*`), and the report's route in `screenshots.spec.ts` (`improvement-*`, for a run it can't read).
- Merged main twice: at 840398c (the comparisons runner, decision 045) and at 8bfebde (Hugging Face on screen and an agent's model, decision 050, whose "Private from Spark" the sheet's consent now echoes). Verified after the second merge: `pnpm check` 178 test files, 2,143 passed, 2 skipped; hidden e2e 101 passed, 1 skipped (18.9 min); every screenshot regenerated, and each new or changed state looked at in at least one theme. Five captures of main's own screens came out different only by timing (`agent-model-changed-dark` lost its toast) or by anti-aliasing, so main's copies stay.

**Next**
- The planner ends any run whose dev score already meets the job's target before its first round, so Improve agent makes no version of an agent that already passes on the check tasks, however its lessons read. Improvements need a rule of their own in the engine, such as one round for the lessons' task types.
- If the owner wants them on screen: a switch for a job's sharing of flagged answers (the first send turns it on, and nothing turns it off), and Improve agent's budget (it is the job's).
- Left for their own areas by the blind reads: the sidebar's training percentage, which reads as progress, the Train screen's practice, check and final-test tasks, and the versions list's Experimental, Ready and imported. (The status line's "The setup from round 7" and "Spark not connected", which both reads flagged, became "Version N" and "Private from Spark" in decision 050.)

**Open issues**
- Teach it something new is a new chat: a lesson is always taught from an exchange, and the engine has no lesson without one.
- The teaching e2e runs against a stand-in engine, like the other screen specs; the real engine's side is covered by its own tests and the host test over the port.

## 2026-10-28 (Tue), one GPU lease for the workspace, the engine, the command and the comparisons

**Done** (on a branch; decision 046)
- One machine-wide GPU lease in the data folder (`local-runtime/gpu-lease.json`, changed under `gpu-lease.lock` in one synchronous step), taken by the workspace's agent host, the engine's utility process and the `architect` command before any model loads on the GPU, in plain Node and in Electron's utility processes alike. A llama-server holds the GPU alone; Ollama's users share it. An idle holder gives it up when another process asks, stopping its llama-server or unloading the Ollama models it used; a busy one keeps it, and the asker waits its turn for up to 5 minutes, then fails with an error that names who holds the GPU and what to do ("The GPU is busy: the workspace is answering a chat with Returns desk. Wait for that reply to finish, or stop it, then try again."). A reply holds it from start to end, except while it waits on the person (an approval, or whether to try saving a change again), when it gives the GPU up and its next model turn takes it back in its turn; a check holds it for its one request, a run for each request; a reply goes before a check and a check before a run's next request. A reply that has to wait says so in one quiet step in its steps ("Waiting for the GPU: Architect is checking an agent on this computer"), gone once it has the GPU (`docs/screenshots/workspace-gpu-wait-*.png`). A request to Ollama stops every idle llama-server of Architect's first. A holder that died stops blocking as soon as a llama-server it left running is gone: the next process to look stops it, even while it is still loading. Quiet mode's thread cap and the 10-minute idle stop are unchanged; the idle stop now also lets go of the lease.
- A base of another build is refused with a fix that can be followed: Ollama can't download a build by its weights, so the person needs the exact GGUF the adapter was trained on, from whoever published the agent, added to Ollama under a name of its own; the fix names the package's own record of its base (a hub address, a revision) when that says more than the name here.
- The agent loop's entry points take `AgentJob` (the business date and the output folder), which a job and the workspace's object both are; the workspace no longer builds a job with a budget of one round, splits of 1/1/1 and a mentor labeled "None". This closes the open issue noted on graduate versions above.
- Checked against main's install checks on first listing (decision 047): they describe the model and never load it, so they don't need the lease, and nothing there loads a model outside it.
- The comparisons runner (decision 045) takes the lease on the app's data folder, found as the app and the command find it (`appDataDir`, moved into the engine from the command). Its own llama-server and its students on Ollama hold the GPU for each request, as the engine's do, and give it up when idle to the app. It takes the GPU only when no process of the app has any of it, Ollama included (`onlyWhenFree`), and otherwise fails at once with the busy error and "Close Architect while a comparison runs, then run the command again.", rather than wait out the app's work or take the GPU from it. The meter's unload before a cold start holds the GPU alone while the script's llama-server stops and Ollama's presets unload, after the script's own Ollama students have given the GPU up, so both backends' cold starts begin with nothing of Architect's loaded.
- `stops a server a crashed app left running` failed once under load in another agent's full run. The lease isn't involved there (the test drives the server manager alone). The weak point was the check that a server a folder's record names is Architect's own, which gave it 2 seconds to answer: a server slower than that, as a stand-in can be on a busy computer, was taken for another program, left running, and joined by the new server, which an orphan that takes 2.5 seconds to answer shows every time. The check now waits 10 seconds (nothing listening, or another program, still answers at once), and so does the lease's takeover from a dead holder, which uses it; the test keeps the slow orphan.
- Tests, with the stand-in llama-server and the fake Ollama only (no model, no GPU): `gpu-lease.test.ts` (the rules; Ollama users sharing; an idle llama-server given up before the asker has it; a busy holder kept and the busy error; a reply before a check before a run; a reply's own requests going on; a run's next request behind a waiting check; a wait stopped; a dead holder, a silent one and a live busy one; a dead holder's server stopped; a lock left by a dead process; close and exit; the thread cap and the idle stop; Ollama requests held, their models unloaded when a llama-server asks, and the lease let go after Ollama's keep-alive; a lease that takes only a free GPU failing at once, sharing Ollama with nobody, its own other use giving way, and an asker of the app going first); `gpu-lease-processes.test.ts` (between a child process and the test's own: idle release, a busy holder and the bounded wait's error, an Ollama request stopping an idle llama-server first, a killed holder taken over; and the comparisons script beside the app in another process: refused at once while the app's llama-server is busy or idle, never taking the GPU from it, holding the GPU for each request and giving it up to the app when idle, and the meter's unload done under the lease, or refused with nothing unloaded while the app has the GPU); `apps/cli/test/gpu.test.ts` (the command beside the desktop's agent host and engine host, each in its own process: the workspace's idle server stops for the engine's check, the command runs after, and the workspace waits while the command's reply runs). The stand-in llama-server now records any other stand-in still running when it starts, and every one of these tests checks that none ever was. `agent-host.test.ts` shows a workspace reply waiting its turn and then answering, its waiting step (one, naming the holder, gone before the model's first word), a reply paused at an approval letting an engine check take the GPU and finishing after the approval, the busy error when its turn never comes, a reply stopped while it waits, and a request on the guardrail list refused at once without waiting for the GPU, which it never needs. The hidden e2e spec `agent-host.spec.ts` now has the engine check an agent with its model loaded while the workspace's llama-server sits idle, in the app's own utility processes: the workspace gives the GPU up first.
- An independent review of the lease found nine problems, all fixed: a grant that stood although its write failed (two processes could both hold the GPU), a lock wait with no end, a dead holder's llama-server taken for gone while it was still loading, an exit that dropped a server's entry before the server stopped, a lock left behind for a moment on Windows, a race between two processes clearing one lock, a process not noticing it lost the GPU while it slept, a new request jumping an equal one that waited longer, and a busy error that called an idle holder one letting go. Each has a test, or a probe that fakes the file errors (a rename that always fails, a lock that can never be created).
- Verified on the first build: `pnpm check` (171 test files, 2,098 passed, 2 skipped) and the hidden e2e suite, before and after the review's fixes (71 passed each time, the packaging spec skipped as usual, about 11 minutes; no screenshot changed). Verified again with the approval pause, the waiting step and the comparisons runner under the lease, main merged at 840398c: `pnpm check` (176 test files, 2,147 passed, 2 skipped) and the hidden e2e suite (71 passed, 1 skipped, 11.0 minutes; the only new screenshots are the waiting step's two, and one other came out byte for byte different but pixel for pixel the same, so it wasn't kept). And on the last commits, main merged at 8bfebde: `pnpm check` (180 test files, 2,172 passed, 2 skipped) and the hidden e2e suite, 69 passed and 1 skipped, with one failure outside this work: main's `versions.spec.ts` "reviews an export" (dark) looks for its toast with `getByText('Exported Service desk')`, which also matched the copy Radix's toast briefly announces for screen readers, and the rest of that serial file didn't run; run again alone, `versions.spec.ts` passed 24 of 24. Screenshots that came out byte for byte different but pixel for pixel the same weren't kept. The cross-process tests passed on every repeat (more than ten runs, some beside the e2e suite). No real llama-server or model ran, and the GPU stayed off.

**Next**
- The command prints a reply's steps once they finish, so a run waiting its turn prints nothing until it has the GPU; it could print the waiting line too.
- The comparisons runner's busy failure is retried as any busy GPU is in a run (30 s, then 90 s, then a pause the runner resumes after a rest), so a comparison started beside an open app spends a few minutes finding out before it ends incomplete; `probe` fails at once. A meter refused the GPU as a metered locked test starts leaves that stretch unmeasured, with a warning, as any meter failure does.

**Open issues**
- The lease belongs to a data folder: two copies of Architect on different data folders, LM Studio, a llama-server the user runs, or a model another app loaded through Ollama aren't coordinated with it (a llama-server start still unloads Ollama's models first).
- A mentor, or a student, on another runtime on this computer (LM Studio, any OpenAI-compatible server) takes no part in the lease.

**Risks**
- A long chat still holds the GPU between its model turns, so a run's next request can wait past 5 minutes behind one; it then stops with the busy error, waits as decision 029 says, and pauses with the reason, and resuming it is the person's.

## 2026-10-28 (Tue), Hugging Face on screen, an agent's model, and clearer checks

**Done** (on a branch; decision 050)
- Publishing to Hugging Face is the Export tab's second destination: the repository (the last one the agent went to), Private unless chosen, where the token comes from, every file that will go with the model card to preview, and the scan; then the upload's stage and bytes; then "Version N is on Hugging Face" with the commit, the link and the install command, or "Couldn't publish ..." with the Hub's message and what to do, and Finish publishing completes the same record. A publication on its way survives closing the agent's settings. The agent's publications are listed with repository, version, commit and date.
- The engine sends a publication's progress (`graduates.onPublishProgress`: connecting, uploading with the bytes the upload counted, verifying, describing), checked with its schema over the port and forwarded by main. Install checks carry the fields the screens need (why a check was skipped, llama.cpp's build, whether the base is the tested build, what stands in the way of the base, each folder's problem); the renderer words checks and offers fixes from those alone.
- Settings › Models lists Hugging Face with the keys: the token saved here, from `HF_TOKEN`, or from `hf auth login`'s file, never its value, with Add token and remove. The app follows `HF_ENDPOINT` as the command does; the saved key goes only to huggingface.co. `app.openLink` opens HTTPS pages on known hosts, now huggingface.co.
- Install from Hugging Face is a source in Import and in the sidebar's agent menu: `owner/name` and a commit. It downloads that commit and installs it with nothing granted and no model loaded, recording the commit, then goes through a package file's steps; Cancel and the close button take it back.
- An agent's model is a picker in General of this computer's models (Ollama's alone for trained weights); choosing one binds it and the checks run again. A base of another build offers Choose its model, which opens that picker, even though it blocks.
- The status line names the version ("Version 2") and the model this computer runs, and says "Private from Spark" where "Spark not connected" contradicted Settings; General's Setup row names the version too; a chat waiting for the person says "Needs you" in the sidebar where a dot read as unread; the chat's header says "Can't run on this computer" when the checks block the agent; Settings' default model is "Model for new agents". Imports read the agent afresh when they finish, so an agent removed and installed again under its id shows its new installation.
- Tests: engine (`graduate-hub` progress, `host` progress over the port, `graduate-check-fields`), desktop unit (`hub`, `links`, `graduate-handlers`, `versions`, `labels`), hidden e2e on the real engine against the fake Hub (`e2e/hub.spec.ts`: publish to the link and commit, a failed upload then Finish publishing, install by commit, change the model with the checks run again) and captures of every new screen and state in both themes (`e2e/hub-screens.spec.ts`). `launchApp` keeps every test off the real Hub and the computer's token.
- Merged main (the comparisons runner, decision 045). After the merge `pnpm check` exits 0 (177 test files, 2128 tests) and the hidden end-to-end suite passes (89, one skipped), regenerating every capture.
- Every regenerated screenshot was looked at, then a fresh subagent given only 22 of them said what each screen is for and what it would do next. Its findings and what changed are in decision 050: the version in General, "Model for new agents", the header of a blocked agent, the publish button naming its version, Finish publishing, "Optional" beside Commit, "Model responds", the token dialog's line, and stand-in data that agrees across captures.

**Next**
- One real private publish and install by commit, once a Hugging Face token with write access exists (A12).
- A preview of a Hub package before it installs, which needs the engine to keep a download in staging between two calls.

**Open issues**
- A pasted Hugging Face token isn't checked until it is used; a refused one shows when publishing, with what to do.
- If the app quits during a Hub install, after the download and before Install, the version stays installed with nothing granted, needing attention.
- A publication can't be stopped once it starts: the engine has no way to, so the screen offers none.

## 2026-10-28 (Tue), the comparisons runner

**Done** (on a branch; decision 045)
- `packages/engine/scripts/comparisons.ts` runs decision 037's arms on the new runtime and replaces `experiment.ts` for them: plan, run, probe and report over `packages/engine/src/comparisons`. Calibration prices an attempt before any arm spends; arms are funded in 037's order and a plan the caps cut waits for `--confirm`; each arm holds its locked test until every arm is frozen; the repeat runs seed 102 later; each arm is held to its caps; a crash resumes from the records (decision 051 says exactly what a restart can pay again). The report is JSON for the app and Markdown for the README, from stored records only, one table per backend.
- The engine gained, additively (migration 16): a run protocol (arm, held test, deferred repeats, fixed menu, adopted harness, one-shot adapter, job time limit, fixed rounds), repeats as their own resumable sessions, and runtime measurements (peak process and GPU memory, cold start) from an optional meter during local locked tests.
- Decision 042's five weights gaps are fixed, each with a test (`weights-gaps.test.ts`).
- A hosted student can be pinned to OpenRouter providers with no fallback; the comparisons pin DeepInfra's bf16, since Together serves FP8.
- Tests on fakes only, no model call and the GPU off: `comparisons-model`, `comparisons-runner`, `comparisons-dry-run`, `comparison-protocol`, `weights-gaps`. The dry run takes every arm through on the returns desk, a dropped arm and a stopped one included; the weights arms run on the real adapter runtime with the stand-in llama-server and a tiny base in a fake Ollama store, and the one-shot adapter's package names the base's `base_digest`. That gap from decision 042's notes was already closed: freezing reads the digest through the llama.cpp student, and the package names it.
- An independent review of the branch found no way for the locked test to open early, and five real bugs, all fixed with tests: the per-arm student cap stopped arms on 4% of price noise (a stopped bare run takes no test); nothing held the total credit while the comparison ran; `probe` resumed arms with nothing watching their spend; two processes on one folder would pay twice; and a hosted-only run needed Ollama for freezing, unchecked until after it paid. The credit is now held at every step at measured prices, variable arms stop only at a round's start, fixed-size arms never, `probe` resumes nothing, a lock keeps one process per folder, and the local build is checked before anything spends.

**Next: the real runs, with the owner's go-ahead.** From the repository root, with `OPENROUTER_API_KEY` and `META_API_TOKEN` in the environment (and `HF_TOKEN` only for weights), and Ollama running with `muse-glimmer:30b-iq2` installed: freezing reads the local build's metadata to pin it, and loads nothing. `<out>` is a folder outside the repository, the same for every command of one comparison; the app stays closed while it runs: the runner shares the app's GPU lease (decision 046) and stops at once with the busy error while the app has the GPU.
- Plan, which spends only the 15 calibration attempts: `pnpm --filter @architect/engine exec tsx scripts/comparisons.ts plan ../../examples/gear-returns/job --out <out> --arms bare,draft,targeted,reference,repeat,fixed --student-usd 15 --spark-usd 15 --regression ../../examples/home-services/job`
- Run arms 1 to 6 as planned: the same with `run` and `--confirm`. At $15 of student credit the fixed arm is dropped; `--student-usd 21` funds it. If calibration prices an attempt near $0.018, `--headroom 1` keeps the targeted arm within $15. The plan is fixed once confirmed.
- With a GPU window: `... probe ../../examples/gear-returns/job --out <out> --tasks 3 --meter`, then the run again with `--local-ollama --meter`.
- With a Hugging Face token and a GPU window, decided before the first run: add `weights-one-shot,weights-targeted` to `--arms`, with `--compute --llama-server --compute-usd 8.10 --gpu-minutes <from the probe> --local-ollama --meter`.

**Open issues**
- Nothing is measured on the new runtime yet; the projections assume $0.01 and 18 s an attempt until calibration prices one. The old runtime measured $0.018 an attempt on home services, and at that price arms 1 to 5 don't fit $15: the plan would stop for confirmation.
- OpenRouter's provider pin and the system meter (tasklist or ps, and nvidia-smi) are unverified live.
- The runner holds the student's credit at each step at measured prices, not per attempt; OpenRouter's own balance stops calls past it. Local GPU minutes are a funding check, not a hold on the running time.

## 2026-10-28 (Tue), the versions, export and import screens

**Done** (decision 047)
- Agent settings are General, Permissions, Teaching, Report and Export, each tab one entry in a list. Teaching lists the versions, newest first, with each one's standing (active, candidate, rejected, or its own evaluation: ready, experimental, not evaluated), its score from its own report ("55 of 60 passed"), its parent or "imported", and its date. Promote and Roll back each ask first in a dialog that says which setup (and trained weights) answers next and that the other version stays, and, before promoting a version its own test didn't vouch for, why. A reply's steps end with the version that answered it.
- Export reviews the package before anything leaves: what goes in (sharing data is a switch, off by default), the scan with the line that trained weights may retain information from their training data, what stays on this computer, then the setup, trained weights and report on their own. A finding holds back every export that carries it until "Export anyway", and the footer says so. The old folder export and folder import rows are gone.
- Import agent, from the sidebar's agent menu: Package (the package, this computer and its model, the author's result as "Evaluated on the author's computer"), Folders, Permissions (nothing granted until chosen), Install ("Install checks on this computer": Ready to run, Needs attention or Can't run, each failed check with its way out). After merging the adapter-serving work, a package with trained weights shows a llama.cpp row in both, with its build or what is missing, and Set up llama.cpp in Settings opens Settings at Models; closing Settings checks the package again.
- The engine gained what these needed, all additive: `previewImport` (for a package with an adapter, the same survey of llama-server, the base and the staged adapter file that decision 041's checks run), `exportPart` with each part's own findings in the review, install checks the first time a graduate is listed, accepted, promoted or rolled back to (the model described, never loaded), so one made here never shows as unchecked.
- Workspace fixes: an allowed change that can't be saved goes back to waiting with the reason in plain words and offers Try again, and shows "Not saved" when given up, never "approved"; a table read's step counts rows ("5 rows", "rows 201-400 of 1,505").
- A blind read: a fresh reviewer saw only the 21 screenshots and said what each screen was for and what confused it. Its findings, fixed with words rather than explanations: harness, adapter and "bound" became setup, trained weights and chosen; a blocked install no longer blamed this computer for a broken tool; the raw `EBUSY` code became "invoices.csv is open in another program"; a folder never chosen no longer offered "Not allowed"; minus marks that looked like remove buttons became locks; a disabled Export says what it waits for; "57/60" became "57 of 60 passed"; "Ready" became "Ready to run"; promoting an unmeasured version says so. A second blind read of nine screens, after the merge, found the import's computer row saying "Runs it with llama.cpp" with a check while the next row said llama-server wasn't installed: the computer's row now names only the computer, the base model row says it is downloaded through Ollama, and the button says it opens Settings. It also stumbled on "locked test" (now "final test"), on an unexplained Experimental (now "Below its 90% target" or "Tested on a hosted copy") and on what the scores measure (the column is now titled Final test). Left for their own areas: the status line's "Spark not connected" and "The setup from round 7", and the sidebar's unread dots.
- General and Permissions read the active version's contract, and Report the report card the version carries (`graduates.report`), so an imported agent's tabs work without its author's job or run; Report titles a version from elsewhere "Evaluated on the author's computer". Permissions shows each folder the agent works in, with Change.
- Tests: engine tests for the preview, part exports, report reading, install checks on first listing, a save that fails after approval (retried, given up, and with nobody to ask, and its reason in plain words) and table reads counted in rows; a unit test for the version moves, the promote caution and the install-check wording (`apps/desktop/test/unit/workspace/versions.test.ts`); hidden e2e `versions.spec.ts` (promote and rollback; export with its inclusion review; imports through bindings to a ready install, a blocked one and one fixed from its result; a package with trained weights where llama.cpp is missing; a refused package; an install that fails; the unsaved-change card), with captures of every new screen and state in both themes (`agent-teaching*`, `agent-promote*`, `agent-rollback`, `agent-export*`, `import-*`, `workspace-unsaved`).
- Merged main twice (adapter serving at 3b43542; mentoring, Teach this, the architect command and Hugging Face publishing at 87e8d42). The import preview runs the adapter checks too, through `adapterRequest`; part exports use main's review guard; the command's tests and docs count a table read in rows. Verified after the second merge: `pnpm check` 168 test files, 2,064 passed, 2 skipped; hidden e2e 71 passed, 1 skipped (10.7 min); all 116 screenshots regenerated byte for byte.

**Next**
- The later UI pass: Teach this, the teaching queue and Improve agent in the Teaching tab (under Versions), publishing, and the evidence screens.
- A base of another build blocks a version with trained weights, and its fix (add the exact build under its own name, then set the agent's model to it) has no button yet: the agent's model can't be changed on screen.

**Open issues**
- The import, export and versions e2e run against a stand-in engine in the main process (like the other screen specs); the real engine's export and import stay covered by `engine.spec.ts` and the engine tests.
- Install checks run on first listing describe the model through the local runtime once per version; they never load it. "Check again" in General and in an import's result runs the full checks, which load the model once.

## 2026-10-28 (Tue), morning: adapter serving, mentoring and the command merged

**Done**
- Merged three branches into main, in this order: adapter serving (decision 041), failure-specific mentoring with Teach this and Improve agent (042), and the `architect` command with Hugging Face publishing (043, 044). Each merge passed `pnpm check`.
- At the last merge, the Hub's migration became 15 (both branches had taken 14). The training worker now gets its Hugging Face token from the same resolver as publishing: the key saved in the app, then `HF_TOKEN`, then Hugging Face's token file. Without a token, weights stay off the intervention menu, as before.

**Next**
- Screens: Teach this, the teaching queue, Improve agent, publishing and the Hugging Face key; then the evidence screens (lessons, experiments, the capability breakdown, step playback); then the comparisons runner for decision 037.
- One GPU lease across the workspace, the engine and the command, so two llama-servers or a llama-server and Ollama never hold the GPU at once.

**Open issues**
- Live Hugging Face validation (A01, A12) waits for a token with write access on an account with credit.

## 2026-10-28 (Tue), the architect command and Hugging Face

**Done** (on a branch; decisions 043 and 044)
- `apps/cli`, the `architect` command: list, install (a package, or `hf://owner/name` at a commit), run, inspect, verify, export and publish, on the app's own data folder (`ARCHITECT_USER_DATA` overrides). `run` goes through the workspace's agent host in its own process: the same loader, folders, grants, approvals, tools and event stream, behind the same network guard, never a mentor. Without a request it is a conversation (answer on stdout, steps on stderr, approvals asked on a terminal); with `--input` it is one task, `architect.run-request/1` in and `architect.run-result/1` out, checked with zod before anything runs. An approval it can't ask about ends the run as `approval_required` with the change it wanted. Exit codes: 0, 1 runtime error, 2 invalid input, 3 not permitted, 4 task failed, 130 cancelled. `docs/CLI.md` documents it.
- `pnpm architect` runs it in development. The desktop build bundles it (`out/cli/architect.mjs`, about 1 MB) and the installers carry a launcher that runs it on the app's own binary as Node: `architect.cmd` beside `Architect.exe`, and `Contents/Resources/architect` on macOS. The unpacked Windows build ran a task end to end through `architect.cmd`, the sandboxed `run` tool included.
- One Hugging Face client, moved out of training to `packages/engine/src/hub`, now uploads large files through LFS (basic and multipart), confirms them, commits with deletions and a parent commit, lists files by revision and caps downloads; the token goes only to the Hub's API. The fake Hub grew the same endpoints and a separate upload host that records any token sent to it.
- The token resolver: the key saved in the app (`huggingface`, a new secret service bound to `huggingface.co`) first, then `HF_TOKEN`, then the token file `hf auth login` writes. It is ready for the training backend's `token` option.
- Publishing: the version's package as an export would write it, after the same review and scan (the model card included), to a repository that is private unless asked otherwise, never made more visible, and refused when public for a private publication. The package goes up in one commit, is checked against the Hub's listing, then a second commit adds a model card made only from the manifest, naming that commit in its install command. One publication record per version and repository: complete only when all of that is done, failed otherwise, and finished by trying again without sending what the Hub already has.
- Installing from the Hub: one commit, looked up once and recorded with the version; only `graduate.json` and the files it lists, each checked as it arrives; then the same import as any package. Migration 15 (14 on its branch, renumbered at the merge) adds the version's source, the publication's digest and one publication per version and repository.
- The engine API and IPC serve `reviewPublication`, `publish`, `publications` and `installFromHub`, with zod schemas, for the Export screen.
- Tests: A10 (the terminal and the app give the same outcome from the same runtime, the model sent the same requests turn for turn, only guarded local connections), A11 (every exit code and the JSON result for each), A12 against the fake Hub (publish privately, install that commit on a clean computer and run it, failed uploads and retries).
- Merged main's adapter serving: the command passes its own llama-server (`local-runtime/cli`) to the agent host, follows the app's settings file for it and for quiet mode, and stops it when the command ends; a stand-in llama-server shows none outlives `architect run`.
- An independent review of the diff found five bugs and two smaller issues, all fixed with tests: a public repository couldn't be installed without a token; a request-file run at a terminal could wait for good at an approval question (end of input, Ctrl+C); bad versions, export items and repository names exited 1 instead of 2; a huge `--timeout` stopped the run at once; a shared resource's package changed every day, so publishing it again was refused; a Hub install of a version installed before from a file didn't record its commit; and plain HTTP to this computer was allowed from a Hub on the internet.

**Next**
- With a Hugging Face token: one real private publish and install by commit, which A12 still needs, and which will show whether the Hub takes LFS uploads for its Xet-backed repositories.
- The Export tab's publishing screen and a Settings field for the Hugging Face key (UI work), and the training backend's `token` wired to the resolver (lessons work).
- Try the macOS launcher in a built `.app`.

**Open issues**
- The lessons branch builds the training worker with `HubClient` from `../training`; the training barrel still exports it (from `src/hub`), so that merge is mechanical. Its `huggingFaceToken` option can take `hubTokenResolver({ saved: () => deps.secrets.get('huggingface') })`.
- The command can't read keys saved in the desktop app, so its scan knows only the Hugging Face token it would use; the app's own publishing checks them all.
- An import from the command and one from the app for the same agent at the same moment aren't coordinated.
- Publishing over IPC reports no progress until it ends.

## 2026-10-28 (Tue), failure-specific mentoring, Teach this and Improve agent

**Done**
- Failure-specific mentoring (decision 042). The mentor's reply names findings on failed train attempts (the turn it suspects, step-referenced evidence, a category with a stable id) and one intervention from a menu the runner validates. Findings that don't hold are set aside with the reason; estimates past what is left, weights without compute and lookup tables of train answers are refused and recorded.
- Verified lessons. A correction rebuilds the attempt at a whole tool batch (harness hash, tool runtime, date and data hashes checked, every call replayed and compared), and the mentor continues as the agent in a fresh, answer-blind context; then one turn earlier; then a full demonstration labeled as one. The checker and a mutation audit decide. A lesson's training targets are the mentor's own turns only. Related practice from other train tasks of the type, caps per category and type, and plateau stops. Every mentor turn passes the leak check and the dollar cap and is charged.
- Candidates and evaluation: worked examples with a retrieval rule, a weights round through the training worker (targeted lessons plus a little rehearsal, idempotent submit, polling on the run's clock) measured as H0/A0, H1/A0, H0/A1 and H1/A1 on the same seeds; hard gates for writes, p95 latency and stand-in adapters; a clarification round that waits for the person; one experiment record per round with its budget and a disposition (kept, reverted, rejected, invalid, stopped). Progress and the capability breakdown come from those records.
- Freezing keeps the whole configuration (backend, adapter file and digest, scale, decoding); the locked test refuses a changed adapter and repeats on declared seeds (101 and 102), one scenario per task.
- Spark as a reference on a finished run's dev tasks or locked test, with its own cap and configuration, isolated from mentoring and the card.
- Workspace replies keep their work, call by call. Teach this: the mentor reads one exchange only with the job's sharing setting and the person's consent, proposes a classified lesson, and the person queues or discards it. An instruction lesson becomes a candidate version at once; Improve agent turns the queue into a candidate measured on dev. The active version never changes.
- Wiring: the training worker resumes with the engine host, the recipe ships with the app, the adapter runtime and the mentor as the agent are wired. Engine API and IPC with zod schemas for lessons, interventions, experiments, progress, capabilities, categories, clarification answers, references, corrections and improvements. SQLite migration 14.
- Tests on fakes only, no model calls and the GPU off: `teaching-correction`, `mentoring-loop`, `mentoring-api`, `mentoring-store`, `weights-loop`, `frozen-config`, `reference`, `teach-this`, `training-wiring`, and the reply trace in `agent-host`. One whole chain runs on the returns desk with the real tools, sandbox, checker, vault and loop and scripted models (`examples/gear-returns/test/mentoring-chain.test.ts`): a failed refund, its finding, a replayed and verified correction, a verified practice case, and a kept procedure on a paired dev measurement.

- Merged main with adapter serving (decision 041; this branch's design became decision 042). The engine has one llama-server: the utility process makes the adapter runtime once for the loop's adapter students and the installation checks, and an evaluation through it takes the checks' turn.
- Three independent reviews of the whole diff. Fixed, each with a test: teaching now stops between corrections for a pause, a stop or the wall clock; a mentor whose model can't act as the agent keeps teaching off the menu, and an actor error that waiting won't fix rejects the try instead of stalling the run; a turn that breaks off without its usage is charged its authorization; plateau stops count measured rounds only; a draft is measured as a whole harness whatever intervention it names; a failed hard gate always rejects; weights are off the menu when the locked test is hosted or only the stand-in is set up (tests still offer it); locked-test seeds must differ; an improvement never takes the locked test, needs the job to still share corrections, and takes only lessons still queued, in the transaction that writes its run; Spark's reference attempts stay out of the student's costs, capability numbers and recent attempts; a baseline is read under the configuration it ran in. The gaps not fixed are listed in decision 042.

**Next**
- Screens: lessons and experiments on the training view, the capability breakdown, a Teach this sheet on replies (with the consent and cap shown), the queue and Improve agent beside the versions screen.
- Pass the Hugging Face token to the engine's utility process once the key resolver lands, so the app can train for real.

**Open issues**
- Graduating with an adapter needs the llama.cpp student to report the base's digest.
- The stand-in backend reads its base header from the default student in Ollama's store.
- An imported agent can't be taught here: its job isn't on this computer.

## 2026-10-28 (Tue), graduates with an adapter run

**Done** (on a branch, decision 041)
- A version with an adapter runs on llama.cpp, on the base from Ollama's store, with its adapter at its scale on every request; a version without one runs on Ollama as before. Its installation stays bound to Ollama, so one agent rolls back between the two kinds with nothing rebound.
- Before serving, the adapter runtime holds the base to the adapter's `base_digest` and the adapter file to its sha256, at every start; the agent host checks both when it opens a version, and a mismatch blocks it with the exact base it was trained on.
- Import accepts a package with an adapter. Its installation checks ask the runtime for every problem at once: no llama-server (set its path or install llama.cpp), a build older than 10358 (update it) and a base not downloaded (its size and exact weights) need attention; another build of the base, or an adapter that isn't the file installed, blocks. A new `adapter-runtime` check names the build; the timed request goes through llama.cpp with the adapter.
- The agent host and the engine host each have their own llama-server (`local-runtime/workspace`, `local-runtime/engine`), configured from settings: the path, quiet mode's thread cap, the Ollama to unload, the 10-minute idle stop. `createAgentHost` now requires a runtime, so the CLI serves adapters the same way. The agent host stops its llama-server before it exits on quit.
- Settings › Models has a llama.cpp row: its build, too old with how to update, or what is missing, a check, and a program chosen in a file dialog (the only way the path changes). The workspace's status line says "LoRA adapter", or "Stand-in adapter".
- Found and fixed on the way: the checks compared an adapter's GGUF digest with the digest Ollama's API reports, which comes from the manifest (GOTCHAS).
- An independent review of the diff found six problems, all fixed with tests: an agent removed and imported again under its id could be answered by the server that had loaded its old adapter from the same path (now the launch names each file's sha256, and closing a graduate lets go of the server); llama-server always ran with a 16K context, whatever the version's; two agents' model checks at once found the engine's one server busy (they now take turns); Settings hid the way back to PATH when a chosen program had gone; a default student on another computer's Ollama would have failed every adapter start; and three messages pointed to the wrong fix (replacing a base other versions use, a skipped request blamed on the model, a models folder setting the app doesn't have).
- Tests with the stand-in llama-server and stand-in adapters: serving with per-request scales, the digest and sha256 refusals, import and checks with and without llama-server, too old and another build, rollback restoring the matching adapter and after a restart, the offline guard with an adapter version (every connection loopback, llama-server gone with the host), and a hidden e2e spec in `agent-host.spec.ts` (a package with an adapter imports ready, opens, answers through the stand-in, and shows "Stand-in adapter"; no stand-in outlives the app).

**Next**
- Merge, then the CLI passes its own runtime to `createAgentHost` (`hostAdapterRuntime`, folder `local-runtime/cli`).
- A real adapter on the 2-bit build once a training job has made one and the owner allows GPU time.

**Open issues**
- An installation check that loads the model starts the engine's llama-server while the workspace's may be running; on a 12 GB card the second would run out of memory and the check would say so.
- After an adapter reply llama-server keeps the GPU until it has been idle 10 minutes; an Ollama graduate answering meanwhile shares the card.

## 2026-10-28 (Tue), graduate versions and portable packages

**Done**
- A graduate version is now a package (decision 038): a folder with `graduate.json` (manifest v2: identity, contract, model, harness, resources, requirements, evidence, verification, checksums of every file, terms) and `<name>-v<n>.architect.zip` for moving it. Nothing machine-specific goes in. The ZIP reader and writer are written here and refuse traversal, links, devices, bombs, lying sizes, oversized directories, encryption and overlapping entries.
- Every graduate is an agent with immutable versions (decision 039): candidates wait apart, accepting and promoting are separate events, promotion and rollback are one transaction each, and a version's folder is verified (manifest digest and every checksum) each time it opens, so its harness and adapter always come back together. Chats record the version they started on and each reply the version that wrote it. Job contracts have versions; a result measured under one never counts for another.
- A graduate opens from its own folder plus this computer's installation (model endpoint, folders for `data/` and `output/`, grants). A graduate made here gets its job's endpoint, a copy of the job's data and the job's write mode, with no export. An import grants only what it names, on any computer. `output/` is the installation's own folder, bound only when the job contract allows an output folder; it no longer sits inside the data folder.
- Merged main twice more. With the adapter runtime: a version's adapter is named the way the runtime loads it (decision 038): the GGUF LoRA's sha256, held to its integrity entry; the digest of the base's GGUF file in Ollama's store; the scale; the training job id and a stand-in label. An opened version carries the runtime's request (`ActiveVersion.adapter`), so a rollback hands it the earlier harness and adapter together. With the coding-agent runtime: every harness read is held to its manifest as stored, the workspace runs on the agent's folder and tools, and an approval no one can answer carries the new tools' change.
- Graduates and runs from harness format 1 are no longer stuck (decision 040): a migrated harness is known by its new hash and keeps the old one as provenance, so graduates from before versions convert, open, accept and roll back, and a run frozen in format 1 takes its locked test, its package saying it was migrated first.
- Export writes exactly what its review scanned: the version's folder byte for byte, opt-in resources, and a scan for stored keys, key shapes and user paths that stops the export until the request names the findings reviewed. Import: everything checked in staging before any code loads, then installed as a new local version (never over one, joining an agent only through a parent it has), then installation checks (platform, memory, runtime, adapter, harness hash, tools, folders and their columns, the model and its build, a timed request) labelled as this computer's.
- Graduates in format 1 convert to version 1 when the engine starts: their endpoint moves into the installation, their workspace folder and write mode stay, their old files stay. SQLite migrations 9 to 13: versions, events, installations, checks, publications (schema only), job contracts, versions on chats and replies.
- An ask-mode approval can fail with `approval_required` instead of waiting, for the CLI.
- Engine API and IPC, with zod schemas: versions, history, accept or reject a version, promote, rollback, installation, bind, verify, review an export, export, inspect and import a package. The current screens keep working on a format 1 shaped view of the active version.
- An independent review of the import, export and version code found 14 problems, all fixed with tests: an import trusted a package's claimed job to grant itself folders, and its claimed id to join an agent; format 1 files and harnesses were parsed before being weighed; the scan showed other secrets in excerpts, missed JSON-escaped paths and had a pattern that backtracked for seconds; a confirmation covered findings the user never saw; and smaller ones (OS clutter, the ZIP directory size, adapter packages that could never run, rebinding races, an unbound `data/` folder, the model left loaded after a failed check).
- Verified after the last merge: `pnpm check` (1,823 tests, 2 skipped) and the hidden e2e suite (45 passed, the packaging spec skipped as usual). New tests cover A06, A07, A08, A09 and A13 (`packages/engine/test/graduate-*.test.ts`, `packages/harness/test/package.test.ts`), a run frozen in format 1 (`test-targets.test.ts`), and the installation's own `output/` folder.

**Next**
- Screens for versions, export review and import (bindings, grants, checks). Until then the current Import button installs a package that needs its folders bound before it can chat.
- Serve adapter versions in the agent host and the installation checks through `createLlamaCppStudent` over the local runtime's `LlamaServerAccess`, checking the served base against the adapter's `base_digest`, then let imports with adapters in. The session already carries the runtime's request.
- The CLI on `send(..., { approvals: 'fail' })`, and Hugging Face publishing into the `publications` table.
- Chats still drop tool traces; Teach this will need them.

**Open issues**
- The agent loop still takes a whole `Job`, so the workspace builds one from the contract with inert training fields; narrowing `RunAgentOptions.job` to the data files and business date would remove them.

## 2026-10-28 (Tue), before dawn: two merges, a checker gap, and the plan fixed

**Done**
- Merged the adapter runtime and training worker (134e00a) and the coding-agent runtime (abb8885). `pnpm check` passed on main after each; the runtime branch's hidden e2e run passed 45 with 1 skipped.
- Hugging Face Jobs, checked against the Hub's own Jobs guide: they need only a positive credit balance, not a PRO plan as first written. The L40S is $1.80 an hour, billed by the minute. Docs and the forbidden error now say so (df3d64e).
- A second opinion on the evaluation plan (GPT 6 Astra) found grading gaps before any measurement. Decision 036 closes them: answer tasks fail when they change data, and the returns desk's tasks fail when they touch a table other than their own (7b122ff, with tests).
- Decision 037 fixes the evaluation plan on the new runtime before any run: the arms in priority order, the seeds, the backends, freezing before reveal, reporting per backend, and the exact statement to use if no Hugging Face token arrives.

**Next**
- Merge the graduate-versions work. Then start the CLI and Hugging Face work and the versions, export and import screens, and tell the lessons agent so it can build Teach this and Improve agent on top.
- After the lessons work: the Teach this and evidence screens, and a comparisons runner for decision 037 that replaces experiment.ts, which hard-codes home services and the old methods.

**Open issues**
- A01 still waits on a Hugging Face token (write access, an account with credit).
- Local evaluation on the 2-bit build needs a GPU window from the owner. Its length is measured first with a throughput probe.
- Graduates made before runtime v2 can't be accepted or re-tested yet. The graduate-versions agent has the fix.

## 2026-10-28 (Tue), runtime v2: a coding agent's harness

**Done**
- The student and every graduate now work like a coding agent (decision 030 and its as-built notes): `read`, `ls`, `glob`, `grep`, `write`, `edit`, `append` and `run` over a folder of logical paths, `data/` for the job's files, `output/` when the job allows one, `skills/` read-only. `run` is JavaScript in the QuickJS sandbox with read-only files, `csv.parse` and `csv.stringify`, and the job's date as `today`; `grep` runs there too, so a runaway pattern is stopped. Writes go through the job's permissions and the workspace's approvals, keep tables valid CSV, and are diffed by line and by row. The table tools are gone.
- Harness format 2: `AGENTS.md`, and skills as `skills/<name>/SKILL.md` read on demand. Format 1 folders still load, checked against their stored hash and migrated in memory.
- Traces record what each attempt started from (data hashes, harness hash, tools version, seed, decoding, business date) and the diff of every write, for the replay work next.
- The mentor's view and prompts describe the new folder and tools; its edit paths take the format 2 layout and refuse the old names with the new ones.
- Both sample jobs' reference solutions use the new tools, and their tests replay every call through the engine's tools and pass the real checkers; the job files are unchanged.
- The workspace shows a table read as a compact table, `run` with its code folded and its output, and text changes as line diffs in the approval card; the trace drawer on Train does the same. Old chats and traces still render.
- An independent review of the engine and harness changes found eleven problems; the ones that could crash an evaluation, stall the engine, overwrite a file unseen or block old harnesses from loading are fixed and tested.
- Merged with main's model-agnostic providers, adapter runtime and training worker. The loop treats a llama.cpp student, which serves graduates that carry an adapter, exactly as it treats an Ollama one: `agent-runtimes.test.ts` plays the same turns through both real adapters over fake servers (tool calls run, reasoning counted and dropped, a garbled call failing only the attempt, a runtime failure stopping the run with the adapter's error) and checks that every llama-server lease is given back.
- `pnpm check` passes (1,519 tests before the merge, 1,760 after) and so does the hidden e2e suite (39 specs before the merge, 45 after); screenshots of the changed screens are regenerated.

**Next**
- Calibrate both jobs' bare student on the new tools before any comparison runs on them: every earlier number describes the table tools.
- Replay and verified corrections (plan item 4) on top of the new trace capture.

**Open issues**
- A run frozen before this change can't take or repeat its locked test, and its graduate can't be accepted, because its harness gets a new hash when read in format 2. Accepting could rewrite the manifest with the new hash; that belongs to the graduate-versions work, which owns accept. Seeds 2 to 5 that are still paused would go on with the new tools if resumed, mixing two runtimes in one run; finish or restart them deliberately. Traces from before have no `replay` record, so the mix would show.
- Validators don't read `output/` yet, and in the workspace `output/` sits inside the graduate's data folder until installations get their own bindings.
- A format 1 graduate's skills and examples still mention the table tools; a call to one gets an error that names the new tool.

## 2026-10-28 (Tue): the adapter runtime and the training worker

**Done** (on a branch, not merged; decision 035)
- GGUF: a header reader and writer and LoRA checks against a base, plus a stand-in adapter labeled as such. Checked on this PC's files without loading a model: the reader parses the 10.7 GB 2-bit Glimmer blob in 70 ms (731 tensors, every size known, the last ending at the file's last byte) and passes the probe adapter llama-server had loaded.
- The local adapter runtime: finds llama-server from Settings or PATH, resolves an Ollama model to its GGUF through either manifest layout, checks adapters before loading, frees the GPU from Ollama, and runs one llama-server on 127.0.0.1 with a per-start key, adapters loaded unapplied, the quiet-mode thread cap, idle stop, crash notice and orphan cleanup. Tested with a stand-in server process.
- A llama.cpp student in `packages/adapters` that sends every adapter's scale per request and counts and drops `reasoning_content` like Ollama's thinking; an engine test runs a turn end to end through the runtime.
- The dataset builder from verified episodes (the contract the lesson builder will use), versioned JSONL with per-message train flags.
- `trainer/`: a pinned QLoRA recipe (PEFT and bitsandbytes, transformers 5.19.0, llama.cpp's converter at b10472) with a stdlib-only dry run and a span self-test; the tests run both when Python is present, on inputs the app wrote.
- The training worker: durable records, never the same job twice, resume after restart, a compute cap per scope, a Hugging Face Jobs backend tested against a fake Hub, and a stand-in backend that never counts as training.
- An independent review (a separate agent, which ran scripts against the code) found eleven real bugs and risks: in the server manager, a restart that could stop a server a caller had just been given, a stale idle timer, a stop that couldn't call off a start, one caller's abort failing a shared start, and one student's stop ending another's request; in the worker, updates from stale records, a job sent twice when the provider couldn't be asked about a lost answer, cost without a ceiling, two jobs sharing one budget, and endless retries of missing outputs; and a line split in `pipeline.py` that broke on U+2028. All are fixed, each with a test.
- Checked by hand: the span logic against Glimmer's own chat template (from the 2-bit build's metadata) on an example from the dataset builder; the targets were exactly the tool call and the reasoned answer.

**Next**
- Wire it into the app: Settings for llama-server's path and a Hugging Face key, `trainer/` as an app resource, the engine host resuming jobs at start, and graduates with an adapter served through the llama.cpp student.
- With the owner's Hugging Face token (write access, on an account with credit): one real job on the returns desk's verified lessons, then load its adapter on the 2-bit build (needs the owner's go-ahead for GPU time).

**Open issues**
- A01 stays blocked on training compute. None of the pins has run a job yet; the recipe checks its inputs before installing, so a wrong pin costs only the setup.
- Checked after the merge against the Hub's Jobs guide: Jobs need only a positive credit balance (no PRO plan, as first written), and the L40S is $1.80 an hour.

## 2026-10-28 (Tue), morning: any model

**Done** (merged into main the same morning)
- Mentors from OpenAI, Anthropic (its own Messages adapter), Google Gemini, OpenRouter, Groq, Together, DeepInfra, Fireworks, any OpenAI-compatible address, and models running here in Ollama or LM Studio. Each is held to the loop's JSON schema the best way its API allows, and reasoning effort goes to each API's own control or is left out.
- Connections: keys stored per provider and sent only to its hosts, an added address's key bound to that exact host, keys checked before they are stored, OpenRouter sign-in by PKCE with a one-shot callback on 127.0.0.1, and Ollama and LM Studio found on this computer. Model lists come from each connection.
- Prices: presets, OpenRouter's listing (enforced with `provider.max_price`), a price the user enters, or free for a local model. A mentor with no known price can't start training (decision 034).
- Settings › Models is one page: the default mentor and agent's model, each from a picker grouped by connection, then the connections. First-run setup offers Muse Spark (default), OpenRouter sign-in, another key, or a model here, and Define uses the same picker.
- GPU: the app reads the card's memory, shows which local models fit, recommends the largest Glimmer build that fits, and installs the 2-bit build as a text-only Ollama model with Glimmer's renderer and parser.
- Live calls with structured output checked on Meta, OpenAI, Anthropic, Gemini, an OpenRouter free model and a local Ollama model, plus one local student chat; results in `docs/MODELS.md`.
- A hidden e2e suite for Settings › Models and the new setup steps; screenshots regenerated.

**Next**
- Click through the OpenRouter sign-in once with a real account.
- Once GPU work is back on: install the GPU-sized build for real and run the sample job on it.

**Open issues**
- Not checked live: LM Studio, Groq, Together, DeepInfra and Fireworks as mentors, OpenRouter's paid models, the real OpenRouter sign-in, and the GPU build's full install.
- The Describe screen shows a cloud icon for the mentor even when it runs on this computer (`flow/describe`, outside this branch).
- The expanded spec keeps week one to one model family and one inference backend; this work started before it and keeps Meta's models as the defaults.

## 2026-10-28 (Tue), the expanded spec arrives

**Done**
- The owner's expanded spec (`docs/SPEC_EXPANSION.md`) now governs scope. `docs/EXPANSION.md` maps it onto the repo and tracks every requirement; decisions 030 to 033 settle the harness, the adapter backend, the teaching job and training compute.
- Feasibility, on this PC: Ollama refuses LoRA adapters; llama.cpp's `llama-server` loads the 2-bit Glimmer GGUF from Ollama's store with a LoRA, applies it per request, and parses Glimmer's tool calls with `--jinja` (two short GPU loads, then unloaded).
- The returns desk calibrated on hosted Glimmer with the table tools: 36 of 45 dev tasks (refunds 15/15, orders 11/15, pickups 10/15).
- A transient model error no longer pauses a run at once (decision 029); calibration retries the same way.
- The table-tool comparison stopped after seed 1 and part of seeds 2 to 5, to keep the OpenRouter credit (about $15) for the new runtime. Its finished attempts are kept.

**In progress (agents in worktrees)**
- Runtime v2, the coding-agent harness (decision 030).
- The llama.cpp adapter backend and the training worker (decisions 031, 033).
- Graduate versions, manifest v2, and `.architect.zip` export and import.
- Model-agnostic providers (started before the spec).

**Next**
- Replay and verified lessons, the intervention menu, Teach this, the evidence screens, the CLI and Hugging Face publishing, then comparisons and the demo on the new runtime.

**Open issues**
- Training compute: the owner has been asked for a Hugging Face token with credit (or Modal); until then A01 is blocked and graduates are harness-only.
- GPU work stays off except brief checks.

## 2026-10-28 (Tue), early morning

**Done**
- A clean pass on Describe, Clarify, Define, Advanced settings, Train and its drawers, Report and the workspace: standing paragraphs, captions and tooltips cut, numbers and short labels kept. A blind reviewer preferred the new screens on all 15 pairs; the facts it found missing came back as labels, not paragraphs.
- Quiet local models (a setting, off by default): a local student uses a quarter of the CPU threads and rests after each reply for three quarters of the reply's time. The run scripts take `--threads` and `--cooldown`, and `run.ts` continues a run where it stopped.
- The release workflow signs and notarizes the macOS app with either Apple credential set (an App Store Connect API key, as Conductor does, or an Apple ID, as Hearth does) and checks the result with codesign, stapler and spctl. Without the secrets it signs ad hoc, as before. Run by hand: both platforms built and passed the packaging specs.
- Hosted credit is back, and seeds 2 to 5 of the comparison are running on it.

**Next**
- Merge the model-agnostic work (any provider by key or sign-in, or a local runtime) when it lands.
- Seeds 2 to 5, then calibrate the second job and decide whether its comparison fits the credit.
- A real Architect run through the app for the screenshots, the shipped graduate and the demo.

**Open issues**
- Notarization waits on the owner adding the Apple secrets to the repository.
- GPU work is off for now at the owner's request: even with rests between replies, each reply drew about 240 W and the fans swung between 31 and 42 percent. Hosted credit covers runs; the local GPU gets brief checks only. A graduate's local test (offline, on the GPU) waits until GPU work is back on.
- The Windows installer is unsigned, so SmartScreen warns on first launch.

## 2026-10-28 (Tue), overnight

**Done**
- Screens: three clarity passes plus a last one on Define, Train and agent settings, each checked by a fresh blind tester who sees only screenshots. Most screens now score 8 or more out of 10; Define sits at 6 and Train at 7, and a last fix adds the total time and cost that every tester asked for on Define. The sample story trains on OpenRouter's hosted copy of Glimmer, which first-run setup now introduces as an optional step, and the report shows what training cost in all.
- Engine: rounds say when they were a whole draft, and a graduate's manifest records which round made its setup, so the app names setups by round instead of by version number; the report card carries what a hosted student cost.
- The second sample job (below) is merged; it hasn't run yet.
- Seed 1's graduate passed its locked test on this computer's 4-bit Glimmer, offline: 60/60.
- The release workflow ran once by hand (no tag, nothing published): the Windows installer (111 MB) and both macOS disk images (247 MB together) built, and each job started its packaged app and passed the packaging specs. Only a launch on a real Mac is still unverified.

**Next**
- Hosted credit from the owner, then: seeds 2 to 5, calibrating and running the second job, and a real Architect run through the app for screenshots, the shipped graduate and the demo.
- An independent review of the draft-first and related engine changes is running.

**Open issues**
- The OpenRouter account's $10 prepaid credit is spent; every hosted step waits on it.

## 2026-10-27 (Mon), a second sample job

**Done**
- `examples/gear-returns` (decision 028): Returns desk at Larchwood Outfitters, a made-up outdoor-gear shop, as of Tuesday, November 24, 2026. 180 tasks: 60 refunds written to returns.csv, 60 order questions, 60 pickups written to pickups.csv. The policy states every rule with an example. In 17 to 22 percent of the rows of each exported table a date, an amount, a SKU, an email or a category code is written another way; the first five rows of every file are plain. 88 tasks turn on such a value. The package README has the details.
- Tests: the reference solutions use only the student's built-in tools and solve every task in at most 12 turns; a second implementation of the policy agrees with every task; the checker passes every ground truth, in node and in the engine's sandbox; no answer is right for more than three tasks of a type; with the runner's split, train attempts read rows written another way in every exported table.

**Next**
- Calibrate the bare student on it (calibration and dev on hosted Glimmer), then run the comparison as decision 028 says.

**Open issues**
- Not run on any model yet. `category_map.csv`, the key to the old codes, is the one table written plainly throughout.

## 2026-10-27 (Mon), installers

**Done**
- `pnpm package` builds the app and then the installer for the platform it runs on. The Windows installer is `apps/desktop/release/Architect-Setup-0.1.0.exe`, 111 MB (106 MiB). Its 93 files, extracted with 7-Zip, match `release/win-unpacked` byte for byte. It was not run, because that would install it on this machine.
- The hidden e2e suite starts a packaged app when `ARCHITECT_E2E_EXECUTABLE` names one. `pnpm e2e:packaged` points it at `release/win-unpacked/Architect.exe` (the `.app` on macOS) and runs the `shell`, `engine`, `agent-host` and `packaging` specs: 20 tests, all passing. They cover the engine and the workspace in their own processes, the sample job imported from `resources/sample-job`, the checker and a mentor-style tool running in the QuickJS sandbox from `app.asar.unpacked`, keys stored encrypted, a graduate on a model that isn't on this computer refused, and the network guard stopping a connection a local model sends the host to. The suite against the built app still passes (38 specs, `packaging` skipped). The unpacked app also starts on its own, hidden, with no Playwright, and works from a path with spaces and non-ASCII letters.
- Nothing in the app had to change for packaging. One thing broke: with a `GH_TOKEN` in the environment, electron-builder looked for a GitHub repository to publish to and ended the build after the installer was made. `publish: null` fixes it.
- `.github/workflows/release.yml`, by hand or on a `v*` tag: builds the Windows installer and the macOS disk images (arm64 and x64), starts the unpacked app and runs the packaging specs, uploads the installers as workflow artifacts and, on a tag, attaches them to that tag's release. `scripts/install-electron.sh` fetches Electron the way GOTCHAS describes.
- README install note, and three new GOTCHAS entries.

**Next**
- Run the release workflow once by hand and read the macOS job, then tag.
- Add signing secrets if the first-launch warnings (SmartScreen on Windows, Gatekeeper on macOS) would put people off.

**Open issues**
- macOS is unverified. The disk images, their ad hoc signature and the macOS smoke test run only in CI.
- The installers are unsigned.
- Each full e2e run rewrites some of the files in `docs/screenshots/` (9 on one run, 11 on the next) since the latest changes on main. They were left as committed.

**Risks**
- The macOS smoke test starts the app, which stores keys in the runner's keychain. If that fails there, the disk images are already uploaded, and only the release step is held back.

## 2026-10-27 (Mon), Phase 0 into Phase 1

**Done**
- Docs: spec, agent rules (`CLAUDE.md`), plan, architecture, decisions 001 to 027, harness format, verified model facts (`MODELS.md`), gotchas. Two second opinions from GPT-6 Astra shaped the sample job (decision 005) and the evaluation protocol (decisions 006, 007, 009).
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
- The first start of seed 1 showed the one-shot baseline losing its only reply to a format slip in its worked examples, so it would have measured a typo. Every author now gets one fix for a reply the runner can't use (decision 023), and the mentor's guide shows the exact example format. That start was discarded and seed 1 restarted. The restart then showed the one-shot harness falling from 38/45 to 15/45 on dev: its pricing tool asked for the table `jobs` (the file is `jobs.csv`, and the guide never said names keep the extension), and its scheduling tool had a typo that no JavaScript engine parses. Tools may now name a file without its extension when that is unambiguous (decision 024), and a change set's tools must load in the sandbox before it is measured, with the one fix if they don't (decision 025). Seed 1 started a third time at commit 49c18ea; an independent review (Fable) of the second measurement and the fix step found four smaller problems, all fixed before it.
- Seed 1, third start: the one-shot draft took dev from 35/45 to 45/45 and passed the locked test 60/60, against 45/60 for the bare student. Architect then started from blank and wrote one change per round, so a loss to that draft would have mixed up "watching" with "writing piece by piece". After a GPT-6 Astra review, a blank start now begins with a whole draft that later rounds refine, and in the comparison each seed's draft is shared: one-shot stops there, Architect and self-reflection refine it (decision 026, reported as a change made after seeing the one-shot score). An imported starting harness now travels with its job.
- Seed 1 results on the locked test (hosted Glimmer, 60 tasks): bare 45/60, one-shot 60/60, Architect 60/60 and self-reflection 59/60. Both refining runs met the bar on their first dev measurement and stopped, so they tested the shared draft. Paired with bare, Architect is up 25 points (95% interval 15 to 37). Seeds 2 to 5 started (decision 027) and stopped when the hosted credit ran out (below).
- Seed 1's Architect graduate, tested again on this computer's 4-bit Glimmer through Ollama with no network: 60/60, median answer 1 min 57 s, slowest 5% 3 min 17 s or more (hosted: 6.9 s and 14.9 s). The model was unloaded afterwards.

**Next**
- Seeds 2 to 5 of the comparison, once the owner adds OpenRouter credit (about $10; seeds 2 to 4 are paused partway and continue where they stopped).
- The second task family (decision 028) is being built on its own branch; it needs hosted credit to calibrate and run (about $25 for three seeds).
- A real Architect run through the app's screens on the sample job: it gives the README's screenshots, the shipped graduate (from the product's own draft-first flow, not the experiment's fork) and the demo recording.
- The last clarity fixes on Define, the agent's General tab and Train are on their own branch.

**Open issues**
- Two commits reached main red today (a filtered local check hid failures); `pnpm check` now gates commits on its exit code.
- `docs/screenshots/` holds e2e screenshots with fixture data; the README must use screenshots of real runs.
- OpenRouter spend is the owner's money. The binding limit is the account's prepaid credit, $10 (the key's $50 cap never mattered): $9.01 was used when hosted calls started failing with HTTP 402 at 23:00 ET, a few minutes into seeds 2 to 5. Those runs are paused in their data folders and continue where they stopped once the owner adds credit; about $15 covers seeds 2 to 5. The local locked test didn't need OpenRouter and finished (60/60).
- Self-hosted Spark Open needs Baseten or Modal credits, and the Baseten id must be confirmed with `GET /v1/models` once a key exists.

**Mentor spend:** about $0.01 of the $150 credit.
