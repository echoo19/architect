# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

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
