# Progress

Dated log, newest first. Each entry: what was done, what's next, open issues, risks. The next session starts here.

## 2026-10-31 (Sat, evening), status (start the next session here)

- *The pitch* (owner): **"The training system for your own AI."** The specialists are examples of what it makes, shown as sets: business (Returns desk, Service desk, a drafted pricing desk), academies (Academy desk, staff-facing, never a student chatbot), science lab (Sweep desk for ML research groups, Assay desk for screening labs). See `docs/PLATFORM.md` "The pitch" and "Demo sets". The academy agent's public name is "Academy desk"; the judging gate disqualifies education chatbots, so it is always described by what it does for staff.
- *Merged into `field/main`* since the afternoon: bringing a model trained elsewhere back (086), organizations added later and qualified on, per-organization check scores, candidates in Models, the job's own organization noun (085), Study reading recordings through Muse Voice Transcribe (087; a live 7.8 s check cost $0.00035), the Academy desk rename (088), the pitch copy (site, README, film opening, the submission draft in `docs/HACKATHON.md`), the Lab walkthrough film's page (`site/film/lab`), the Assay desk (`examples/assay-desk`), the third run's write-up (`docs/comparisons/academy-desk-3.md`), a longer hook timeout for suites that import a whole field job, and a race fixed in `recordings.test.ts`. `pnpm check` passes (3,866 tests); the stand-in e2e gate passed 169/169 before the latest merges.
- *Third run result* (hosted, seed 101): Glimmer alone vs Academy desk: Juniper (never seen, generated) 15/48 vs 31/48 (+33 points, +16 to +48); taught-on academies 15/48 vs 24/48 (+19); Real academy (never seen) 13/30 vs 3/30 (−33, a clear loss). Causes: the harness's routing phrases matched no real request; history tasks ran into the step limit; the Real academy's 10 assign tasks were unpassable by any arm (a task-builder bug, branch `academy/assign-ids`). Spend $7.35 OpenRouter, $0.44 Spark.
- *In flight:* the first live certificate (`architect-runs/cert-1`, the frozen Academy desk v3, calibration on taught-academy tasks its run never touched, checked on the Real academy's first cohort, cap $5; OpenRouter had $12.23); `examples/sweep-desk` merging `field/main` to make one "Try a science lab" choice with the Assay desk; `cohesion/words` and `cohesion/links` (`docs/COHESION.md`); `academy/assign-ids`.
- *Film:* the silent draft of the Lab walkthrough is at `architect-runs/film/launch/renders/lab-walkthrough-draft.mp4` with a contact sheet and `SCRIPT-lab.md`; it waits for the owner's review before any voice. Its opening now uses the pitch.
- *Next:* merge the lanes above; put the third run, the certificate and the local result in the README and the results paper (`site/src/evidence.ts`); the full stand-in e2e gate; a PR to `main`; release 0.7.0 (`pnpm package` first: earlier local build outputs were corrupted by a blanket sed); the owner's film review, then voice and final render; the submission (Nov 4, 9 PM ET).

## 2026-11-01 (Sun), `lab/field-timeline` (from `field/main`): a field's life as one timeline

- *Done:* decision 091. The field page's Overview has a Timeline card under the grid: studied, taught (rounds, kept changes, counterexamples), tested (by kind of organization, an organization added later, a model trained elsewhere), certified (and where it held on never-seen organizations), compared and exported, oldest first, each row linked to the place that holds it, then one next step from what is missing. Only existing reads (`fields/timeline.ts` is pure; `FieldTimeline.tsx` reads); `FieldSummary` now carries the job's runs.
- *Tests:* `test/unit/renderer/field-timeline.test.ts`; hidden e2e `e2e/field-timeline.spec.ts`, screenshot `docs/screenshots/field-timeline-dark.png`. The Fields stand-in answers versions, certifications and trained-elsewhere qualifications.
- *Open:* exports show only in the session that wrote them, bundles and `architect serve` aren't recorded; "Learned from" (089) now merged, but the timeline does not yet show it as a stage. `field-overview-dark.png` recaptured (the timeline starts below the grid). Not merged or pushed.

## 2026-10-31 (Sat, night), "Learn from it" (branch `lab/adopt-org`, from `field/main`)

- *Done:* decision 089. After a final test or a qualification shows a never-seen organization, the Lab offers "Teach on it" (the report's grid and the field's Organizations). It makes the next version of the field as a new job (`Academy desk v2`, migration 22 records what it came from): the organization's files become material, its tasks practice and check tasks (families whole), every other sealed organization is resealed with fresh prints (082's rules), and the earlier field, its runs, cards and certificates stay as they were, read as "measured before it was taught on". "Seal a fresh cohort" on the new version reuses adding an organization later; with no never-seen real organization left, the page says so. Improve teaches on the newest version; a version made this way shows "Before and after" per organization on its report.
- *Tests:* engine `teach-on.test.ts`; renderer unit tests; hidden e2e `learn-from-org.spec.ts` with three screenshots (`learn-from-org-*.png`); `field-add-org-dark.png` retaken (the qualify card now has Teach on it).
- *Merged* into `field/main` on Nov 1. The Real academy has one cohort today, so teaching on it leaves no never-seen real organization until a second export is sealed.

## 2026-11-01 (Sun), `cohesion/links` (from `field/main`): the Lab's places lead to each other

- *Done:* `docs/COHESION.md` "Places that lead to each other", items 1 to 9. Results in the Lab offer Open field and Open in Models, and Close (on Results and Train) goes back to the run's field. `/models/<agent>:<version>` opens Models with that version's panel; the field page's tab is Versions and its rows open there (a version no agent holds opens its results). The model panel has Open chat (the active version) and Open results (a training run's results or an improvement's), and a Qualified section with every certification, every qualification at an organization added later and every model trained elsewhere that took its final test. The Lab has an Experiments card; running experiments sit under Running, waiting ones ("Needs funding", "Waits for you") under Needs you. An experiment's results have Table 4, each arm's run, which opens a drawer with its rounds, check tasks and frozen harness version (the arms' runs live in the experiment's own records, so there is no Results screen to send them to). The export toast links to Compute, whose bundle offers "Use the latest export of…" for this session's exports. Fields and the Lab start a field through one `newField()`. The field page has a back button to Fields. The personal edition shows none of these links.
- *Fixtures:* the Lab's stand-in has two experiments, and Academy desk's report cards carry their own job id (they had the service desk's).
- *Tests:* `e2e/links.spec.ts` (every link, plus the personal edition); `fields.spec.ts` follows the Versions tab. Screenshots `links-*-dark.png`, and the Lab's recaptured.
- *Open:* the words builder (`cohesion/words`) renames vocabulary in some of the same files (FieldsScreen, Candidates, Assets); expect small merge conflicts. Not merged or pushed.

## 2026-11-01 (Sun), `cli/lab-commands` (from `field/main`): fields and experiments from the command line

- *Done:* decision 090. `architect field list | status | add-org` and `architect experiment plan | preregister | start | resume | pause | stop | status | report | list`, over the same engine calls as the Fields and Experiments places; JSON documents parsed with shared schemas (`packages/shared/src/lab-cli.ts`); exit codes as in `docs/CLI.md`; Ctrl+C pauses a running experiment. The field summary functions the Fields place used moved to `packages/shared` so both share them. Tests in `apps/cli/test/lab-field.test.ts` and `lab-experiment.test.ts` run on fakes (no model, no spend), including that nothing of a never-seen organization or the final test prints before the release.
- *Open:* calibration isn't a command (`start` prices and studies); a real run with hosted models (`start` with keys in the environment) is untested here by design. Not merged or pushed.

## 2026-11-01 (Sun), `app/rename-academy-desk` (from `field/main`): the academy agent is Academy desk

- *Done:* decision 088. The owner's name for the academy agent is "Academy desk", a staff-facing operations specialist (diagnoses missed questions, sets practice in the academy's records, flags students for staff), never "Tutor" and never something students chat with. Renamed in the app (sample button, fixtures, e2e specs; `sample-tutor.spec.ts` is now `sample-academy-desk.spec.ts`), the academy example (job name, description, policies, README; the job regenerated, tasks unchanged), README, CLAUDE.md, docs, the comparisons (`academy-desk-1*.md`) and the results paper. The Academy desk screenshots were recaptured and `start-tutor-dark.png` is now `start-academy-desk-dark.png`.
- *Kept on purpose:* "tutoring" for the academy's business, the `tutor_id` column and the staff role "Tutor" (the academy's own tutors), the task type `tutoring_turn` and the tasks' wording (some requests are worded as a student would write them; changing them would change the measured tasks).
- *Open:* the sealed tasks still include student-voiced requests. Whether to reword them is the owner's call, since the published results describe the current tasks. Not merged or pushed.



## 2026-10-31 (Sat), Sweep desk and one science lab offer (branch `examples/sweep-desk`, from `field/main`, with `examples/assay-desk` merged in)

- *Done:* `examples/sweep-desk`, a field for ML research groups: four synthetic groups (Halden, Quill, Marlow taught on; Fennick never seen), each with its own metric names, steps or epochs, configs in `runs.csv` or `configs.json`, messy exports and a policy in table or prose style. Six skills (`best_config`, `early_stop`, `diverged`, `did_it_help`, `next_runs`, `sweep_report`), 48 tasks per group, every end state checked by `checker.js`. A reference solver using only read, run and append passes every task through the engine's tools and checker. Packaging ships `sweep-desk-job` beside `assay-job`.
- *One science lab:* the branch merges `examples/assay-desk` and turns its offer and Sweep desk's into one Lab-only "Try a science lab" button that opens a menu of the two specialists (`ScienceLabButton` in `SampleJobButton.tsx`); `sample-science-lab.spec.ts` replaces the two specs.
- *Next:* review and merge into `field/main` (it brings the Assay desk with it). Not pushed. Neither specialist has been measured with Glimmer alone yet (needs hosted credit).

## 2026-10-30 (Fri, night), the Assay desk, a science lab field (branch `examples/assay-desk`, from `field/main`)

- *Done:* `examples/assay-desk`: a specialist that reads screening labs' plate-reader exports. Four made-up labs (Fenwick, Alder Row, Saltmarsh taught on; Corvid Hill never seen), each with its own instruments (three export formats: `A01`, `A1`, or row and column; thousands separators, scientific notation, `OVRFLW`/`OVER`/`NaN`/blank), 96- and 384-well plates, control placement, well, date and id forms, and a policy.md in one of three styles (controls, percent inhibition, Z′ line, hit rule by percent or SD, replicate rule, borderline band, re-test cap and reason codes). Six skills, 8 per lab (192 tasks): `normalize`, `hits`, `qc`, `replicates`, `retest_plan`, `plate_report`, all checked by `checker.js` (tolerances, sets, any valid re-test plan). Seeded generator, reference solver with built-in tools only (replayed through the engine's tools and checker), hand-computed Z′ and normalization fixtures. The app offers it in the Lab only as "Try a science lab" (`SampleJob` `assay-desk`, resource `assay-job`, e2e `sample-assay.spec.ts`, screenshot `lab-empty-dark.png`).
- *Next:* merge with `examples/sweep-desk`, which adds a "Sweep desk" to the same science lab set: the two offers should become one "Try a science lab" choice (a menu of the two) rather than two buttons. Calibrate on the bare student when hosted credit allows.

## 2026-10-30 (Fri, night, by this computer's clock), study reads recordings (branch `study/recordings`, from `field/main`)

- *Done:* decision 087. "Add recordings" on Define's study section sends a taught organization's WAV files to Muse Voice Transcribe (`muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`) after a dialog shows each file's length and cost, the line that they go to Meta, and the job's new `sharing.recordings` setting. Transcripts land in `orgs/<id>/data/<name>.transcript.txt` with `recordings.json` (source hash, seconds, cost); the study reads and quotes them like any file. $1 cap a batch; sealed organizations refused before any file is read; video asks for a WAV export. Tests: engine `recordings.test.ts` (fake endpoint), e2e `recordings.spec.ts`, screenshot `docs/screenshots/study-recordings-dark.png`.
- *Live check:* a 7.8 s Windows speech clip through Architect's own adapter: 1.8 s, 7 billed seconds, $0.00035 (docs/MODELS.md).
- *Next:* review and merge into `field/main`. Not merged or pushed.

## 2026-11-01 (Sun, early), HANDOFF for the next Claude Code session (start here)

The previous session ended with work in flight. Read CLAUDE.md, then this entry, then the entries below it back to Oct 30, then `docs/FIELD.md`, `docs/PLATFORM.md`, `docs/SCALE.md`, `docs/CERTIFY.md` and `docs/JOB_FORMAT.md`.

**Branches**
- `main` = release 0.6.1 (Lab, two editions, the path to field models, certified answers). The site deploys from `main`.
- `field/main` = the integration branch, green (`pnpm check`, 3,785 tests) and pushed at `7a9f8522`: everything in `main` plus the Academy desk's public name, `architect serve` (080), the runner's pause rule (081), the leak fingerprint fix (082), experiments on library fields (074 amended), several-organization fields (083), post-hoc certification (079), the developer browsers (084) and the unified parts and motion pass. It has not been merged to `main`: open a PR, wait for Linux CI, merge, then release 0.7.0 (steps in the Oct 30 entry; run `pnpm build`, `pnpm package` and the stand-in e2e incl. `engine.spec.ts` and `hub.spec.ts` before tagging).
- Fallback: `base/one-job` / tag `base-one-job` is the pre-pivot product.

**Unfinished lanes (their agents stopped when the session ended; finish or redo them)**
- `lab/orgs-later` (worktree `.claude/worktrees/agent-a5537ddabb2c931ad`): no commits yet, uncommitted edits in progress. Goal, decision 085: add a never-seen organization to an existing field later and qualify a frozen version on it through the retest path (sealed with 082's rules and guard); per-organization check scores while training; candidates in Models; the organization word from the job (`organizationNoun`, default "organization", Academy desk job "academy"). Look at the worktree's diff before continuing; keep it Lab-only and additive.
- `lab/bring-back-model` (worktree `.claude/worktrees/agent-a1092fd0cded7f906`): two commits (a loopback-only student address; qualifying a model trained elsewhere on a finished run's locked test through a local endpoint). Still to do: the Student tab choice and the Compute "Qualify a trained model" card with e2e and a screenshot, `docs/SCALE.md` "Coming back", decision 086. No real model is called in tests.

**The third Academy desk run** (outside the repo, `C:/JakeOS/projects/architect-runs/phil-3/`, code pinned in `architect-runs/runtree` at `13ee093c`)
- Plan in `PLAN.md` (bare vs the taught Academy desk on the second run's unopened tasks; caps $9 OpenRouter, $3 Spark; counterexamples switched off by a run patch, as the second run registered). Every arm froze and the locked tests were released at 01:25 ET on Nov 1. The runner process ended with the session, so the locked tests may be incomplete. Resume with `run.sh` (recorded attempts aren't repeated; check `run.log` and `SPEND.md` first; never tune or rerun anything after a locked result).
- Then write `phil-3/tutor-3.md` (style of `docs/comparisons/academy-desk-1.md`), `MISSES.md` and `FROZEN.md`, copy the write-up into `docs/comparisons/academy-desk-3.md`, and certify the frozen taught Academy desk with decision 079 (`architect certify ... --student <hosted preset>`, k = 5, about $5): rebuild `runtree` at the current tip first, between runs.
- OpenRouter has about $15 left (Nov 1, 02:00 ET). Attempts cost about $0.008 to $0.011 each. Cap at 1.5x to 2x the measured price; the runner now pauses instead of dropping an arm.

**Rules that matter**
- Public name is "Academy desk"; never the private name it had before, in the repo, site, app, demos or film (run folders outside the repo keep their old paths). The real academy is only "Real academy"; its data lives outside the repo (`architect-runs/academy-real*`), never committed.
- No local GPU unless the owner says so for a stated window. Hosted inference only, frugally; check `/credits` first.
- Codex (GPT-6 Sol/Astra) is out of credits until Nov 4, 3:01 AM; use an independent Claude reviewer with an adversarial brief for invariant-touching changes.
- Don't run a blanket `sed` over the repo: limit to `git ls-files` (it corrupted gitignored build outputs once; rebuild and repackage before a release).
- Known flaky: `comparison-protocol.test.ts` "resumes a repeat after a restart" under full-suite load; `editions.spec.ts` beside unit tests. Rerun before treating as real.
- Each lane on its own branch from `field/main`; merge when `pnpm check` passes; resolve DECISIONS/PROGRESS conflicts by keeping both entries in number order.

**Next, in order**
1. Finish the third run and its write-up; certify its Academy desk; put the numbers in the README, the results paper (`site/src/evidence.ts` is the single source) and the Lab's sample.
2. Finish `lab/orgs-later` and `lab/bring-back-model`.
3. Watch the motion pass in a real window once (owner's machine), then the full stand-in e2e suite, PR to `main`, release 0.7.0.
4. Owner: the film (it still shows the one-job story; new narration needs the owner's OK on the picture first), the real academy's drafted policy, whether question text can be exported. Submission closes Nov 4, 9 PM ET (`docs/HACKATHON.md`).

## 2026-10-31 (Sat, evening), organizations added later, per-organization scores, candidates, the organization word (branch `lab/orgs-later`)

**Done** (no model was called, no GPU, no spend; decision 085)
- A never-seen organization can be added to a field after it was made, from a folder checked against the field's files, sealed beside the job's seal (which doesn't change), and each candidate qualified on it from the Organizations tab; its results join the report under "Added later".
- The check score at each organization while a field trains: on the Train screen under the score and in the round drawer's check tasks.
- Models lists the candidates waiting to be accepted, labeled by origin, with Compare with the active version.
- `organizationNoun` in job.json ("academy" for the academy job) replaces the hard-coded "academy" in the workspace and the study.
- Screenshots `field-add-org-dark.png`, `train-per-org-dark.png`, `models-candidates-dark.png`.

**Next**
- Review and merge into `field/main`. Added organizations are not yet staged for comparisons or counted in the field export's manifest.

## 2026-10-31 (Sat, afternoon), status (start the next session here)

- *Merged since midday:* post-hoc certification (079, with its calibration set fingerprinted like the test); the app-wide rename to "Academy desk" (the private name appears nowhere in the repo); the developer browsers (084: a field's practice and check tasks, a run's attempts behind "Show all", a version's files read-only); one set of parts and calm motion across the app (40px pill strips everywhere, one `NavItem` with a sliding selection, page fades of 0.1 s, places rising 8px, flow steps sliding 24px, counting numbers; hidden runs and reduced motion stay instant; timings in `docs/DESIGN.md`). `pnpm check` passes (3,785 tests).
- *In flight:* the third Academy desk run in `architect-runs/runtree` (round 1 kept, 25/72 to 34/72 on check tasks). Then certify its frozen Academy desk with decision 079 (rebuild `runtree` at the current tip first, between runs).
- *Known flaky:* `packages/engine/test/comparison-protocol.test.ts` "resumes a repeat after a restart" failed once under full-suite load and passed alone; `editions.spec.ts` failed once while unit tests ran beside it.
- *Gotcha:* a blanket `sed` across the repo also rewrites gitignored build outputs (`apps/desktop/out`, `apps/desktop/release`), including binaries. Limit replacements to tracked files (`git ls-files`). Run `pnpm build` and `pnpm package` again before a release.
- *Next:* remaining audit gaps (add a sealed organization later and qualify on it; per-organization check scores while training; a model trained elsewhere back as a local OpenAI-compatible student; candidates in Models; the organization word from the job); watch the motion in a real window; the full stand-in e2e suite incl. `engine.spec.ts` and `hub.spec.ts`; PR to `main`; release 0.7.0; the film (owner).

## 2026-10-31 (Sat, afternoon), browsing tasks, attempts and files (branch `lab/browsers`)

**Done** (no model was called, no GPU, no spend; decision 084)
- `jobs.tasks`: a field's practice and check tasks in full, the calibration and test splits by count, any other split refused with `split_sealed`. A Tasks tab on the Field page with type and organization filters and a side panel per task.
- `runs.attempts`: a run's practice and check attempts paged by fifty with round, type, organization and verdict filters. "Show all" on Latest attempts opens them in a sheet; rows open the trace.
- `graduates.harnessFiles` and `runs.harnessFiles`: a version's files, read-only, in a Files tab in the Models panel and under Details in the round drawer, with a Changes and Files toggle.
- Tests: engine `browse-api.test.ts` (leak tests over the client and a raw request), hidden e2e `browse.spec.ts`, screenshots `field-tasks-dark.png`, `attempts-sheet-dark.png`, `harness-files-dark.png`.

**Next**
- Merge into `field/main` after review.

## 2026-10-30 (Fri, night), one visual language and calm motion (branch `design/unified-motion`)

**Done** (no model was called, no GPU, no spend; packages/ui and the shell only)
- One set of parts in `docs/DESIGN.md`: titles, side padding, row heights, strips, controls, icons, hover and selected fills, empty states, toasts, scrollbars, window chrome. Every strip (Segmented, PageTabs, the inspector's tabs) is the same 40px pill; a panel's title is set like a card's; icons are stroke 1.8; scrollbars show under the pointer only.
- Motion with a job to do: a place rises 8px from the side of the sidebar moved toward, a flow or setup step slides 24px from its side while the header stays, a tab's content rises 6px; the old page fades in 100ms so nothing waits. The sidebar's selected fill and the stepper's pill slide (`layoutId`). New springs `settle` (0.28 s) and `leave` (0.1 s); timings measured with a throwaway spring probe are in DESIGN.md. The Lab's running score rolls (NumberTicker). Hidden runs stay instant.
- Shell: sidebar rows are one `NavItem`; the wordmark lines up with the place labels and sits on the title bar's line; flow and setup headers are the title bar's 56px; a place's side panel runs the full height.

**Next**
- Watch the transitions in a real window (hidden runs can't show them) and tune if a place change feels slow.
- `editions.spec.ts` "the personal home opens the chat used last" failed once under load (a home stuck on "Loading agents") and passed 15 times alone; watch for it.

## 2026-10-31 (Sat, midday), status (start the next session here)

- *Merged into `field/main` since the morning entry:* the Academy desk's public name in README, site and docs; `architect serve` (080); the runner's pause instead of a silent drop (081); the leak fingerprint fix with an empty-fingerprint guard (082, reviewed adversarially: no lost detection on the academy job); experiments on library fields with a hypothesis and a primary comparison (074 amended; a one-arm plan needs only a hypothesis); a Lab field made from several organizations' folders, with `docs/JOB_FORMAT.md` (083). `pnpm check` passes (3,751 tests).
- *In flight:* the third Academy desk run in `architect-runs/runtree` (rebuilt at `13ee093c`; mentoring now passes the leak gate); `certify/post-hoc` (079) is merging `field/main` to resolve vault conflicts with 082 and 074; `app/rename-academy-desk` (the app, fixtures, examples and screenshots); `lab/browsers` (tasks, attempts and harness files, 084).
- *Next:* certify the third run's frozen Academy desk (079, about $5) once it finishes; the remaining audit gaps (adding a sealed organization later, per-organization check scores while training, a model trained elsewhere back as a local OpenAI-compatible student, candidates in Models, the organization word from the job); a Hestia-inspired pass on one visual language and smooth motion; the full stand-in e2e suite (include `engine.spec.ts` and `hub.spec.ts`), a PR to `main` and release 0.7.0.
- *Reviews:* Codex is out of credits until Nov 4, 3:01 AM; independent Claude reviewers (adversarial brief, given code, not conclusions) stand in.

## 2026-10-30 (Fri, night), certify an existing version (branch `certify/post-hoc`)

**Done** (no model was called, no GPU, no spend; decision 079)
- A frozen version can be certified after the fact: calibration tasks from a job's taught organizations that its run (and any run it was improved from) never saw or was tested on, by id, family name and request words, sealed in the vault with the check tasks; k attempts with no mentor under its own round of split `certify`; the certificate filed on a record that never changes. Caps on dollars and minutes, resumable like a re-test.
- `architect certify <agent> --version N --job <job>` (docs/CLI.md); a Certify action and dialog on a version's panel in Models (Lab only). Screenshot `certify-version-dark.png`.

**Next**
- Certify Academy desk v2 for real on a newer import of the Academy desk's job (on this computer it costs nothing; the owner decides when the GPU may run it).
- A cap that pauses a certification can't be raised on it; if that bites, let `startCertification` take new caps.

## 2026-10-30 (Fri, evening), experiments from fields in the library (branch `lab/experiments-from-fields`)

**Done** (no model was called, no GPU, no spend; decision 074's amendment)
- An experiment runs on a field in the library (by job id, the default) or on a job folder. For a library job the service stages the folder the runner reads from the stored job and tasks and the vault's sealed part (`Vault.stageSealed`), for as long as one call reads it; the preregistration pins it, and a job saved since is refused.
- Preregistering needs a hypothesis and a primary comparison (arm A minus arm B on the whole test, the organizations taught on, or those never seen); both are hashed with the plan and lead the design, the live page and the results, which say what was measured for it.
- A Field page's New experiment opens the design with that field chosen.

**Next**
- Merge into `field/main` after review. The experiment's copy of a library job is split again with the job's seed, so its test may not be the library's own split; a path that imports a job with its splits as they are would close that.

## 2026-10-31 (Sat), a Lab field from several organizations' folders (branch `lab/own-field`)

**Done** (no model was called, no GPU, no spend)
- `docs/JOB_FORMAT.md`: the job folder format with a worked example, linked from the README and from a failed import.
- Architect Lab: "Several organizations" on Describe and New field on Fields. Describe the job once, add each organization's folder, name it, Taught on or Never seen. The teacher drafts the specification once from the taught organizations' files; Architect makes each organization's tasks with the existing template step, writes a job folder and imports it, which seals the never-seen ones (decision 083). The personal edition is unchanged.
- Tests: engine `drafting-field.test.ts` (scripted teacher, leak test), hidden e2e `new-field.spec.ts`, screenshot `new-field-orgs-dark.png`.

**Next**
- A field with a policy rule, or with end-state tasks, still needs a hand-written folder.

## 2026-10-31 (Sat, morning), in flight: the third Academy desk run, post-hoc certification, serve, runner fix, the Academy desk rename, a platform audit (start the next session here)

**Rules learned today**
- *Public name.* The academy agent is called "Academy desk" in anything public (README, site, docs, demos, film, the app's sample), and in this repo. It is a staff-facing operations specialist for test-prep academies: it diagnoses missed questions, sets practice in the academy's records and flags students for staff. It is not described as something students chat with. Run folders outside the repo may keep their old names. Do not rewrite git history.
- *Runs use a pinned checkout*, `C:/JakeOS/projects/architect-runs/runtree` (detached at `9e35977d`, installed and built), so development can keep merging in the main checkout. Rebuild it at a new commit only between runs.
- *Price margin.* Projections priced at the calibration estimate ran short twice; attempts cost about $0.0106 each (hosted Glimmer, Academy desk job). Cap at least 2x the measured price.

**In flight** (each on its own branch, merge into `field/main` when green, then a PR to `main`)
- The third Academy desk run (agent, outside the repo in the architect-runs folder): a new preregistered comparison, bare vs the taught Academy desk, on the second run's unopened tasks (Copperfield, Thistlewood, Bramble Hill taught; Juniper and the Real academy's second cohort never seen), caps $9 OpenRouter and $3 Spark. The second run halted: the runner dropped its primary arm when attempts cost more than planned and released the other arms' tests (2 attempts each recorded, unopened); disclosed in the third run's plan. Spend so far today: OpenRouter about $0.95.
- `certify/post-hoc` (decision 079): certify an existing version after the fact on tasks its own run never touched; the Certify action in Models. Used next for the Academy desk's first live certificate (about $5).
- `cli/serve` (decision 080): `architect serve` exposes a graduate on loopback as an OpenAI-compatible endpoint with a bearer token, so another app on the same computer (for example a school's platform) can use it.
- `runner/no-silent-drop` (decision 081): a comparison pauses instead of dropping an arm it can't fund, before any release.
- `docs/rename-tutor`: the Academy desk's public name in README, site and docs (comparisons renamed `academy-desk-1*.md`). The app's sample, fixtures, examples and screenshots get the same rename after the code lanes above merge.
- A read-only audit of Architect Lab as a development platform (a founder using it on their own field); its gaps become the next lanes, then a Hestia-inspired pass on one visual language and smooth motion that keeps the simple flow.
- *The third Academy desk run is on hold before spending anything:* its agent found that the vault's leak fingerprint keeps text the taught academies' own files show (bank questions that test tasks quote), so every mentor call on the academy job is refused. The second run's "draft" arm was therefore the blank setup plus the study's procedure. Branch `vault/fingerprint-data` fixes it (decision 082, Sol review before merge); then rebuild `architect-runs/runtree` and run the plan in the third run's PLAN.md in the architect-runs folder ($9 OpenRouter at 1.5x headroom, safe with decision 081's pause rule), then certify its frozen Academy desk with decision 079 (about $5).
- *The platform audit's gaps, in order:* (1) make a field from several organizations' folders in the app (`lab/own-field`, decision 083, plus `docs/JOB_FORMAT.md`); (2) experiments on library fields and a hypothesis in the preregistration (`lab/experiments-from-fields`); then a task and split browser on the Field page (train and dev only), an attempts browser behind "Show all", a read-only harness viewer in Models and the round drawer, adding a sealed organization later and qualifying on it, per-organization check scores while training, bringing a model trained elsewhere back as a local OpenAI-compatible student, candidates in Models, and the organization word taken from the job instead of "academy". Keep all of it Lab-only and additive; the personal edition's specs are the guard.

## 2026-10-31 (Sat), `architect serve` (branch `cli/serve`)

**Done** (no model was called, no GPU, no spend)
- `architect serve <agent> [--port N] [--version N] [--token-file F]`: an installed agent as an OpenAI-compatible Chat Completions endpoint (`POST /v1/chat/completions`, non-streaming; `GET /v1/models`) on 127.0.0.1 only, behind a bearer token printed once. Each request runs through the same agent host as `run` and the workspace, under the same network guard; a certified version answers with the agreed answer or hands off, and the response's `architect` object says which. It never writes: a change comes back as `proposedChange`. Ctrl+C exits 130. Decision 080, `docs/CLI.md`.

**Next**
- Streaming, if a client needs it.

## 2026-10-30 (Fri, night), a comparison pauses instead of dropping an arm (branch `runner/no-silent-drop`)

**Done** (no model was called, no GPU, no spend)
- The runner no longer drops an arm for money. When an arm can't be paid for at the measured price, before it starts or before its locked test is released, the comparison stops as `needs_funding`, with the arm, what it needs, what is left and the cap, and releases nothing (decision 081). This is what lost the targeted arm in the second run's second halt.
- The person answers with `--raise-student-usd` or `--drop-arms` (in the app: `resume` with `studentCapUsd` or `dropArms`), only before the release. A raise is recorded as an amendment with both caps and the price; a drop is recorded as the person's decision.
- The Experiments screen shows the sentence with Raise the cap and Drop the arm, each behind the existing confirm dialog.

**Next**
- A hidden e2e for the funding card on the experiments stand-in.

## 2026-10-31 (Sat), Sol's review of the centerpiece (branch `certify/sol-fixes`)

**Done** (no model was called, no GPU, no spend)
- Chat agreement: replies with no ANSWER line and no change were all keyed alike, so five different replies in words agreed 5/5. They now vote on their normalized words; the certificate's assumption says the bound doesn't cover them (decision 077).
- Comparison funding: the release reserve and the per-round cap check now count every certified test and calibration attempt (k seeds), not only the first seed's test.
- Counterexamples: a reduced case passes only on a clean run (no error, no value contradicting the recorded expected one), so a crash repaired into another crash fails (decision 078).

## 2026-10-31 (Sat, early), Architect Lab, two editions, and the technical centerpiece (start the next session here)

**Where things stand**
- *Released.* PR #2 merged everything below into `main`; release 0.6.1 is out with all three installers (0.6.0's installers did not build: a packaging spec compared a picked folder with its unresolved path; its notes say it was superseded). `field/main` is level with `main` and stays the integration branch. The one-job product is kept at `base/one-job` / `base-one-job`. The one-job product is kept at `base/one-job` / `base-one-job`.
- *Two editions of one app* (decision 076): Architect (the pre-pivot one-job product, chosen by default on existing installs) and Architect Lab (the R&D platform), chosen on the welcome screen and switchable in Settings.
- *Architect Lab* (`docs/PLATFORM.md`, decisions 073 to 075): the Lab home (Needs you, Running, Recently finished, Spend), Fields (skills, organizations, candidates, assets and export), Experiments (design, preregister, run and read comparisons in the app through the same runner, decision 074), Models (registry, panel, compare with harness diffs), Compute (targets, training plans with every memory term, experimental Slurm and Kubernetes bundles), and an inspector on Define. A blind read of every screen led to a polish pass (one word per idea, numbers that agree, answers before arithmetic).
- *From a specialist to a field model* (`docs/SCALE.md`, decisions 071, 072): field export (train-only verified demonstrations, a JSONL outcome scorer with a Python client, a sealed-evaluation manifest), training plans sized from a model's `config.json` with every expert resident and FSDP's peak, and bundles that are written and never submitted. Wording: GPU execution, large-model compatibility and training gains remain unverified.
- *The technical centerpiece* (`docs/CERTIFY.md`, decisions 077, 078): certified answers (a sealed calibration split, k-attempt agreement, an exact Clopper-Pearson bound with a fixed-sequence threshold; the graduate answers or hands off; the certificate is checked on never-seen organizations) and counterexample-guided repair (a failing helper is shrunk by delta debugging to a minimal case, e.g. 2,312 rows to 4, Spark repairs against it, and it stays as a regression test). Both built and tested; no live certificate has been measured yet (it needs k = 5 attempts per task).
- *Measured on the owner's GPU* (with permission, Oct 30 night): the frozen Academy desk from academy-desk-1 on the local 2-bit Glimmer passed 103/120 against 99/120 hosted, no difference shown, about 4x slower (`docs/comparisons/academy-desk-1-local.md`).
- Sol reviewed every lane; each finding was fixed before merging.

**Next**
- Gate lesson: run `engine.spec.ts` and `hub.spec.ts` (fake models, no GPU) before a release; the packaged specs run in the release workflow on short and linked temp paths.
- Owner: raise the OpenRouter workspace budget (Academy desk 2, and a live certificate for Academy desk at about $5); confirm the real academy's drafted policy; new film narration for the Lab.

## 2026-10-30 (Fri, night), academy job made certifiable (branch `academy/more-tasks`)

**Done** (no model, no GPU, no spend)
- The academy generator writes 14 tasks of each skill at each train academy (84) and 8 at the transfer academy (48): 300 tasks. The committed job splits the 252 taught tasks into 12 calibration, 84 train, 48 dev, 48 test and 60 sealed for the certificate (`evaluation.certify`: k 5, epsilon 0.10, delta 0.05, calibration 60). A test splits the committed job with the engine's splitter and checks the sizes and that families stay whole.
- The academies' files and `record-tasks` are unchanged; the reference solver passes all 300 tasks through the engine's tools and checker.

## 2026-10-30 (Fri, night), certify lane "Certified answers" (branch `certify/answers`)

**Done** (no model was called, no GPU, no spend; decision 077)
- `certify/stats.ts`: exact one-sided Clopper-Pearson bound, fixed-sequence threshold choice, the risk-coverage curve, the tasks needed; tested on closed forms and the binomial identity.
- A sealed calibration split (`certify`) drawn from the taught organizations, opened only on the release proof; k-attempt agreement on calibration and locked-test tasks with hashed answer keys; the certificate on the report card with Held / Not held per never-seen organization.
- The graduate answers by agreement or hands the request to a person, attempts as steps, only the chosen writes proposed.
- Report section with `RiskCoveragePlot`, Models column, Lab figure, new-chat sentence, inspector settings with the cost. Hidden e2e `certify.spec.ts`; screenshots `report-certificate-dark.png`, `chat-handoff-dark.png`.

**Next**
- The academy sample has no spare tasks for a calibration split: generate more per academy before certifying Academy desk in a real run.

## 2026-10-30 (Fri, night), certify lane "Counterexamples" (branch `certify/counterexamples`)

**Done** (no model was called, no GPU, no spend; the loop runs on the scripted mentor)
- `docs/CERTIFY.md` section 2, decision 078. A helper call that failed in a failed train attempt is replayed faithfully (`replayToCall`, sharing the checkpoint's replay), run again in the sandbox, judged by an explicit predicate (`threw`, or `contradicts` a value the checker's expected values hold) and reduced by delta debugging over its tables, rows then columns, keeping the rows the call points at and every row they reference by id. On the academy's Copperfield data the "Full"-layout lookup goes from 2,312 rows to 4, 1-minimal.
- `CounterexampleSchema` in shared; `counterexamples` table (migration 17); `mentoring.counterexamples` and `mentoring.fieldCounterexamples` over IPC.
- The mentor's request holds the round's reduced cases. A change that writes a helper must pass all of that helper's counterexamples in the sandbox (reduced cases, and this round's original attempt), or it is refused with the reason for the one fix; then keep or revert on dev as before.
- The round drawer shows the reduction, the failure in words, the call, the tables and the repair; Fields → Assets lists the field's counterexamples. Hidden e2e `counterexamples.spec.ts`, screenshot `counterexample-dark.png`; `field-assets-dark.png` recaptured. `fields.spec.ts` now sets the Lab edition (it failed on the personal default before this branch).

**Next**
- Merge with `certify/answers`: both may add migration 17; renumber whichever lands second.
- A real run on the academy to see how often helpers fail on train and whether repairs against the cases carry to dev.

**Open**
- The anchors (rows the call points at) are a heuristic of the call's values; a call whose values don't appear in the data keeps none, and a crash can reduce to almost nothing. The original case is the stronger check (every expected field), available only in the round that found it.

## 2026-10-30 (Fri, night), platform lane "Editions" (branch `platform/editions`)

**Done** (no model was called, no GPU, no spend)
- `edition: 'personal' | 'lab'` in settings; an older file reads as personal (decision 076).
- Welcome starts with the choice (Architect or Architect Lab), saved as it is made; Settings, General, switches it at once.
- Personal: the chat-first home of `base-one-job` again, the agents-only sidebar, no places in the palette, no Academy desk on Describe, Lab routes go home. Lab: as before. The sidebar wordmark and the window title name the edition.
- Pre-pivot e2e specs run in the personal edition and expect its home; Lab specs set `edition: 'lab'`. New `editions.spec.ts`, unit tests for the setting and the redirects. Screenshots `welcome-editions-dark.png`, `settings-edition-dark.png`, `home-personal-dark.png`.

**Next**
- The site's download page offers both editions. The Fields lane's merge keeps `/fields` behind `isLabOnly` (it already is).

## 2026-10-30 (Fri, late night), Lab screens polish after a blind read (branch `platform/polish`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- One term per concept across Lab, Fields, Models, Experiments and the Define inspector: "Taught on" and "Never seen" (sealed only in the one line that explains it), Spark and Glimmer in place of Teacher and Student. The empty Lab says in one line what a field is and who Spark and Glimmer are.
- Lab: Needs you groups its rows by kind; the two columns stack at their own heights, so Running no longer leaves an empty card. A new version is shown beside the active one with both check-task scores ("Version 3: 88% on check tasks, active version 2: 94%"). The Lab's stand-in agents are the ones Models lists (version 2 active for the service desk and Academy desk, Academy desk Mini too).
- Define: a time limit that stops training before its last round is said in Budget and beside Start training, with the fix ("The 20-hour limit fits 2 to 4 of 12 rounds", Allow 88 hours); retraining Glimmer with a $0 compute cap is said in Budget only, since every job allows retraining by default and the engine simply skips it. The time meter measures training with every round, so a binding limit reads past its cap. The online price was one source all along; the e2e no longer changes the rounds between captures.
- Experiments: no spend before a run starts ("Up to $6.00"); compute with a $0 cap reads "Not used"; arms that never call a model show nothing for it; "Done teaching" in place of Frozen; a simulation is marked as one, in the badge and the summary; arms are explained once and each tile has a one-line description; Funded is gone.
- Compute: the plan leads with its answer ("Fits on 16 GPUs in 2 nodes, 52.1 GB each of 72.0 GB usable"), the hardware it was sized for with Change hardware, and the arithmetic under "How this is worked out". Slurm and Kubernetes read "Bundle only" beside Hugging Face Jobs' "Ready"; the bundle says the SCALE.md wording once, short; paths show as their last two folders.
- Models: harness and adapter hashes on hover; Check tasks explained on hover; deltas with units. Units agree with their numbers in the inspector. Screenshots recaptured, plus `compute-plan-terms-dark.png`.

## 2026-10-30 (Fri, night), platform lane "Compute" (branch `platform/compute`)

**Done** (no model was called, no GPU, no cluster, no spend; the Hub in tests is the fake one)
- `/compute` shows the targets as cards: this computer (its GPU, Ollama and llama-server as the app already finds them), Hugging Face Jobs (Ready with a token, else Add token), Slurm and Kubernetes (Experimental, with the command each bundle is submitted with).
- A training plan reads a model's `config.json` from the Hub at a revision (resolved to its commit) or from a chosen file, and sizes it for LoRA, QLoRA or a full fine-tune; GPU type, GPUs per node and precision, tokens per sequence, micro-batch and LoRA rank sit in the inspector. The focal card is the memory on each GPU: GPUs, nodes and memory per GPU, then every term with its arithmetic, sharded or on each GPU, the usable memory and the fit's arithmetic, labeled an estimate, with the assumptions folded. A config the sizing refuses says why in its own words.
- A bundle for Slurm or Kubernetes is written from a chosen field export into a new folder inside the one chosen (`<model>-<target>`, then `-2`), and shows the `cd` and submit command with a copy button and the SCALE.md wording. A model read from a file can be planned, not bundled.
- Engine host routes `compute.readConfig`, `compute.plan`, `compute.bundle` over the same functions as `architect train` (`training-plan/requests.ts`); schemas in `packages/shared/src/training-plan.ts`; main checks every path was chosen in a dialog. `GPU_TYPES` moved to the shared contracts.
- Engine `training-requests.test.ts`; hidden e2e `compute.spec.ts` on the real engine against the fake Hub (only `config.json` is fetched, no job, no upload); screenshots `compute-dark.png`, `compute-plan-dark.png`, `compute-bundle-dark.png`, and `places-compute-dark.png` again.

**Open**
- Field exports aren't listed: the person chooses the folder that `architect field export` (or the Fields lane's export) wrote. A GPU not in the list can't be named by its memory from the screen yet, as `--gpu-memory` can.

## 2026-10-30 (Fri, night), platform lane "Inspector on Define" (branch `platform/inspector`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- Define's Advanced settings dialog is gone; its fields live in the inspector at the page's right, opened by the footer's settings button (which also folds it away) and remembering its tab. Tabs: Spark (the teacher's models as tiles from `models.ts`, any other model a click away, how hard it thinks, the spending cap), Glimmer (the model here, where it practices, the online copy, context), Teaching (what Spark may change as ToggleRows, rounds, patience, the keep rule: gain on check tasks, the most a skill may lose, measured again on new seeds; the starting instructions), Evaluation (ready when, where the final test runs and its seeds, the task sets and their seed, the organizations with the sealed ones only counted, grading, the example tasks), Budget (expected against each cap with meters, then the caps: Spark dollars, training compute dollars, time).
- Every control writes an existing field of the job schema through the same `jobs.save` path; problems are said under the field and nothing is saved until they are fixed; each saved change raises one Undo toast (`toast({ key })` replaces the last). There is no control for the sealed organizations, the checker's contents, permissions beyond what Define already had, or the student's weights.
- The page lost its Spark cap slider (now in Spark and Budget) and the export button became an icon in the footer, so the page is the job, where it trains and the estimate.
- No temperature control: the job schema has no decoding field, and no student dollar cap: the online copy's expected bill is shown alone.
- `packages/ui`: the Inspector takes a tab from the screen and an `open` state that slides it shut; it is 400 wide everywhere, so up to five tabs show their names (the icon-only fallback from the experiments lane is gone), and Models' `header` stays. ChoiceTiles wrap a long name to two lines. Hidden e2e `define-inspector.spec.ts`; Define's existing specs follow the inspector. Screenshots `define-inspector-{teacher,student,teaching,evaluation,budget}-dark.png`.

**Next**
- The experiments design screen and the model page can reuse the tab components where their settings are the job's.

## 2026-10-30 (Fri, night), platform lane "Fields" (branch `platform/fields`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- Engine: `jobs.field`, `jobs.fieldAssets` and `jobs.exportField` (decision 075). A field's train organizations with their files and rows; sealed ones by name, kind and file count only; the field export's manifest built in memory with nothing written; the export written to a picked, empty folder.
- `/fields` lists every job as a field (one-organization jobs too): taught on, sealed, real organizations, the best candidate's seen, unseen and real scores, last activity. New field opens Describe.
- `/fields/:jobId` has Overview (the best candidate's skill by organization grid, skills, the study brief with Open), Organizations (each one's files beside the list), Candidates (every tested run, the best marked, Open Models) and Assets (counts, what is left out, decision 071's wording, Export).
- `packages/ui`: PageTabs, and CardRow's `selected`.
- Engine `field-view.test.ts`; hidden e2e `fields.spec.ts`; `lab.spec.ts` follows the new Fields screens. Screenshots `fields-dark.png`, `field-overview-dark.png`, `field-orgs-dark.png`, `field-assets-dark.png`; `places-field(s)-dark.png` removed.

**Open**
- Adding an organization (a generated academy from a seed, or a folder of your own as sealed) is not offered: it needs resealing the vault and building tasks for a new organization, which the engine doesn't do. Left out on purpose.
- The list reads every finished run's card of every job on open; fine for tens of runs, slow for hundreds.

## 2026-10-30 (Fri, night), platform lane "Experiments screens" (branch `platform/experiments`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- `/experiments` lists every experiment in a sortable table: status, field, arms, Spark and student spent of their caps (absent before anything ran), created. One primary action, New experiment.
- `/experiments/new` and a draft at `/experiments/:id` are one design page: the field's folder (planning spends nothing), the arms as tiles (the weights arms held, with the reason), seeds and rounds, and the estimate with each total against its cap, each arm's estimate and whether it is funded, labeled assumed or measured prices, and what calibration costs before it runs. The inspector holds what the engine takes: Spark's and the student's cap per arm, rounds and the teaching seed, the final-test seeds, and the total caps. Preregister confirms what freezes; Start confirms what it may spend and goes through Spark's brief when the runner waits for it.
- A preregistered experiment shows its spend against the caps, each arm's status, rounds and spend, and pause, resume and stop. Before the release it says nothing about the final test or the organizations kept back. After it, the results read like a short paper: a summary, Figure 1 (each arm on each group: taught on, each never seen, real), Table 1 (pairs with Newcombe intervals and the gain rule's verdict), Table 2 (skill by organization per arm), Table 3 (spend and latency), the report's notes; a switch picks where the student ran.
- `packages/ui` Inspector: with more than three tabs, the ones not open showed their icon alone (replaced since by a 400-wide inspector with every name, see the inspector lane above).
- Hidden e2e `experiments-screens.spec.ts`; screenshots `experiments-list-dark.png`, `experiment-new-dark.png`, `experiment-new-estimate-dark.png`, `experiment-running-dark.png`, `experiment-results-dark.png`, `experiment-results-tables-dark.png`.

**Open**
- Self-reflection isn't an arm the runner takes, so it isn't offered. The report has no paired difference per organization, so Table 1 pairs over the whole final test.
- The e2e splits the recorded comparison's counts over four made-up organizations to show the groups; a recorded field comparison would be a better stand-in.

## 2026-10-30 (Fri), platform lane "Models" (branch `platform/models`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- `/models` is a registry of every agent and version: agent and field, base model with its quantization and runtime, method (harness or adapter, with the adapter's hash), harness hash, the final test seen, unseen and real under one "Final test" heading, the check tasks apart, status (Active, Candidate, Imported, Experimental, Kept, Set aside) and created. Filters All, Active, Candidates, Imported; search; every column sorts, unmeasured last.
- A row opens the model's panel (the Inspector, with a header): Report (final test figures, check tasks, model, harness, adapter, how it was tested) and Lineage (the version it was made from, what changed in the harness, its kept changes, its history). Promote and roll back go through the existing confirmation (`MoveDialog`); Export opens the agent's Export tab.
- Compare: two versions of one agent, or two agents of one job, skill by organization in percentage points wherever both took the same tasks (otherwise it says they weren't measured on the same tasks), each version's facts and check tasks, and the harness diff. New engine call `graduates.harnessDiff(from, to)` reads each version's harness from its folder, held to its manifest's hash.
- `packages/ui`: DataTable column groups, a selected row and slightly tighter cells; Inspector `header`. `FilePatch` moved to `components/` for reuse.
- Tests: engine host test of the diff, unit tests of the registry logic, hidden e2e `models.spec.ts` against `fixtures-models.ts`. Screenshots `models-dark.png`, `model-panel-dark.png`, `models-compare-dark.png`.

**Next**
- A blind read of the three screens. Export from the panel exports the active version only, as the Export tab does.

## 2026-10-30 (Fri), scale lane "Training plan and targets" (branch `scale/targets`)

**Done** (no model, GPU, cluster or cloud spend; schedulers are stand-ins)
- `architect train plan` sizes a training job from a model's `config.json` (read from the Hub at a commit, or a file): every memory term with its arithmetic, every expert resident, FSDP's peak, activations, headroom, and the fewest GPUs and nodes; labeled an estimate. `architect train bundle --target slurm|kubernetes` writes a launch folder with the experimental `trainer/experimental/train_fsdp.py`, its FSDP config, the field export's `sft/` data, and the command to submit it with the user's own tools. Decision 072; `docs/CLI.md`.

**Next**
- The Scale page (`scale/ui`) on top of `@architect/engine/training-plan`. A real export from `scale/export` should be tried against `--export` once that lane lands (the bundle reads only `MANIFEST.json` and `sft/*.jsonl`).

## 2026-10-30 (Fri, night), platform lane "Experiments engine" (branch `platform/experiments-api`)

**Where things stand**
- The app can plan, calibrate, preregister, start, pause, resume, stop, list and read experiments through the engine host (`experiments.*`, decision 074). Each one runs the existing comparisons runner on a folder of its own under `<data>/experiments/<id>/`, so its caps, study step and release barrier are the runner's. The runner gained only an abort signal and a live view of its records.
- Results come from the runner's report; before the release `get` shows no locked result and no sentence naming a sealed organization. Events reach the renderer as `experiments:onEvent`.
- The stand-in for screens is `apps/desktop/e2e/fixtures-experiments.ts` (`installExperimentsFake`, `finishExperiments`). Engine `experiments.test.ts` and hidden e2e `experiments.spec.ts` pass on fakes; no model was called and nothing was spent.

**Next**
- The experiments screens lane builds list, design, live status and results against the stand-in, and a renderer client for the new channels.
- Not offered from the app yet: the regression job, local re-tests, a per-arm wall cap. A pause during calibration waits for it to finish.

## 2026-10-30 (Fri, night), platform lane "Foundation": the places and the Lab (branch `platform/foundation`)

**Done** (stand-in engine only: no model was called, no GPU, no spend)
- *Places* (decision 073): the sidebar leads with Lab, Fields, Experiments, Models and Compute, icon-led, above the agents; the command palette lists them. New routes `/fields`, `/fields/:jobId`, `/experiments`, `/experiments/new`, `/experiments/:id`, `/models`, `/compute`, each a real page with one way on, for the other lanes to fill. The guided flow and its stepper are unchanged.
- *The Lab* at `/` replaces the home that jumped to the last chat: Needs you and Running side by side as the focal point, then Recently finished (seen, unseen and real where the report has organizations), Spend (Spark against each run's cap, the student where recorded), Fields and Agents, all from records the engine already keeps. A fresh install sees one empty state with Describe a field, Try the Academy desk and Try the sample job.
- *`packages/ui`*: Card, CardGrid, CardRow, ChoiceTiles, ToggleRow, CapMeter (and a Meter that turns red past its cap), Inspector, IntervalPlot and DataTable, with tests; `docs/DESIGN.md` describes them and the inspector pattern.
- *Tests*: hidden e2e `lab.spec.ts`; specs that expected "No agents yet" or the jump to the last chat now expect the Lab. Screenshots `lab-dark.png`, `lab-lower-dark.png`, `lab-empty-dark.png`, `places-*.png`.

**Next**
- The other platform lanes fill Experiments, Models, Fields, Compute and the inspector on Define from these parts.
- A study brief waiting to be confirmed isn't in Needs you: the only read of it may start a study. A read-only state call in the engine would let the Lab list it.

## 2026-10-30 (Fri, evening), field specialists on main, Academy desk 2 waiting on budget (start the next session here)

**Where things stand**
- *On main.* PR #1 merged `field/main` into `main` (`87bd090a`) after Linux CI passed; the site redeployed with the new claim ("Turn your organization's files into a specialist that runs on your computer.") and the results paper leads with the first field run. The one-job product stays at `base/one-job` / `base-one-job`. `field/main` is level with `main` and stays the integration branch.
- *Since the entry below:* the run's workarounds were made proper (`field/run-fixes`: Meta replies unstreamed so usage is always known, with a conservative charge if a provider still omits it; the comparisons runner prices and runs transfer tasks, carries sealed organizations into each arm, and studies once per comparison with `--confirm-study`; record-tasks takes `--per-skill` and blank modules), the generated academies were made realistically messy (each academy its own date, test layout, grid-in forms, label quirks and policy style; four fresh academies: Copperfield, Thistlewood, Bramble Hill, and Juniper never seen), a fresh real cohort was pulled (`architect-runs/academy-real-2`: 40 attempts, Sep 19 to Oct 2, no overlap with the first), the write-up and the misses are in `docs/comparisons/academy-desk-1*.md`, and the README, results paper and home claim were rewritten. 76 hidden stand-in e2e specs pass; the guide PDF is rebuilt from the recaptured screens.
- *Academy desk 2 is blocked on money.* The second field run's folder is prepared and preregistered (126 locked tasks: 48 seen, 48 Juniper, 30 Real academy; study confirmed, token in its PLAN.md), but the OpenRouter key's workspace budget ($25, separate from the key's $50 cap and the account's credit) is used up, so student calls get 403. $0.57 was spent before the stop; no arm froze and no locked test opened, so it resumes with the command in PLAN.md's second amendment.

**Next**
- Owner: raise the OpenRouter workspace budget (about $10 more covers Academy desk 2), confirm or correct the real academy's drafted policy, and say whether question text can be exported. New film narration needs the owner too: the film still shows the returns desk.
- After Academy desk 2: its write-up into `docs/comparisons/academy-desk-2.md` and the README's marked spot and the results paper; ship its frozen Academy desk as a ready-made agent so Academy desk can be tried without training; then a release.

## 2026-10-30 (Fri), field specialists: Academy desk, the academy agent, built and measured

**Where things stand**
- *Direction.* The owner asked for a more ambitious Architect ("not a little party trick that produces a small agent"), based on `docs/SPEC_FIELD_SPECIALIZATION.md`, useful in the real world, with a real business anonymized, and with the base kept as a fallback. The one-job product is frozen at branch `base/one-job` and tag `base-one-job` (`0b592784`, what `main` was). The plan and contract are `docs/FIELD.md`, amended after a GPT-6 Astra reading. Work goes to `field/main`; `main` is unchanged since `0b592784`.
- *Built and merged into `field/main`* (each lane reviewed; GPT-6 Sol found 4 + 4 issues, all fixed): organizations in a job, with transfer academies sealed as snapshots in the vault and every attempt bound to its academy's files (decision 068); Study, Spark's cited brief of the train academies, confirmed before teaching (069); the report's skill-by-organization grid and the organization choice in the workspace, including "Another academy…" for a folder of your own, checked against the schema and labeled not tested there (070); `examples/academy`, four generated academies with six tutoring skills, a deterministic checker and a reference solver; Academy desk as a ready-made job in the app. `pnpm check` exits 0 (3,510 tests), the build passes, and the hidden field, study and sample e2e pass.
- *The real academy.* An anonymized snapshot of a real test-prep academy that uses the owner's Lectern platform, pulled read-only through its connector: 16 students, 1,990 graded answers, 38 of its own topics, 11 lessons, no question text. Names, emails, ids and notes were replaced or dropped, and lesson passcodes removed. It lives only in `C:/JakeOS/projects/architect-runs/academy-real/` and is called "Real academy" everywhere in the repo. Its policy was drafted for the test and waits for the academy's confirmation.
- *The first field result* (the first field run's folder, preregistered, hosted Glimmer, seed 101, every arm frozen before any locked test opened). On the academies it trained with: bare 21/48, one-shot draft 22/48, Academy desk 44/48. On the generated academy it never saw: bare 24/48, draft 22/48, Academy desk 43/48 (20 wins, 1 loss, +39.6 points, interval +22.9 to +53.7). On the real academy: bare 9/24, draft 11/24, Academy desk 12/24 (9 wins, 6 losses, no clear gain): assign 7/8, but history 3/8 and diagnose 2/8. Spend: OpenRouter $4.26, Spark about $0.58.

**Next**
- Merge `field/run-fixes` (the run's three workarounds made proper: Meta replies without usage, the comparisons runner for organization jobs, record-tasks), and commit the write-up as `docs/comparisons/academy-desk-1.md` with `FAILURES.md`'s diagnosis of the real academy's misses.
- Academy desk 2: widen the field so a helper can't fit one policy format, then measure on a fresh real cohort (older attempts not in the first snapshot) and a fresh generated academy.
- Positioning (README, the results paper, the site's claim) once academy-desk-2 is in; the film needs the owner for new narration.
- Owner: confirm or correct the real academy's drafted policy; say whether question text can be exported.

## 2026-10-30 (Fri), field lane "Academy realism": generated academies that differ the way real exports do (branch `field/academy-realism`)

**Done** (no model was called, no GPU, no spend)
- Each generated academy now differs in the ways the first run's helper broke on the real academy: its own date, stated in every request (none is the header's Nov 16); tests laid out by module, as "Full" tests numbered per section (a place holds two questions) or numbered straight through; grid-in answers entered as 0.125, .125 or 2/16 for a key of 1/8, with `result` the academy's own mark and every policy saying so; topic labels in questions.csv and attempts.csv written with stray spaces, other capitals or other punctuation than topics.csv; policies written as prose with a table, prose alone, or a list of rules. About a fifth of those two tables' rows are written another way, never the first five, and every form reads back to one value.
- The reference solver finds a question from the student's own attempts row, matches labels with spaces, capitals and punctuation set aside, counts from `result`, takes the request's date and reads all three policy styles; it passes all 192 tasks through the engine's tools and checker. The checker matches labels and grid-in numbers the same way.
- A fresh job: train Copperfield Learning, Thistlewood Learning, Bramble Hill Academy; transfer Juniper Study House. The first run's four academies are gone from the name list, so its unseen academy stays unseen. `buildRecordTasks` still works for stem-less folders, now tested on a "Full" export too.
## 2026-10-30 (Fri), fixes from the first field run (branch `field/run-fixes`)

**Done** (fakes only: no model was called, no GPU, no spend). The first Academy desk run patched copies of the code around four problems; these are the fixes in the repo.
- *Meta's usage.* Meta's streamed replies end without token usage about one time in three, and Meta still bills them. Meta's mentor and actor calls now ask for whole replies, which always carry usage. A reply from any provider that still lacks usage is refused as uncounted, and the mentor gate charges it the most it authorized, so the dollar cap holds (`docs/GOTCHAS.md`).
- *Comparisons on a job with organizations.* The locked test is priced and counted as the test split plus every sealed organization's task; each arm's copy lists the sealed organizations again; the pin covers `orgs/`. Spark studies the organizations once for the comparison: the brief goes to `study.json`, `--confirm-study <token>` confirms it, the same confirmed brief sits beside every arm's copy, and the bare arm imports the blank harness so the procedure isn't added. Each report row has its results by organization (trained on or never seen, synthetic or real), the target is judged on the trained organizations, and the study's cost is counted once.
- *record-tasks.* A wrong answer whose module is blank is asked about without a module (it said "module 0"); `--per-skill N` replaces the fixed eight.
- *Optional files.* An organization's folder may lack the files the job marks optional: import, the seal, the mentor's data view and the agent's folder all take it. A policy without the escalation-days row counts wrong answers over the history window; one without the first-hint row builds every records-only task.

**Open issues**
- Nothing here was run against a live model; the next hosted run should use the repo's runner instead of the patched copies.
- A blank-module answer is asked about by test, section and number; a test that numbers questions per module but leaves the module blank in its records would make that ambiguous.

## 2026-10-30 (Fri), field lane "Sample": Academy desk as a ready-made job (branch `field/sample`)

**Done** (no model was called, no GPU, no spend)
- "Try the Academy desk" sits beside "Try the sample job" on the empty workspace and the Describe screen. It imports `examples/academy/job` through `jobs.createSample('academy')`: the three train academies go into the job folder, the transfer academy is sealed by the engine. Define then asks Spark to study the material, and training waits for the brief to be confirmed. The service desk stays the default sample.
- The installer ships the job as `academy-job` (electron-builder `extraResources`, all four academies); the packaged spec checks for it.
- Engine test (the real example imported, nothing in the job file names the transfer academy) and hidden e2e `sample-academy-desk.spec.ts` against the stand-in engine. Screenshot `start-academy-desk-dark.png`.

**Open issues**
- Adding a person's own academy folder as an unseen organization was left out: it needs the engine to seal an organization into an existing job and to build its tasks from records (`buildRecordTasks` lives in the example package), which is more than this lane.

## 2026-10-30 (Fri), field lane Study: Spark's cited brief of the academies, confirmed before teaching

**Done** (branch `field/study`; no model was called, no GPU, no spend)
- Decision 069. A field job's train organizations are studied by Spark into a short brief held to a schema: skills by task type, connections, rules, differences between academies, open questions, out of scope. Every passage is checked word for word in the file it names; unfound ones are taken out and counted, and uncited claims are marked as Spark's own. $1 cap, kept in `study.json`, resumable.
- Transfer organizations never reach the study: their folders are not opened, and their names stop the study before any call (tested).
- Define shows the brief with one primary action; every run of a field job waits for it. A confirmed brief seeds the first harness with a shared `procedure` skill, with no academy's facts.
- Minimal `Job.organizations` and `Task.org` added per the contract, since `field/orgs-engine` had not landed on `field/main`.

**Open issues**
- Importing a field job's `orgs/` folders belongs to `field/orgs-engine`; until then the files must be placed in the job's folder.
- The step guard (no digits, no organization names) is a heuristic.

## 2026-10-30 (Fri), field lane "Report and workspace" (branch `field/report`, from `field/orgs-engine`)

**Done** (no model was called; the GPU stayed off; no money spent)
- *Judged on the trained organizations* (decision 070). For a job with organizations, the score, per-type results, latency and the required pass rate count only the organizations it trained with; each one it never saw is reported in `perOrg` alone. One-organization jobs are unchanged.
- *The report's "By organization" grid*: skills by organizations, grouped Trained with, Never seen and Never seen, real, pass/total per cell, empty where a skill wasn't tested there, each organization's own total in the last row. Practice and check tasks stay in "By task type". Screenshot `report-field-dark.png`.
- *The workspace* names the organization an agent works on in the chat header; that name is the one menu that moves it to another by rebinding `data`. Another organization's folder is refused. Writes still ask. Screenshot `workspace-org-dark.png`.
- Hidden e2e `field.spec.ts` (4) passes against the stand-in engine.

**Open issues**
- The workspace knows an organization by its folder's place (`orgs/<id>/data`). The real academy's snapshot should sit in that layout, or the header shows the folder's name.
- The menu lists the organizations from the agent's report card, so an organization it was never tested on can't be chosen from it; the settings' folder row still binds any folder.

## 2026-10-30 (Fri), the proposal weighed: Teach this now proves the student learned, stale approvals refused, honest copy

**Done** (no model of the product was called; the GPU stayed off; no money spent)
- *The proposal weighed.* The owner asked which ideas in `docs/SPEC_FIELD_SPECIALIZATION.md` and the strategy notes make Architect more cohesive without spreading it wider. GPT-6 Astra and Claude agreed on a narrow set; the field research stage, five competency families, the 150-scenario contract, cross-organization suites, a new flagship job, a transactional record store and extra students were not adopted. The spec stays a proposal.
- *Teach this proves the student learned* (decision 066, branch `teach/student-learned`, reviewed by GPT-6 Sol, its two findings fixed). An improvement gets a round even when the agent already meets its target. It keeps a change only when the student, with the change, passes the practice tasks of the lesson's type that it had failed, and its check tasks aren't harmed (`isHarmful`). Only lessons learned in a kept round are marked used; the rest go back to the queue with a note. "Save as version N", which made a version nothing measured, is gone: every lesson goes through Improve agent. The improvement report says Learned, Not learned or Not verified for each lesson. Improvements made before 066 show their old scores with no verdict. The guide PDF is rebuilt.
- *Stale approvals refused* (decision 067). An approved workspace write is refused, with nothing written, when its file changed on disk after the change was proposed.
- *Honest copy.* The README says beside the numbers that they were measured on hosted full-precision Glimmer and came from instruction and tool changes, and that the local 4-bit build wasn't measured. The YC paragraph reads as our interpretation. A short related-work note (GEPA, ACE, tau-bench) is in the README and the results paper; the paper cites them by arXiv number, since the site links only to the repository.
- `pnpm check` exits 0 on main (3,425 tests); the hidden teaching e2e passes (6).

**Next**
- Owner: optional, a capped (~$3) hosted run of the shipped agent, unchanged, on a different seeded business's unseen records, reported as that and nothing more. Not started without the owner's OK on spend.
- Still blocked on the owner: a local qualification (GPU rule), a real adapter (paid compute), a real operator.
- A release after the owner looks: the Teach this screens changed (no "Save as version"). The site's mocks and the film never showed that button, so neither is out of date.

**Open issues**
- A lesson only counts when the student failed practice tasks of its type in that round. An agent near its ceiling may fail none, so its lesson comes back "Not verified". That is honest, but it can make a demo of Teach this on a strong agent end with no new version.
- Improvements no longer re-measure a kept change on new seeds.

## 2026-10-30 (Fri), proposed field-specialization direction

**Done**
- At the owner's request, wrote `docs/SPEC_FIELD_SPECIALIZATION.md`: a proposed expansion from one job to a researched field with related competencies, verified curricula, organization profiles, controlled model adaptation, cross-organization evaluation, and an owned local specialist.
- The proposed first field is maintenance and repair operations across intake, policy, estimation, planning, and reconciliation. The spec includes an incremental architecture, parallel work boundaries, acceptance scenarios, and a path toward larger field-specific model programs.
- Completed a fresh-reader review and resolved its six material gaps: transfer-test isolation, derivative source permissions, evaluator-owned templates, reduced-scope qualification, bounded local transactions, and private-resource installation.
- This was documentation work only. No application changes, model runs, paid training, or publication occurred. The existing hosted comparisons do not establish the new field/local/adapter claims.

**Next**
- Owner review of the proposal. Current implementation guidance remains in `docs/SPEC_EXPANSION.md` and `docs/EXPANSION.md` until this expansion is adopted; do not treat this progress entry as authorization to start training or replace the existing plan.

## 2026-10-30 (Fri), the film in the site's hero, a download page, the results page as a paper, and the guide refreshed

**Where things stand (start the next session here)**
- *Product.* Release 0.4.0 is out, with signed and notarized Mac disk images and an unsigned Windows installer. `main` is green. The owner will try the app and keep developing it: more capabilities, a stronger loop, more polish. Expect the film and the site to change with it.
- *Site* (https://echoo19.github.io/architect/). It deploys on every push to `main` that touches `site/` (`.github/workflows/site.yml`). There are three pages:
  - Home: the claim, two lines, the downloads and the film.
  - `/results/`: a short paper; every number is in `site/src/evidence.ts`, taken from `docs/comparisons`.
  - `/download/`: one card for each system.
  The mocks in `site/src/mock/` are no longer on the home page. They make up the film's page (`site/film/`, a dev-only entry, `pnpm -C site exec vite --config vite.film.config.ts`).
- *Film.* The renderer, the soundtrack and the narration live outside the repo, in `C:\JakeOS\projects\architect-runs\film\launch` (`render.mjs`, `research/sound-v4.mjs`, `audio/`, `renders/`). The final cut is `renders/architect-walkthrough.mp4`. To change the film:
  1. Edit the mocks or `site/film/`.
  2. Build `site/dist-film`.
  3. Render it with `node render.mjs --film <dist-film/index.html> --out <name> --workers 3 --audio audio/mix-v5.wav`, then check it with `research/glitch.mjs`.
  4. Replace the site's copies: `ffmpeg -i <render> -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -movflags +faststart -c:a aac -b:a 160k site/public/architect-film.mp4`, and a still at 66 s for `site/public/film-poster.jpg`.
  New narration needs new ElevenLabs lines; the owner wants to see the picture before any voice is generated.
- *Guide.* Run `node docs/guide/build.mjs` after recapturing `docs/screenshots`. The figures come from the fake-engine specs: screenshots, flow, workspace, rule, teaching, versions and hub-screens, all run with `ARCHITECT_HIDDEN=1`.

**Done**
- *Home page.* At the owner's word, it is trimmed to the claim, two lines ("Spark, a large model, teaches your job to Glimmer, a small one. Once Glimmer passes a test it has never seen, it runs offline on your files."), the downloads and the film. The chapters of mocks, the closing section and the measured results below it are gone.
- *The film.* The final walkthrough rendered at 1080p and 60 frames a second, 2 min 50 s, with no one-frame pops or jumps in the frame scan. A 21 MB web copy is the site's hero (`site/public/architect-film.mp4`), shown as a still of training with one play button. Nothing loads until it is pressed.
- *Download page.* `/download/` holds one card for each system under its mark: the Mac disk image for Apple silicon with the Intel one beside it, and the Windows installer. The bar's Download button and the home page's macOS button lead there.
- *Results page.* At the owner's word ("hard to read", then "almost like a paper"), it is one 760 px column set out as a short paper. It has an abstract, numbered sections, seven figures and seven tables, each in its own panel with a numbered caption, and numbered citations to the reports.
- *The guide.* Every app screenshot was recaptured from the redesigned screens with the fake-engine specs. The guide's crops and text were matched to the new screens and the PDF rebuilt (45 pages). Two specs were stale after the workspace redesign: one still expected the "· N steps" count the redesign removed, and the other had a race with the home screen's redirect. Both were fixed in the tests, not the app.

**Next**
- The owner tries 0.4.0 and redirects if needed, then the next round of development.
- Submission by Wed Nov 4, 9 PM ET (see the checklist in `docs/HACKATHON.md`): upload the film and check its link, make the submission, and optionally post on X. If the app changes before then, cut a new release and update the film if its screens are out of date.
- How to cut a release:
  1. Bump the version in `apps/desktop/package.json`, `apps/cli/package.json`, `docs/CLI.md` and `site/src/content.ts`. A site test checks the last against the app.
  2. Commit `chore(release): X.Y.Z` and push.
  3. Tag `vX.Y.Z` and run `gh release create vX.Y.Z --verify-tag`. The tag runs `.github/workflows/release.yml`, which builds the Windows installer and the Mac disk images, signs and notarizes the Mac ones with the five signing secrets, and attaches all three.
  4. Check that the download links on `/download/` return 302.
- Open: the Windows installer is unsigned. Settings and first run kept their old structure in the redesign.

## 2026-10-30 (Fri), the redesign merged, release 0.4.0 signed for Mac, the new site, and the walkthrough film

**Done**
- *The redesign, phase B.* The owner said the recolored app still felt "classically vibe coded", so each screen was restructured on its own branch and merged: describe and define (`design/flow-define`), training, results and improvement (`design/train-results`), and the workspace (`design/workspace`). Every screen has one focal point, uses rows instead of stacks of cards, and drops the captions, pills and eyebrows that repeated what the layout shows. Settings and first run were left as they are, at the owner's word to wrap up and not over-engineer.
- *The site.* Rebuilt in the new design (`design/site`), with mocks of the real flow that use CSS-only motion and can be seeked frame by frame. It now uses Inter for all text, the official GitHub mark and one type scale, and it is zoomed out. A new `/results/` page shows the comparisons, the score per round, answer time and cost, how a round works, and the limits, each with its source. Live at https://echoo19.github.io/architect/.
- *Signed Mac app.* The repository holds the same five signing secrets as Conductor (a Developer ID certificate and an App Store Connect key). A by-hand release run signed and notarized both disk images and passed `codesign`, the stapled ticket and Gatekeeper. Release 0.4.0 is the first signed one. The README and the guide now say the Mac app opens without a warning; the Windows installer is still unsigned.
- *The film.* Its picture is now a walkthrough of the site's mocks (`site/film/`, a dev-only Vite entry, `film/walkthrough`), rendered by the product-film pipeline outside the repo. The soundtrack keeps the recorded narration. Its music no longer pumps under the voice: the compressor keyed by the voice is replaced by a smooth 6 dB gain envelope, and the hard cut to silence is replaced by the track's own breakdown.

**Next**
- Recapture `docs/screenshots` from the merged screens with the safe specs, then rebuild the guide (done in the entry above).
- The owner tries 0.4.0 and redirects if needed.

## 2026-10-30 (Fri), the user guide (branch `docs/guide`)

**Done**
- *The guide.* `docs/Architect-Guide.pdf`, 44 pages on US Letter, 15 chapters: what Architect does (one page and a diagram), before you start, first run, describe a job, answer the questions, check the job and the rule, train, results, use your agent, make it better, share it, the command line, what leaves your computer, when something goes wrong, and a glossary. Each chapter says what you will do, gives the steps, shows what you will see and says what to do when something goes wrong. Every name, number and message in it was checked against the renderer's own strings, `docs/CLI.md`, `docs/ARCHITECTURE.md`, `docs/MODELS.md` and the engine's limits (the drafting limits, the default budget of 8 rounds, $5 and 4 hours, the keep rule of 2 check tasks and 1 per type).
- *The build.* `docs/guide/` holds `index.html` (the text), `guide.css` (print rules, the type and the grid of `docs/DESIGN.md`) and `build.mjs`. `node docs/guide/build.mjs` works offline: it inlines Inter, Inter Tight and Geist Mono from `node_modules`, takes the app's screens from `docs/screenshots/*.png` as they are, cuts each by fractions of its width and height, counts every chapter's pages to fill in the contents, and prints with Playwright's Chromium. It stops when a screen is missing or the page counts disagree.
- *Where it is linked.* One line in the README, under "Get it".

**Next**
- Run `node docs/guide/build.mjs` again once the redesign's screens are recaptured, then look at the figures: the crops are fractions of each capture (`x` and `y` on the `<fig>` tags in `index.html`), so a screen whose layout moved may need its crop moved too.

**Open issues**
- The guide says what the app says today. A screen that changes its words needs its line in `index.html` changed with it.
- Page numbers come from Chromium's own layout, so a different Chromium can move a page break; the build prints each chapter's start page and the check it makes catches a total that does not add up.

## 2026-10-29 (Thu), the design foundation: one dark theme, Inter, and springs (branch `design/foundation`)

**Done** (phase A of the redesign in `docs/DESIGN.md`; no model of the product was called and the GPU stayed off; every run used hidden windows and stand-ins)
- *Tokens and type.* `packages/ui/src/styles` now holds the one theme of the design: `ground, card, raised, field, hover, selected, line, line-strong, fg, fg-dim, primary, on-primary, student, mentor, danger, ring`, plus `student-soft`, `danger-soft` and the backdrop. The light theme, the paper tokens, the six grey text levels, the dot grid and every gradient are gone, and so are the old surface, line, shadow, radius and type names: all of `packages/ui`, the renderer and the site's mocks were moved onto the new ones (a codemod, then by hand where a grey had been the only difference, which now reads by weight or by mono). Inter and Inter Tight replace Geist; Geist Mono stays for code. Radii are `mark` 8, `control` 12, `card` 20; a card's edge is an inset hairline (`shadow-edge`); the one shadow is `shadow-float`. `apps/desktop/test/unit/main/design-rules.test.ts` fails on an old name, a grey, a gradient, a dot grid, a color outside the tokens or text under 13px.
- *Dark only.* `nativeTheme.themeSource` is always dark and the window chrome is one set of colors. The theme choice is gone from Settings, the command palette and the settings schema; a `theme` left in an older `settings.json` is read past and not written back (tested, and by `shell.spec.ts` on a real launch). `<html data-theme>` is no longer set, and the e2e specs capture the dark theme only under the same `-dark` names; the 156 `*-light.png` captures were deleted.
- *Motion.* `motion` 12.43.0 and `@number-flow/react` 0.6.2, pinned, reached only through `@architect/ui`: `springs` (snappy, smooth, exit), `MotionProvider`, `Reveal`, `Stagger`/`StaggerItem`, `StepTransition`, `Collapse`, `NumberTicker`. Buttons press to 0.97; the segmented indicator and the settings tabs move with a shared `layoutId`; dialogs, drawers, menus, popovers, the palette, tooltips and toasts scale in from 0.97 and leave faster; disclosures animate their height; progress bars and the switch's knob spring. A run for tests and screenshots (`ARCHITECT_HIDDEN=1`) tells the page so through the preload (`window.architectRuntime.hidden`, from a `--architect-hidden` renderer argument), and the provider then completes every transition at once, as it does for a system that asks for reduced motion.
- *Components.* Every component in `packages/ui` follows the design: white text, the new surfaces and hairlines, a 2px focus ring offset 2px, Inter for the interface and Inter Tight for titles and the numbers that matter. `StatusDot` is gone (its one use, the GPU mark, is an icon now); props are otherwise unchanged. `"sideEffects": false` lets the site drop the components it does not use.
- *Verified.* `pnpm check` exits 0 (257 test files, 3,403 tests passed, 2 skipped), the site builds and was looked at in headless Chromium, real motion was tried once in a hidden window with a throwaway probe (every dialog, menu, popover, tooltip, toast and disclosure came in, left and unmounted; hidden windows draw very few frames, so those runs were slow but not stuck), and the hidden e2e specs `screenshots` (6), `flow` (18), `shell` (9), `rule` (4), `teacher-menu` (4), `drafting` (3), `connections` (7), `hub` (4) and `runs` (16) pass; their captures were looked at.

**Next**
- Phase B: take out the labels, captions and eyebrows screen by screen, and wire `StepTransition` and `Reveal`/`Stagger` into the screens. `StepTransition` is not on the routes yet. In a hidden run it is a plain element, so wiring it in changes nothing for the specs; for a person it makes a page wait for the old one to leave (about 0.16 s) before the new one comes in.
- The specs that named a theme and were not run (`workspace`, `versions`, `teaching`, `retest`, `sample-agent`, `hub-screens`, `evidence`, `job-files`, `runs-engine`) were migrated to dark only and type-check, and their captures are still the old design's until they run where a local runtime may be used.

**Open issues**
- A dialog that its parent unmounts instead of closing (`<Dialog open>` rendered on demand) cannot animate out; only one that stays mounted and flips `open` does.
- Where a grey was the only difference between two lines, the lines now differ by size, weight or mono, or not at all; that is the per-screen work of phase B.

## 2026-10-29 (Thu), release 0.3.5, and the launch film started

**Done**
- Released 0.3.5 (`e2f5f09`, tag v0.3.5) with the blind read's wording: the question about a mark says when each answer is the right one, the rule shows it in short beside the answer, and the counts say out of how many rows. CI passed on main before the tag and on the release commit, the release workflow attached the Windows installer and both Mac disk images, and the site, deployed after them, names `Architect-Setup-0.3.5.exe`; the three download links answer 302. `docs/HACKATHON.md` names 0.3.5 and the Oct 29 row says so.
- The launch film, with the product-film skill, in `C:/JakeOS/projects/architect-runs/film/launch/` (outside the repo, so renders and its two packages stay out of the monorepo): `BRIEF.md` (the idea, a first script of about 200 words and 2:10, the picture and the sound), the skill's tools and licensed effects, Geist and the app's tokens copied from `packages/ui`, and four voice samples on ElevenLabs `eleven_v4` (Jon, Eric, Jen, Eliza; a tag such as `[wryly]` is performed, not read, checked by transcription). The pacing takes after Apple's MacBook Pro film of Oct 28 (about 100 words a minute of film, short lines with music between them, a stop before the end and a callback to the first line), without its device or lines.
- The ElevenLabs key can list voices and make speech and music, but not list models or read the plan. The models, from ElevenLabs' docs: `eleven_v4` for the voice and `music_v2_5` for music, which takes a composition plan timed to the cut.

**Next**
- The owner picks a voice, says what to change in the script, and whether the logos of the teachers (Meta, OpenAI, Anthropic, Google, OpenRouter, Ollama) and Hugging Face may be downloaded.
- Then the voiceover, a music plan timed to it, the page and drafts, the critic pass, the mix and the final render (3 workers at most while memory is short).

## 2026-10-29 (Thu), the blind read's fixes merged, and where Architect fits in the README

**Done** (no model of the product was called; the GPU stayed off)
- `wording-after-blind-read` is merged (`66b883e`) after the hidden `rule.spec.ts` passed on it (5 tests) and its captures were looked at: the question says when each answer is the right one, the rule shows "What should "N/A" in parts_cost (tickets.csv) count as? Count it as zero", and the counts say "26 of 160 rows". The run's one failure before that was the spec's own old pattern for the count lines.
- The README has a short "Where it fits": Y Combinator's Requests for Startups for Winter 2027 asks for vertical models ("Vertical Foundation Models", Diana Hu), and names verifiable, field-specific rewards as the hard part, which is what Architect does for one job. The YC logo is the public-domain text logo from Wikimedia Commons (`docs/images/yc-logo.svg`, with a note in the file that it implies no endorsement).

**Next**
- Release 0.3.5 with the blind read's wording.
- The launch film, made with the product-film skill: mockups rebuilt from the app with real recordings, an ElevenLabs voice and generated music.

## 2026-10-29 (Thu), a blind read of the N/A screens, and its fixes waiting on a branch

**Done** (no model of the product was called; the GPU stayed off)
- A fresh reader, given only the captures `rule-mark-light` and `rule-define-light` and playing a bike shop's owner, read both screens. What it found that is real:
  - The question asks yes or no ("Does "N/A" mean no parts cost?") while its buttons say "Count it as zero" and "Leave those rows out".
  - Under "From your policy" the answer's line read "...If it can also mean "not known yet", leave those rows out. Count it as zero", as if it said both.
  - The lines on how far an answer reaches ("26 rows have an empty parts cost...") don't say out of how many.
- Fixed on the branch `wording-after-blind-read` (`d7b43bb`), not yet merged: the question says when each answer is the right one ("If "N/A" means no parts cost, count it as zero. If it can also mean "not known yet", leave those rows out."); the rule shows it in short beside the answer ("What should "N/A" in parts_cost (tickets.csv) count as?"); and each count line says it out of all the rows, as the line on the rows left out does ("19 of 160 rows have..."). That line is the one sentence of a rule that names no mark that changes; its version, token and tasks do not. Decision 061 says so. The engine, harness, shared and desktop unit tests pass (203 files, 2,554 tests), and typecheck and lint pass.
- Kept as they are: no count in the question itself (decision 061 keeps the question to the choice); "rows", "task" and "Glimmer" (said elsewhere in the app); the made-up example, which is tagged.
- The hidden e2e run for it (rule, drafting and flow specs) was stopped by Claude Code because the computer was low on memory, before `rule.spec.ts` ran. Its leftover runner and hidden app were stopped, the one capture it had rewritten was restored, and an old site preview server was stopped too. It was not started again.

**Next**
- When there's memory for it: build, run `rule.spec.ts` (it recaptures `rule-mark` and `rule-define`), look at the captures, then merge `wording-after-blind-read` and release.

## 2026-10-29 (Thu), release 0.3.4

**Done**
- Released 0.3.4 (`27c0392`, tag v0.3.4) with plain notes: Architect asks what N/A or a dash in a column means, and counts it as 0 only when the person says so; what a rule takes away is always in brackets; the rule's heading and its confirmation come into view once it is confirmed. CI passed on main before the tag and on the release commit. The release workflow attached the Windows installer and both Mac disk images. The site was deployed after them: its bundle names `Architect-Setup-0.3.4.exe`, and the three download links answer 302.
- `docs/HACKATHON.md` names 0.3.4 as the release with installers and has the Oct 29 row of "What was built when", from the commit log (249 commits by author date, merges included).

**Next**
- The film: the offline chat, once the GPU may be used, then sound and the full cut under three minutes.
- Show the rule's screens to a fresh reader with a file that has a dash in it.
- Specs that never stub `connections:detectLocal` still need their own stubs (agent-host uses fake Ollama servers, so not in `launchApp`).

## 2026-10-29 (Thu), the film's rule in a scene of its own, and the confirmed rule kept in view

**Done** (on main; no model was called or loaded, and the GPU stayed off)
- The film: "Describe a job" now ends when the draft is ready, and a new scene, "Check the rule" (its card: "Before it trains. Nothing trains until you confirm the rule"), shows today's Define screen: the lines of the policy, the rule as steps, the examples with their working, and the confirmation. It is recorded on a throwaway copy of the drafted job with its confirmation taken out, so the teacher is not called again (a scene's `launch` can now `prepare` that copy). A stand-in tells the app what this computer has, Ollama with both of Glimmer's builds and a 12 GB card, so neither the local runtime nor `nvidia-smi` is asked. The first take used a stand-in with only the 2-bit build, and Define said Glimmer wasn't on this computer, which isn't true here, so it was recorded again. The drafting conversation is the one recorded this morning, cut where its "Review the job" opened the old Define screen. The working cut is now 1:35, at `C:/JakeOS/projects/architect-runs/film/architect-working-cut-2026-10-29b.mp4`, with the earlier one kept beside it. "On your computer" still waits for the GPU.
- Found while checking the film: confirming the rule folds it away and takes the button with it, so a window shorter than the page was left on the estimates, with the "Confirmed" badge out of view and the focus nowhere. The heading, with its badge, now comes into view and takes the focus. `rule.spec.ts` confirms in a 900-pixel window and holds both; on a build without the change it fails.
- CI passed on main for the merge of the marks (`e5cb96e`).
- Verified: the hidden `rule.spec.ts` passes on the rebuilt app (5 tests), the desktop flow unit tests pass (34 files, 415 tests), and typecheck and lint pass for the changed files. No capture changed.

**Next**
- Release 0.3.4: the marks, the brackets and the confirmed rule kept in view.
- The film: the offline chat, once the GPU may be used, then sound and the full cut under three minutes.

## 2026-10-29 (Thu), the question about N/A and dashes reviewed, fixed and merged

**Done** (on main, merge `a99add0`; no model was called or loaded, and the GPU stayed off)
- Reviewed the branch (eight commits, author Jake Kang, no attribution lines): the code, the versions of rules that name no mark, the teacher's prompt and reply format, the question flow, and the two captures that show it, `rule-mark` and `rule-define`, in both themes. GPT-6 Sol read it too, read-only, and found four things. I reproduced the first before fixing it.
- *Five marks in one column.* All five said to count as zero made a rule its own schema refused (four marks to a column), and the conversation ended after the fifth answer with a reason that named the field to the teacher. Architect now asks about four marks of a column at most, in four columns at most, and a column with a mark that already counts as zero keeps its room first. A mark past that is not asked about, its rows stay out, and the draft says so, as it does past the six questions.
- *Cost and cost.* An answer was matched to its column without regard to case, so in a table with both, an answer about one could stand for the other after the teacher drafted again. It is now matched to the column the table finds by the answer's name, which still allows another case or spacing when only one column fits.
- *What the teacher hears when no row can be worked out.* The reason named a mark the person was asked about, with how many rows hold it. The teacher now reads it as it did before ("parts_cost is empty or N/A"), and the person reads it in full.
- *Kept as it is:* a teacher that quotes eight passages for a rule whose empty cells count as zero now gets the person's answer as a ninth passage, where it used to be dropped. Stored rules keep their versions; the same reply drafted again makes a new version, which the person confirms again. Decision 061 says so.
- Mine: where Spark carries on after a question of Architect's, the conversation names Spark again.
- Each fix has a test that fails without it: three in `drafting-rule-reply`, one each in `drafting-marks`, `rule-marks` and `conversation`.
- Verified: `pnpm check` exits 0 (254 test files, 3,361 tests passed, 2 skipped). Hidden e2e on the rebuilt app, all on stand-ins: `rule.spec.ts`, `drafting.spec.ts`, `flow.spec.ts` and `teacher-menu.spec.ts` pass (41 tests).

**Next**
- Release 0.3.4 with the marks and the bracket fix.
- The film: "Check the rule" recorded again as a scene of its own, from a copy of the drafted job with its confirmation taken out.
- Show the rule's screens to a fresh reader with a file that has a dash in it.

**Open issues**
- The prompt's new sentence and the question's words were never tried on a real teacher.

## 2026-10-29 (Thu), a dash can mean none: a mark such as N/A counts as 0 when the person says so

**Done** (on `worktree-agent-aaccec9f7285b0152`, from main at `148d4b5`, release 0.3.2; decision 061 amended; no model was called or loaded, the GPU stayed off, and every run used stand-ins)
- A reader playing a bike shop's owner said "in my shop a dash means none, and I get no way to say so", and in one sample 26 of 160 rows were left out for an N/A or a dash, a sixth of the records. A rule can now name, for a column of a table, the marks that count as exactly 0 (`placeholderMeansZero`, GPT-6 Astra's design). A mark is only a form the reading of cells already knew as standing for nothing (N/A, a dash, a question mark, null and the like), compared without regard to case or spacing, so N/A and n/a are one mark and a hyphen and a longer dash are two. Any other mark leaves its row out as before.
- *No rule that exists changes.* The field is optional, has no default and is never an empty list, and is added only to a rule that names a mark, so every version, confirmation token, task and sentence of a rule that names none is what it was. `rule-versions.test.ts` holds six versions, three tokens, the tasks of two rules and their words, taken before the change. A new mark is a new version, so changing the answer later needs a new confirmation by the binding that was there. `RULE_CONVENTIONS_VERSION` stays 1.
- *Architect asks, not the teacher.* When the rule reads a column of numbers that holds marks, the person is asked before any task is made, once for each table, column and mark: "In tickets.csv, parts_cost sometimes says "N/A". Does "N/A" mean no parts cost? If it can also mean "not known yet", leave those rows out." with the two answers of an empty cell, neither chosen. "Draft it now", a word that is no choice and running out of questions never mean zero; leaving out is an answer too and is kept, so a redraft does not ask again. At most six such questions are asked; the rest stay out and the draft says so. The conversation says who is asking: "Architect" over the question (`DraftTurn.from`).
- *No second call to the teacher.* Astra proposed telling the teacher the answer and drafting again; the steps do not change with the answer, so Architect holds the teacher's reply and checks it again with the answer. The person gets the next question or the finished draft at once, and the teacher is told nothing of any mark. Its prompt says that N/A and a dash are Architect's to ask about, its reply format has no field for a mark, and one it writes anyway is dropped (a test).
- *What the person sees.* "An empty parts cost or "N/A" counts as 0, as you said." beside the step that adds the column; the answer under "From your policy" beside its question; the example shows the cell as the file wrote it ("N/A (counted as 0)"); a count for each mark; and the rows left out are only the ones still left out, each reason saying what the cell holds. Nothing says the rows come back.
- Smaller: a report line sets a question that holds quotes in single quotes; the teacher's quotes are held to eight passages with a reason and Architect's answers have room of their own; the dev drafting script leaves those rows out by default instead of taking the first option (zero). The tests' drafting world answers Architect's question about a mark with "Leave those rows out" unless a test asks for the question itself (`marks: 'ask'`), which is what a rule did before, so the tests that draft the bike shop for other reasons read as they did.
- Verified: `pnpm check` exits 0 (254 test files, 3,353 tests passed, 2 skipped; it was 249 and 3,260). Forty-three breaks were made on purpose, one at a time (a default in a version, marks compared as written, any word taken for zero, the teacher called again, an answer settling another table, column or mark, no limit on the questions, a field for a mark in the teacher's reply, the note saying only the empty cell, the schema letting a number through, and the rest), and each failed a test and was put back. Hidden e2e on the rebuilt app, all on stand-ins: `rule.spec.ts` (5), `drafting.spec.ts` (5), `flow.spec.ts` (27), `screenshots.spec.ts` (10) and `teacher-menu.spec.ts` (4) pass. `rule-mark` (new) and `rule-define` were looked at in both themes and kept; 20 captures that moved only by a few pixels were put back.

**Next**
- Review and merge the branch. The captures `rule-mark` and `rule-define` are the ones that show it.
- Show the rule's screens to a fresh reader again, with a file that has a dash in it.
- Merge it with the release being cut on main. No version string was touched here.

**Open issues**
- The prompt's new sentence and the question's words were never tried on a real teacher: the run used scripted ones.
- A mark of more than 16 characters is not asked about. N/A and NA are two marks, asked about apart.
- A dash that means none on one ticket and "waiting for a quote" on another cannot be told apart. The question says to leave the rows out if a mark can mean that.

## 2026-10-29 (Thu), a second reader of the day's code, and brackets on what is taken away

**Done** (on main; no model of the product was called)
- GPT-6 Sol read the day's app changes (d546661 to 6996642), read-only: the steps' chain against the rule's arithmetic in the shapes the random test doesn't make, the steps against the statement and the version, the older words, the results' counts, the line on what goes online, the saving choice and the time button's sums. One bug: the words of a rule left the right side of a subtraction unbracketed, so `100 - (10 + 5)`, which is 85, could be said "100 less 10 plus 5", which reads as 95, in a step that uses a whole side of a test and in the statement's "Take away" sentence. A sum or a difference that is taken away is now in brackets in `phrase`, in the shortened form of a test, and in "Take away (10 plus 5)."; a difference that comes first needs none. Two tests hold it, and both fail without the fix.
- Verified: the engine, flow and report tests pass (146 files, 2,008 tests), typecheck and lint exit 0. No sample rule takes away a sum, so no capture changed.

**Open issues**
- A statement stored by a draft made before this keeps its words; the steps, worked out when a screen reads the draft, have the brackets.

## 2026-10-29 (Thu), release 0.3.3

**Done**
- Released 0.3.3 (192441a, tag v0.3.3) with plain notes: the training card's line on what goes online, which was untrue with an online teacher; the score's caveat at reading size; discounts as "take 10% off"; the rule screen saying who does what; a round's time as a range; "Spark can't change anything yet" and the way on after the notice; no saving choice for a job that only reads. CI passed on the release commit. The release workflow attached the Windows installer and both Mac disk images. The site's deploy for the version commit was cancelled before it ran and run again after the installers were attached; the live page links `Architect-Setup-0.3.3.exe`, and each download resolves.
- `docs/HACKATHON.md` names 0.3.3 as the release with installers.
- The placeholder-cells work was started on its own branch.

**Next**
- Review and merge the placeholder-cells branch.
- The film's "Describe a job" scene: the repair shop's real tickets have 35 empty and 27 "N/A" parts costs, so a fresh draft would now ask one more question and make a different job from the one whose run the film replays. Keep the drafting conversation as recorded and record only its Define part again, from a copy of the saved draft with its confirmation removed: the steps are worked out when the screen reads the draft, so it is today's screen of the same job, and no model is called.
- The Oct 29 row of "What was built when" in `docs/HACKATHON.md`.

## 2026-10-29 (Thu), the third blind read's fixes reviewed and merged, and the site's chapter with them

**Done** (on main; decision 061 amended; no model was called or loaded, and every run used stand-ins)
- Merged the site's chapter on checking the rule (697e021) after looking at it at 1280 and 375. Two of its sentences were changed: the run's sentence said "the rule you confirmed" to a visitor who confirmed nothing, and now says the final test was "graded by the rule the shop confirmed"; the footer note says "Both shops are made up" in two sentences where it took four. The live page has the chapter.
- Reviewed the fourth pass below before merging it (4681d58): the card's line on what goes online (it follows `mentorIsLocal`, now strict about the address, which only screen words read), the discount words and their bounds, what may save files, the caveat's size, and the 31 recaptures. No attribution line.
- The made-up example's tag was set in the red of a rule that changed since it was confirmed. A made-up example is not bad news, and red beside a rule waiting to be confirmed reads as something wrong with it, so `packages/ui` has a badge tone `emphasis` (the body's own ink, a stronger edge) and the tag wears it with an info mark, still first (decision 061).
- The site's rule says "take 10% off" as the app's now does, and its test reads the discount from those words.
- Verified: `pnpm check` exits 0 (249 test files, 3,260 tests passed, 2 skipped). The pass's own hidden runs (`flow` 27, `rule` 3, `teacher-menu` 4, `drafting` 5, `screenshots` 10, `retest` 11) stand for the merged app, whose code is the branch's; after the tag's change `rule.spec.ts` (3) passes again and `rule-define` is recaptured in both themes. The site is rebuilt and its page captures refreshed.

**Next**
- Release 0.3.3.
- Re-record the film's "Describe a job" scene from the Define step, so the film shows the rule as steps: from a copy of the drafted job with its confirmation removed, so no model is called.
- Placeholder cells: a person can say an empty cell counts as 0, but "N/A" or a dash always leaves its row out (26 of 160 rows in one sample), and a reader said "in my shop a dash means none". GPT-6 Astra's design: an optional per-column list of the placeholders that count as 0 (`placeholderMeansZero`), asked by Architect itself once per column with a choice per mark and none preselected, so a mark that may mean "not yet priced" stays out; no existing rule's version changes.
- Specs that never answer `connections:detectLocal` (see the entry two below).

## 2026-10-29 (Thu), the third blind read: nine fixes in words, size and layout

**Done** (on `worktree-agent-a169ed3996fd6c982`, from main at `83e5a96`, release 0.3.2; decisions 061, 063 and 064 amended; no model was called or loaded, the GPU stayed off, and every run used stand-ins)
- A third reader, again playing the owner of a bike shop and seeing only seven captures, found nine real things. Much of what it said came from the captures themselves and was left alone: the fixture jobs differ ("Repair desk" and "Service desk", 4 and 20 hours, 40 and 60 tasks, 90% and 95%, "7 of 12" and "0 / 8"), the results' fixture has no empty-means-zero answer, the rule's code block is open because the spec opens it, one panel was captured scrolled, and the doubled "Refunds" line and the sidebar's chat titles are fixture data.
- *The privacy line on the card for training here* said "Free. Nothing leaves this computer." for every job, but training always sends the teacher what it reads of the practice attempts. It is kept for a teacher at an address on this machine, and otherwise reads "Free. Glimmer runs here; only what Spark reads to teach goes online." A coding agent, and a local runtime pointed at another machine, count as online; `mentorIsLocal` now asks for the address alone, so the Describe screen agrees. The note under "How this is estimated" says "runs on this computer" or "works in the cloud" by the same test.
- *The score's caveat* and the line on rows left out are one block under the tiles at 15px in the secondary color, where they were 13px, the size of a tile's note. They stay equal to each other. `flow.spec.ts` holds the one block, the one size, no smaller than the page's text and larger than a tile's note.
- *The slow-training callout adds up.* The body says "about 1 h 40 min to score the check tasks once, then 3 h 50 min to 7 h 10 min for each round of teaching", and the button's 9 hours is the next whole hour above 1 h 40 min and the longest round. A round has one name in the box, a round of teaching.
- *The rule screen's sentences*: "Architect works out the right answer to every task from this rule and grades Glimmer against those answers, so if the rule is wrong, the grades are wrong too"; "Check that the lines from your policy are the right ones, and that the rule and the examples match them" (the section is "From your policy"); "26 of 160 rows left out of the tasks".
- *A discount is said as one*: "When member (customers.csv) is yes, take 10% off." A factor from one half to just under one with a percentage off of at most one decimal place is said so; every other factor stays a multiplication. Only the words change: the steps are worked out when read and never stored, so no version or confirmation moves, and `older-words.test.ts` and the random chain check pass. A test works every factor of up to four decimals.
- *The footer says what the teacher can't do yet* ("Spark can't change anything yet", where it said "has nothing it may change" beside a tab that shows its switch on), and the two words on the Train screen that said the same of a run that ended now agree.
- *The made-up example's tag* ("Not from your records") comes first and is the filled warning, with its mark.
- *Saving files is not offered where nothing can be saved.* `permissions.writes` governs only a data file the job lets the agent write and its output folder, and a write is refused for anything else before a person is asked (a test in `files.test.ts`). For a job whose agent only reads, Permissions says "Files it can change: None"; otherwise the choice stays and names the files and the output folder, which the old line left out.
- *The Train notice says what comes next* ("Turn one on, then start training again from the job."), only where the button turns a change on, and the hidden spec does exactly that.
- Verified: `pnpm check` exits 0 (248 test files, 3,255 tests passed, 2 skipped; it was 246 and 3,221). Each fix was switched off in turn and the test written for it failed. Hidden e2e on the rebuilt app, all on stand-ins: `flow.spec.ts` (27), `rule.spec.ts` (3), `teacher-menu.spec.ts` (4), `drafting.spec.ts` (5), `screenshots.spec.ts` (10) and `retest.spec.ts` (11) pass. Of the 47 captures the specs rewrote, 31 show a change of this pass and were looked at in both themes and kept; 16 moved only by noise (a hover colour, a seconds figure, an edge pixel) and were put back.

**Next**
- Review and merge the branch, and release it.
- Show the changed screens to a fresh reader again.
- `hub-screens.spec.ts` and `job-files.spec.ts` still never answer `connections:detectLocal` themselves, so they let the app read this computer's model runtimes; they were not run.

**Open issues**
- A report card made before this keeps the steps it was made with ("multiply by 0.9"): it stores them.
- Under "How this is estimated", the line for a place where no round fits still says "a round at least 3 h 50 min", where the callout says the whole range.

## 2026-10-29 (Thu), the landing page shows the rule being checked before anything trains

**Done** (on `worktree-agent-a18cd40183ffcb858`, brought up to main at `06129fe` first, since the numbered steps are only there; only `site/` and this file changed; no model was called, the GPU stayed off, and everything is static)
- A new chapter, `check`, between describe and train. Its claim is "Nothing trains until you confirm the rule." and its line says that when the files hold prices or discounts, Spark turns them into a rule, which the person reads as steps with some of their own records worked through it. The picture is the app's Define screen at the rule, built from `@architect/ui` and the page's own frame, flow bar, stage and motion classes: the flow bar on Define, the rule as five numbered steps (the file named quietly, "as you said" beside step 4), one ticket worked through line by line to $292.50, then the bar's "Confirm the rule" is pressed. The confirmed mark appears, the bar leaves, and Start training, which was waiting with "Confirm the rule first", can be pressed. It plays once when scrolled into view and is its finished picture with reduced motion and with scripts off. On a phone it keeps the steps, the ticket's lines, the button and Start training, and the mark says "Confirmed" without the date.
- Every word in the picture is the real repair shop job's (`demo-drafted`), read the way the app reads it. The five steps are what `ruleSteps(spec.expression, wordsOf(spec))` gives, and the ticket is the draft's own member example (T-2014), with its older "halves going up" read as "half a cent rounds up" by `readInPlainerWords`. A throwaway script compared every step and every worked line with the page's copy: all the same. The date, the job's name and the card's title are the confirmation's, the job's and its task type's. Nothing under the vault was opened.
- Under the picture, one sentence on that job's run, from the run's own record and the README: before teaching an online copy of Glimmer got 22 of 30 check tasks, and after one round it got 40 of 40 on its final test, where the rule the person confirmed grades each ticket cost. "A single run, not a planned comparison." It says "an online copy" because the job trains on the hosted copy and its 40 final-test tasks took 86 seconds, as the page already says for the returns desk.
- The footer note now says both shops are made up and which parts are real: the returns desk's training run, results and October orders answer, and the repair shop's rule and its run.
- One wording choice to know: the line gives the rule to Spark and leaves who works the records unsaid, since it is Architect's own code that works them, not the model, and the app's own sentence on the screen keeps that apart ("Spark turned your policy into this rule. Architect works out every expected answer from it").
- `site/test/rule.test.ts`: the chapter sits between describe and train; the ticket is worked out again, exactly and without floats, from the steps the page shows, and each line ends in the number so far (a wrong figure fails it; I broke one to see); the file named in brackets is the only part set quietly; the footer names both shops; and the run's figures are the README's, said as one run.

**Verified**
- `pnpm check` exits 0 (247 test files, 3,226 tests passed, 2 skipped).
- `pnpm --filter @architect/site build`, served headless and captured: the chapter at 1280 and 375 (and 768, 1024, 1920), timed frames from 0 to 9.5 seconds at both main widths, the whole page at both widths, the page with reduced motion, and the chapter with scripts off. Each was looked at. At 360 to 1920 wide nothing sits outside the mock's window and the page does not scroll sideways. `site/screenshots` is refreshed.

**Next**
- Merge the branch into main and let the site deploy.
- The owner's call on the sentence under the picture. If it goes, so do `RepairRun` in `App.tsx`, "and its run" in the footer note, and the test of both.

**Open issues**
- The real Define screen folds the rule under "Show the rule" once it is confirmed. The picture keeps it open, so the last frame still shows the steps and the ticket.
- The shared flow bar's step pills are a few pixels wider than the window at 320 px, in every mock that uses it (the page's target is 375).

## 2026-10-29 (Thu), release 0.3.2

**Done**
- Released 0.3.2 (bcfc4f9, tag v0.3.2) with plain notes: the rule as numbered steps on Define, Results and the report; plainer example tags and rounding note; the slow-training warning and what its time button gives; why the last switch stays on, where a Hugging Face key comes from, and "Turn a change back on"; the line on rows left out, "Typical answer time" and "17 GB on disk". CI passed on the release commit. The release workflow built and attached the Windows installer and both Mac disk images. The site's deploy for the version commit was cancelled before it ran and run again once the installers were attached; the live page links `Architect-Setup-0.3.2.exe`, and each download resolves.
- `docs/HACKATHON.md` names 0.3.2 as the release with installers.
- A third blind read of the rule's screens and a chapter of the site on checking the rule were started.

**Next**
- What the third blind read finds.
- Review and merge the site's chapter on checking the rule.
- The Oct 29 row of "What was built when" in `docs/HACKATHON.md`, at the end of the day.

## 2026-10-29 (Thu), the steps pass reviewed and merged, and one line set quieter

**Done** (on main; decision 061 amended; no model was called or loaded, and every run used stand-ins)
- Reviewed the pass below before merging it. The code: the steps generator and the random check that holds it to the rule's own arithmetic; where the steps are worked out (`readable`, when the plan and the report are made, never stored, so `ruleVersion` and every confirmation stand); the older words; the callout; the teacher tab; the Hugging Face row, which opens the page through the app's own link opener; the results line and the date. Looked at the changed part of each of the 50 recaptures. Nothing blocked the merge, and no commit carries an attribution line. Merged as 1b10fe0.
- The line on rows left out was set louder than the score note it follows, so it read as the main text with the note as its preface. It now has the note's size and color, since both qualify the score; `flow.spec.ts` holds it at the note's size and decision 061 says why. With no reason held, one row is "was left out", not "were".
- The site's results mock names its tile "Typical answer time", as the app does.
- Verified: `pnpm check` exits 0 (246 test files, 3,221 tests passed, 2 skipped). Hidden e2e on the rebuilt app: `flow.spec.ts` (27), `rule.spec.ts` (3), `teacher-menu.spec.ts` (4), `drafting.spec.ts` (5) and `screenshots.spec.ts` (10), 49 in all, pass. The first run stopped on the spec's old check that the line was larger than the note; that check was changed. `flow-report-rule` was kept in both themes, and the twelve captures that moved only by noise were put back.

**Next**
- Release 0.3.2.
- A chapter of the site on checking the rule, built from the repair shop's real drafted rule and run.
- Specs that never answer `connections:detectLocal` (`hub-screens.spec.ts`, `job-files.spec.ts` and others) let the app look at this computer's runtimes. A default answer in `launchApp` would also replace the check for specs that point it at their own fake servers (`agent-host.spec.ts`), so each spec needs looking at, not one blanket line.
- A third blind read of the rule's screens.
- The offline-chat scene of the film, when the owner allows about ten minutes of the GPU.

## 2026-10-29 (Thu), the second blind read: the rule as steps, and plainer words on seven screens

**Done** (on `worktree-agent-a808911edeb33ea54`, from main at `d546661`, release 0.3.1; decisions 061, 063 and 064 amended; no model was called or loaded, and every run used stand-ins, save for one read of this computer's model list and graphics card name, said below)
- A second reader, again playing the owner of a bike shop and again seeing only captures (seven this time), stumbled on the same few things; two readers stumbled on the one-sentence rule. Some points of its report were artifacts of the captures and were left alone: the rule's code block on Results is closed by default (the spec opens it for the capture), the 90% and 95% goals come from two fixture jobs, and the doubled "Refunds" line is fixture data.
- *The rule in words is a numbered list* (decision 061). `ruleSteps` reads the typed expression as a chain, what the amount starts as and each thing done to it, and the shop's rule reads: 1. Round labor hours up to a multiple of 0.5. 2. Multiply by 65. 3. When member (customers.csv) is yes, multiply by 0.9. 4. Add parts cost. (An empty parts cost counts as 0, as you said.) 5. Round the result to the nearest cent; half a cent rounds up. A test says what its sides share once and then only what differs, and where nothing is shared it is a sentence about each side. The steps are worked out when the plan and the report are made and never stored, so older drafts have them, no file is rewritten, and neither a rule's version nor a confirmation changes (held in `older-words.test.ts`). They are on Define, in the results' rule notes (with the file names set quietly), in the markdown report and in `scripts/draft.ts`. The type's one-line label in Task sets keeps the sentence, and what the teacher and the student are given never held it.
- *Checked as the rule.* 1,500 random rules from the whole language, each worked out as the expression and as its chain over six random inputs, come to the same exact answer, and nine deliberate breaks of the generator each fail a test. Every other fix was switched off in turn too (the callout, the teacher tab, the notice, the Settings row, the results line and date, the older words): each break failed a test.
- *Tags and the rounding note.* "Shows how the rule rounds labor hours" and "... the total", and "None of your records needed rounding to the nearest cent, so no task tests it." for any rounding step. Drafts made with 0.3.1 ("Shows the rounding (...)") and before it ("A rounding edge"), and their notes, are read in the new words.
- *The slow-training callout.* Its title is "Not even one round of teaching fits in 4 hours on this computer" and the footer beside the held Start training says the same. A line says what the time button gives ("Allowing 9 hours leaves room for one round."), from the number the button names. Where a button sets online training up, the sentence is "Online training isn't set up yet." The chosen card no longer repeats that it is too slow and keeps its title in the normal color.
- *The teacher tab and the notice.* "Stays on: Spark needs at least one way to change Glimmer.", a free Hugging Face account said once wherever the key is named as missing, the Settings row says where to get a token with the page's address, and the Train notice's button is "Turn a change back on" (it keeps "Open Spark's settings" where no change is left to turn on).
- *Results.* A rule that left rows out says, under the score note in the page's own text, how many rows the tests could use and why the rest were left out. "Confirmed Oct 29" as on Define, "Typical answer time" here and in the local-test line, and "17 GB on disk".
- Some specs do not answer the app's look at this computer's model runtimes (`connections:detectLocal`) themselves, as `rule.spec.ts` and `teacher-menu.spec.ts` do. `drafting.spec.ts` reaches it from Define, and my first run of it let that check read this computer's Ollama (a list of models, nothing loaded), try LM Studio's port and ask the driver for the graphics card's name. It now answers that call itself, and was run again. `hub-screens.spec.ts`, which I ran to see the Hugging Face row, reaches the same call from Settings, Models and has the same gap, so its one run did that reading too; it is left as it was, being outside what this pass was asked. `job-files.spec.ts` opens Define the same way and has the same gap, so it was not run. Each needs the same lines `drafting.spec.ts` now has.
- Verified: `pnpm check` exits 0 (246 test files, 3,221 tests passed, 2 skipped; it was 241 and 3,156). Hidden e2e on the rebuilt app, all on stand-ins: `flow.spec.ts` (27), `rule.spec.ts` (3), `teacher-menu.spec.ts` (4), `drafting.spec.ts` (5), `screenshots.spec.ts` (10), `retest.spec.ts` (11), `connections.spec.ts` (7) and `hub-screens.spec.ts` (14) pass; `rule.spec.ts` was run again after the last change to the steps. Every capture that changed was looked at, in both themes: the 50 that show a change of this pass were kept, and the 12 that moved only by noise (the edge of a glyph, a pixel at the foot of a window) were put back.

**Next**
- Merge the branch into main and release 0.3.2 with it.
- A third blind read of the rule's screens, now that the rule is told in steps.
- Have `hub-screens.spec.ts` and `job-files.spec.ts` answer `connections:detectLocal` as `drafting.spec.ts` now does, and recapture what that moves, so no hidden run reads this computer's model runtimes.
- The offline-chat scene of the film, when the owner allows about ten minutes of the GPU; then the full film, under three minutes.

**Open issues**
- A report card made before this has no steps and shows the sentence: its rule can't be told in steps without the draft's tables, which a card does not hold.
- A report holds no table's name, so the line on rows left out says "rows" and not the file. The name would be a new field of the report, which this pass, asked to use only what the report holds, left alone.
- The site's mock of the results still says "Typical answer".
- The Settings row and its dialog still say "token", as Hugging Face's own site does; the row now says that its keys are called tokens.

## 2026-10-29 (Thu), release 0.3.1

**Done**
- Merged the pass after the blind read and the review's fixes (2c8b2f7). `pnpm check` exits 0 on main (241 test files, 3,156 tests passed, 2 skipped) and CI passed on the merge and on the release commit.
- Released 0.3.1 (1ad4249, tag v0.3.1) with plain notes: the screens the blind read named, in plain words; the callout's one-click time limit; and the fifth round of rule fixes (a cut value that could spell another row's id, and the person's words sent as written). The release workflow built and attached the Windows installer and both Mac disk images. The website's deploy for the version commit was cancelled before it ran and run again once the installers were attached, so its Windows link never pointed at a missing file; it links 0.3.1, and each download resolves.
- A second blind read of the seven updated screens was started, by a reader that sees only the captures.

**Next**
- What the second blind read finds.
- The offline-chat scene of the film, when the owner allows about ten minutes of the GPU; then the full film, under three minutes.
- The Oct 29 row of "What was built when" in `docs/HACKATHON.md`, at the end of the day.

## 2026-10-29 (Thu), that pass reviewed, three more lines in plain words, and a time limit in one click

**Done** (on the same branch; decisions 061 and 064 amended; no model was called, the GPU stayed off, and every run used stand-ins only)
- Reviewed the pass below: every recaptured screen in both themes, and the code of the held Start training, older drafts read in the new words, the one-time requests between screens, the idle notice and the held switch. No defect found. GPT-6 Sol's read of the branch was started and then stopped by Claude Code when the computer ran short of memory (other programs held most of it), and was not run again.
- Three lines the blind read named that the pass had left:
  - The note beside a rule's score said it "measures agreement with that rule on held-out cases; it does not independently establish that the rule matches your business policy". It now says the expected answers came from the rule the person confirmed, that the score is how often the agent agreed with it on tasks it had never seen, and that it can't show whether the rule is right for the business (`ruleScoreNote`, on Results and in the report).
  - "member (customers.csv) is no: 68 cases, 68 where it changed the answer" reads "68 rows, and the other side would give a different answer for all 68", from one function for Results and the report (`branchLine`), under "Where each side of the rule applied". The line for a run that needed no teaching says "the agent met the target", not "the student".
  - A run that ended with nothing in a panel no longer says "yet": "No worked examples", "No attempts", "Not scored". The dash that stands in for a missing score is muted, since it read as a legend line cut off in front of "on check tasks".
- The callout's first button names the limit and sets it: the shortest whole number of hours that fits the check tasks once and one round even when its change is measured again ("Allow 9 hours" for 40 check tasks on this computer, "Allow 7 hours" for 30). A drafted job's 4 hours fits no round on this computer, so it is the button a person training there meets first. Where not even a week would do, it is "Allow more time" and opens the limit, as before (decision 064 amended). The e2e helper `allowMoreTime` clicks it, as a person would.
- Verified: `pnpm check` exits 0 (241 test files, 3,156 tests passed, 2 skipped). Hidden e2e on the rebuilt app, all on stand-ins: `flow.spec.ts` (27), `rule.spec.ts` (3), `teacher-menu.spec.ts` (4), `drafting.spec.ts` (5) and `screenshots.spec.ts` (10) pass; `flow.spec.ts` first failed on one line that still held the old words, which was then changed. Captures that changed were looked at and kept (`flow-report-rule`, `teacher-idle`, `rule-confirmed`, `flow-define-slow`, `drafting-define`, `rule-changed-dark`, and `evidence-report-error`, stale since an earlier change to Results); those that moved only by noise were put back.

**Next**
- Merge into main and release 0.3.1.

## 2026-10-29 (Thu), the six new screens, after a blind read

**Done** (on `worktree-agent-abb57ecd48beadc40`, from main at `c8c8385`; decisions 061 and 063 amended and 064 written; no model was called, the GPU stayed off, and every run used stand-ins only)
- A fresh reader, playing the owner of a bike shop, looked only at six captures (the rule on Define, the confirmed rule, the teacher tab twice, the Train screen of a run with nothing to try, the results of a rule) and said what it took each to mean. It had the shape of every screen and stumbled on the same few things. These are fixed in the real components, from `packages/ui` and its tokens only, each with tests:
  - *The notice for a run with nothing it may change* is written in the renderer, from the job and what the app knows, and no longer shows the engine's sentence ("mentor", "stand-in backend", "adapter"), which waits under Details. It is headed "Training didn't start" when nothing ran and "Training stopped" when the run had begun, and the card above it says the same. It says what is off and what is missing in two sentences, and has "Open Spark's settings", which goes to the job with the teacher's tab open, and, while the Hugging Face key is what is missing, "Add the Hugging Face key", which opens Settings on its row.
  - *Define says when training here can't teach.* When the place the job trains at can't fit one round in its time limit, one callout by the choice says so in plain words, with "Allow more time" and "Train online instead" (or what online needs, with a button to set it up), and Start training waits, with the footer saying why (decision 064). "Choose a host" is "Pick an online service under Agent's model", and the online card says what it costs and that tasks and files are sent, wherever it knows.
  - *The rule on Define.* "Not from your records" for an example on numbers Architect made up, "Shows the rounding (labor hours)" for what an example shows, "half a cent rounds up" for what a tie does, the reason for the rows left out in the line that counts them when it is one, the version under Details, "Change the description" with a line on what comes back (the words and the files, not the answers), and the question beside an answer one step higher in contrast.
  - *The teacher tab* is named for the teacher ("Spark"), "Retrain Glimmer itself" and "What it reads, and when" are the two kinds' names on screens, the key is said as a key, and the weights row has "Add the key", which opens Settings on the Hugging Face row. A switch held on keeps its colors and shows a padlock, in `packages/ui`, so every held switch reads as on.
  - *The results' rule.* "your answer" has the same room and place as on Define (one `PassageList` for both), and the rule exactly as Architect evaluates it runs down the page whole. The capture's block was not cut off; its stand-in held one rounding and not the rule above it, so the spec's fixture now holds the rule.
- Checked first, as asked, before the rounding words changed: they are in neither a rule's version (a hash of its typed expression, tables, passages and the conventions version) nor a confirmation (versions and file hashes), so nothing is invalidated. They are in what a draft stores, so an older draft keeps its words in its file, untouched, and is read in the new ones when the job library loads it. `older-words.test.ts` holds that the version and the token are the same over both, that a rule confirmed over the older words is still confirmed, and that the file is as it was.
- Verified: `pnpm check` exits 0 (241 test files, 3,153 tests passed, 2 skipped; it was 236 and 3,097). Hidden e2e on the rebuilt app, all on stand-ins: `flow.spec.ts` (27), `rule.spec.ts` (3), `teacher-menu.spec.ts` (4), `drafting.spec.ts` (5), `job-files.spec.ts` (5), `connections.spec.ts` (7), `hub-screens.spec.ts` (14) and `screenshots.spec.ts` (10) pass. Each capture was looked at in both themes, and those that moved only by noise were put back.

**Next**
- Merge the branch into main and release 0.3.1, which then holds the fifth round of rule fixes too.
- Show the six screens to a fresh reader again.

**Open issues**
- The Settings row, its dialog, and the publishing and installing screens still say "token" for the Hugging Face key, as Hugging Face's own site does. The teacher tab, the line before Start training and the notice say "key". Changing the rest touches the hub screens, their specs and captures.
- The time estimate is one figure, 2.5 minutes a task on this computer, whatever build of Glimmer is installed. A computer that does better is told it can't teach in four hours until the person allows more time, which costs nothing, since time is a ceiling.
- When the app can't see why retraining can't run (no trainer in this build, no adapter runtime, a spent compute budget), the notice says "couldn't run here" and leaves the reason to Details.
- The engine's own sentences, which sit under Details and in the teacher's prompt, keep the shared names for the kinds ("Its weights", "What it reads when").

## 2026-10-29 (Thu), a cut value and the person's own words, kept as they are

**Done** (on `rule-fixes-5`, from main at `cf56da3`, the 0.3.0 release; decision 061 amended; no model was called, the GPU stayed off, and every run used stand-ins only)
- Two findings of GPT-6 Sol's read of the fourth round, each with a test that fails without its fix:
  - A value cut short for the teacher could read as the exact id of a row it was not shown. A first-row id of 37 A's and LONG was cut to 37 A's and "...", which row 5 could write as its own id, so the first rows and the examples could tell the teacher the key of a row a check or final-test task can be about. A cut that reads as what a row outside the first five writes (without regard to case, quotes or spacing) is now cut one character shorter, and again, until none does. Examples are cut like cells, to forty characters with the dots, where they were forty-two. A table's description that outgrows its share is cut between lines, so it never ends in half a cell.
  - The description, a text file and a typed answer were trimmed before the teacher read them, and an answer was stored trimmed, which drops the four spaces that open a code block in Markdown. They go as written now and an answer is stored as typed. Only a copy is trimmed, to tell a blank message or to match a choice, and the passage an answer holds is still found. The two typing boxes (`Composer`, `ReplyComposer`) still drop the spaces and blank lines at the very start and end of a message before it is sent; the decision names that a known limit.
- Verified: `pnpm check` exits 0 (236 test files, 3,097 tests passed, 2 skipped; it was 236 and 3,082). Hidden e2e on the rebuilt app: `rule.spec.ts` (3) and `drafting.spec.ts` (5) pass. Each fix was switched off in turn, and the tests written for it failed.

**Next**
- Merge the branch into main and release 0.3.1.

**Open issues**
- A message typed in the Describe or reply box loses the spaces at its very start and end on the screen. Sending it whole would also change the workspace chat, which uses `Composer`, so it was not changed here.

## 2026-10-29 (Thu), release 0.3.0

**Done**
- Merged the change menu (79fcf11, decision 063, after GPT-6 Astra's two findings were fixed) and the fourth round of rule fixes (40e763f). `pnpm check` exits 0 on main (236 test files, 3,082 passed, 2 skipped) and CI passed on the release commit.
- GPT-6 Sol read the fourth round against the principle decision 061 now states: every earlier finding is fixed. Two small ones remain for a 0.3.1 and are with the rule's builder: a value clipped for display could equal another row's literal key, and the person's words lose leading spaces before the teacher reads them.
- Released 0.3.0 (cf56da3, tag v0.3.0): installers for Windows and both Macs, built and checked by the release workflow, with plain notes. The website's deploy was held until the installers were attached, so its Windows link never pointed at a missing file; it now links 0.3.0. The 0.2.0 notes point to the fix for their known issue.

**Next**
- Merge the small fifth round of rule fixes and release 0.3.1 with it.
- The offline-chat scene of the film, when the owner allows the GPU; then the full film.

## 2026-10-29 (Thu), what the teacher is told of the records, said exactly

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

## 2026-10-29 (Thu), two findings of the read of what the teacher may change, and main merged in

**Done** (on the same branch; decision 063 amended; no model was called or loaded, the GPU stayed off, and every run used stand-ins only)
- GPT-6 Astra read the branch: no invariant breached, and two bugs, each reproduced and fixed with tests that fail without the fix.
  - An improvement with nothing to try could get stuck. Its training ended for that reason and the planner froze it before the step that hands its lessons back, and freezing asks the model on this computer for its build. With that model stopped, the run paused with its lessons still assigned to it, and Resume met the same failure. An improvement that kept no change has no candidate to freeze, so the planner now takes it straight to the step that hands the lessons back, whatever ended its training (`plan.ts`). A training run that kept nothing and has nothing to try needs no model either: it ends stopped without a freeze, which a test now holds with the model stopped.
  - Self-reflection's permitted change was refused. Its reply format has no field for the kind, so every reply read as a procedure, and with procedures off a valid change to `retrieval.yaml` was refused as "the mentor chose a procedure", with a retry that could not fix it. A blank job met the same after its first draft. A reply that names no kind now stands for the kind its files belong to, which is what its record shows, and is judged by those files against the round's menu, a comparison's included: the refusal names the file and the switch. A kind the mentor names is held to the menu as before. A change to decoding or guardrails alone is refused where no kind of change to the harness is on.
- Main was merged in (the rule's second and third rounds of fixes, the demo recorder and docs). The only conflict was the top of this file, where both sets of entries are kept, newest first.
- `rule.spec.ts` asked this computer's own model runtimes and its graphics card, through Define's pre-flight, which the rule against using the card forbids. It now answers that call itself with one line, the way `flow.spec.ts` does, so the spec runs on stand-ins only. Its other lines are as main has them.
- Verified: `pnpm check` exits 0 after the merge (235 test files, 3,062 tests passed, 2 skipped; the 2 skipped are the recipe's Python tests, which skip when Python isn't found). Hidden e2e on the rebuilt app, all on stand-ins: `teacher-menu.spec.ts` (4), `rule.spec.ts` (3) and `flow.spec.ts` (27) pass. Each fix was taken out again and the new tests failed: the planner's rule fails its own test and the improvement's, the direct stop of a run that kept nothing fails the training-run test, and the code as the read found it, a label read for every reply and a kind that defaults to a procedure, fails all five tests of replies that name no kind.

**Next**
- Merge the branch into main.

**Open issues**
- A reply that names no kind is recorded as the kind its files belong to, so a self-reflection round that changes retrieval reads as retrieval in the rounds list, where it used to read as a procedure. A change to files of two kinds is recorded as the first of them the job allows.
- A student's own change to decoding or guardrails belongs to no kind, so it is judged by the one rule that some kind of change to the harness is on.

## 2026-10-29 (Thu), the person chooses what the teacher may change

**Done** (on a branch from main; decision 063; no model was called or loaded)
- Each round Spark picks one of five kinds of change: a procedure, retrieval, a helper, weights or a question for the person. A job can now say which of them it may use, with an optional `interventions` list. It reads as all five when absent, so every job file, package and saved job is as it was. The list has to keep one kind that changes the agent, since a teacher that may only ask teaches nothing, and it names each kind once. The types moved to `packages/shared/src/interventions.ts`: `job.ts` holds the choice and `mentor.ts` already imports from `job.ts`, so they could not stay in `mentor.ts` without a cycle.
- Where it travels, decided for each place a job crosses: job files, `jobs.save` and every job route over IPC carry it, as a setting of the job like the budget; a run reads its own copy from its start, so a change applies to the next run; a graduate's contract and package leave it out, since training settings aren't part of what an agent promises and the manifest's schemas are strict. Both ends are tested.
- The engine refuses each kind the job turned off with "Turned off for this job in the teacher's settings.", ahead of every other reason (the backend isn't even asked about weights the person turned off). The teacher is told which are off, its reply format offers only the rest, a plan outside them is rejected, and a comparison's fixed menu still applies on top. The label of a change is the teacher's word, so a change set is also held to the choice by the files it writes: a procedure that writes `tools/sum.js` is refused when small tools are off. The first draft of a job that starts blank, which is the sample job and every drafted job and which no menu is asked about, is told what is off and goes back with the reason once. Worked examples need retrieval, since a retrieval rule loads them.
- A teacher that may change nothing, because only questions are on or the rest can't run here, ends its run before it asks for anything: before the baseline and before each round, with the new stop reason `nothing_to_try` and a sentence that names what is off and what can't run. No mentor call, round or attempt is spent. With nothing kept the run ends stopped, as a stop before any change does; an improvement hands its lessons back and gives the sentence as the reason nothing can be promoted.
- Teach this trains no weights and puts no question to the person when the job turned them off.
- Teacher tab: the section "What Spark may change" has an icon, a name, one short line and a switch for each kind. The last switch that changes the agent stays on and says why. The weights row says what the app already knows keeps them from running here: the final test online, no Hugging Face token, no training budget. Define says before Start training when only weights are left and can't run ("Spark has nothing it may change", with a button to the tab). A round that asked for a turned-off kind says in its page that it was the person's choice. A run that ended with nothing to try says so on the Train screen.
- Captures looked at in both themes: `flow-advanced-teacher`, `flow-advanced-teacher-last` (the held switch, wrapped note and dimmed switch read fine in both) and `teacher-idle`. The captures flow.spec rewrote that came out a few pixels different were put back.
- Verified: `pnpm check` exits 0 (233 test files, 2,994 tests passed, 2 skipped). Hidden e2e: `teacher-menu.spec.ts` (4, the real engine with a scripted teacher and a stand-in student; local runtime detection stubbed) and `flow.spec.ts` (27) pass. Each rule was checked by taking its code out and watching a test fail: 22 in the unit tests (the menu, the worked examples, the file check, the draft's prompt and its hold, the check before the baseline and before a round, the improvement's ending, Teach this's three, the switch that holds, the order of what blocks weights, the need, the person's-choice sentence, the validation and its tab, the panel's lines, the words and the stored form) and the two screens in the e2e.

**Next**
- Merge the branch into main. Main was merged into it afterwards, in the entry above.
- Look at the Teacher tab once with a real Spark on a drafted job: turn small tools off and watch the first draft leave them out.

**Open issues**
- A job made in the app can't train weights: nothing in it gives a job a training budget (`maxComputeUsd` has no field), so the weights row says "This job has no budget for training" once a token is added. A field for it is a spending decision, so it was left.
- The pre-flight sees the final test, the token and the budget. It can't see the adapter runtime or whether the teacher can act as the agent, which the engine still checks when a round begins, so a run can still stop there for those.
- The files are placed by their names. Decoding and guardrails belong to no kind, so they stay open whenever any change to the harness is.
- A lesson the person applies with Teach this is their own act, so a turned-off instruction doesn't stop it.
- A new job has everything on. There is no default for new jobs in Settings.
- The first runs of the real-engine spec, before the rule against using the graphics card arrived, let Define's pre-flight ask this computer's local runtimes which models they hold and ask `nvidia-smi` for the card's name and memory. Those are reads, and nothing was loaded. The spec now answers that call itself, so nothing in it reaches a runtime or the card.

## 2026-10-29 (Thu), the film's working cut, no GPU, and the event's rules checked

**Done** (Spark and online Glimmer called for the film's job; the GPU is now off for good, see below)
- The owner said "dont utilize gpu" while a recording had loaded the 2-bit Glimmer for the offline-chat scene. The recording was stopped, its app's processes ended, the model unloaded from Ollama, and the scratch records checked untouched. From now on nothing in this repo's work loads a local model; the rule is in the session memory. The owner chose to hold the offline-chat scene's slot and record it later, when about ten minutes of GPU use is fine.
- The event's rules were checked against the event page and the participants' guide (docs/HACKATHON.md, "Judging, as checked on Oct 29"): Architect passes the gate (Build for Your World, Meta's models used for real, not a disqualified kind), the repository is public and MIT-licensed, the first commit is Oct 27, and the 3-minute video is the main thing judged. The submission checklist now lists the Cerebral Valley submission, the video link and the optional X post.
- The film (`apps/desktop/demo/architect.ts`), recorded from the real app in hidden windows:
  - An opening card naming Muse Spark and Muse Glimmer; then Spark drafting the repair desk's pricing job live, its two questions answered by what the shop's policy says, the rule confirmed; the training of that exact job, replayed from its own records; its results; the planned comparison's numbers; a closing card.
  - Takes that came out wrong were thrown away rather than used: one rule left out the policy's half-hour steps (the description now names them), and one answer rule picked "Billed labor only" for what a ticket includes (answers are now chosen by what each question is about).
  - The recorder warms a window up before a title until screenshots come quickly, can record a scene's title again into a take that can't be made again, and opens each round a run had. One-second stalls remain where the page changes a lot (typing, attaching files, opening a round), from how a hidden window paints.
- The third round of rule fixes was merged (1becb12) and GPT-6 Sol read it: four of its findings are fully fixed, and three more paths by which record values could reach the teacher went to the rule's builder as a fourth round, with the precise statement of what the teacher may and may not see (decision 061 is being amended to say it exactly).
- GPT-6 Astra read the teacher's change menu (decision 063, on its branch): no invariant breach, two P2 bugs (an improvement with nothing to try could stall at the freeze; self-reflection's replies were all taken as procedures). Both went back to its builder with main to merge.

**Next**
- Merge the fourth round of rule fixes and the change menu once each passes; release 0.3.0.
- Record the offline-chat scene when the owner allows the GPU, then assemble the full film (under three minutes).
- Draft the submission text and an X post for the owner.

**Open issues**
- The film has no sound. A disclosed generated voice-over would help it; the owner's call.


## 2026-10-29 (Thu), what the teacher reads of the records, and a fifth thing seen in use

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

## 2026-10-29 (Thu), the rule read again by GPT-6 Sol, and two things seen in use

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

## 2026-10-29 (Thu), the rule on main, a drafted pricing job trained for real, and the demo's first scene live

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

## 2026-10-29 (Thu), main merged into the rule branch, three times

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

## 2026-10-29 (Thu), the first real session on the rule, and fourteen fixes from it and two reviews

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

## 2026-10-29 (Thu): four things a review found in the app, fixed

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

## 2026-10-29 (Thu), a recorder for the demo

**Done**
- A developer tool in `apps/desktop/demo`, written by GPT-6 Sol through Codex and checked here: a scene script (routes, clicks, typing at a human pace, waits, scrolls, the native file dialog, window size), frames captured from the hidden window with their real timestamps, a drawn pointer and click ripple, title cards in Architect's look, a speed-up mark for long waits, and ffmpeg assembly into a 1440x900, 30 fps H.264 video with cross-fades. It has its own Playwright config, so `pnpm e2e` never runs it, and it never writes a key.
- Its sample, on the stand-in engine, recorded a 10.6 s video in 16 s; frames from it show the cards, the pointer and the screens cleanly. Codex's sandbox couldn't launch Electron or commit from a worktree, so the run and the commit were done outside it.

## 2026-10-29 (Thu), a rule a person can confirm, and the first things a reviewer meets

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

## 2026-10-29 (Thu): new jobs take your choices, and a run says what it needs

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

## 2026-10-29 (Thu), the first real drafted job, end to end

**Done**
- A fresh dataset nobody had seen (a made-up bike repair shop: 40 customers, 180 tickets with messy hours and costs, a short policy) went through the whole journey with real models, using the new `scripts/draft.ts` and `scripts/run.ts --job`:
  - Spark drafted it in one call ($0.02) from one sentence and three files, with no unresolved rules: contact lookups, a customer's open tickets (the policy's "Open, Waiting on parts or Ready", which Spark turned into "status is not Picked up"), and a mechanic's labor hours over a date range.
  - Architect made 90 tasks (8 calibration, 29 practice, 23 check, 30 final test). Six expected answers recomputed by hand from the raw files all matched, including totals over values like " 0.5 " and "$1,204.00".
  - Trained with Glimmer served online: it passed 22 of 23 check tasks before any teaching, above the 90% target, so no round ran, and passed 28 of 30 on the final test (contacts 14/14, open tickets 11/12, labor hours 3/4), typical answer 9.3 s, $0.18 of online Glimmer.
- The Train screen now says when no teaching was needed, instead of waiting for a first round that never comes.
- Merged: getting back to a run (decision 060).

**What it shows**
- The drafted task types are retrieval and arithmetic over the records, which Glimmer already handles well. Teaching earns its keep where a job has rules to learn, as the returns desk's policy showed in comparison 2; the catalog doesn't make such tasks yet.

## 2026-10-29 (Thu), getting back to a run

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

## 2026-10-29 (Thu): a job of your own can be described, drafted and trained

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

## 2026-10-28 (Wed), late night: published, and an audit of what doesn't work end to end

**Done**
- With the owner's go-ahead: release v0.1.0 (the Windows installer and the macOS disk images for Apple silicon and Intel, built by the release workflow from the tag, with plain notes), and the ready-made agent published privately to Hugging Face (`jke-kang/architect-returns-desk`) and installed again by its commit into a fresh data folder (A12 done).
- An audit of the real app, tracing every call a screen makes to the engine, found that describing your own job was never built: `JobDrafter` has no implementation, so the Describe screen ends in an error, and the e2e passed only on stubs. It also found that setup's choice of teacher and model never reaches a job, so the sample job asks for the 4-bit model and has no hosted copy; that finished runs can't be reached again; that a paused run doesn't say why; that the engine can test on the hosted copy and test again later, but no screen offers it; and three Define settings that do nothing.
- GPT-6 Astra reviewed the drafting design: Spark configures templates from a catalog Architect owns (a lookup, a filtered list, a group total) and Architect computes every expected answer; review examples never come from the final test; an attached tasks file never reaches Spark; the report says the tasks came from a Spark-drafted specification.

**Next**
- Three branches: the drafter (decision 058), new jobs and Define (059), and runs you can always get back to (060). Then one real drafting session with Spark on a fresh dataset, through training.
- The website, rebuilt on comparison 2's real run, published on GitHub Pages after the next release.

## 2026-10-28 (Wed), night: comparison 2 shows a gain, and the agent it made ships

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

## 2026-10-28 (Wed), the student's prompt kept inside its context

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

## 2026-10-28 (Wed), night: comparison 1's report says what it measured

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

## 2026-10-28 (Wed), the polish pass

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

## 2026-10-28 (Wed), a ready-made agent that opens through the import

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

## 2026-10-28 (Wed), afternoon: merges, three bugs the real run found, and the comparison started

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

## 2026-10-28 (Wed), the evidence screens

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

## 2026-10-28 (Wed), the comparisons runner made safe to spend (decision 051)

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

## 2026-10-28 (Wed), Teach this, the teaching queue and Improve agent on screen

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

## 2026-10-28 (Wed), one GPU lease for the workspace, the engine, the command and the comparisons

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

## 2026-10-28 (Wed), Hugging Face on screen, an agent's model, and clearer checks

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

## 2026-10-28 (Wed), the comparisons runner

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

## 2026-10-28 (Wed), the versions, export and import screens

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

## 2026-10-28 (Wed), morning: adapter serving, mentoring and the command merged

**Done**
- Merged three branches into main, in this order: adapter serving (decision 041), failure-specific mentoring with Teach this and Improve agent (042), and the `architect` command with Hugging Face publishing (043, 044). Each merge passed `pnpm check`.
- At the last merge, the Hub's migration became 15 (both branches had taken 14). The training worker now gets its Hugging Face token from the same resolver as publishing: the key saved in the app, then `HF_TOKEN`, then Hugging Face's token file. Without a token, weights stay off the intervention menu, as before.

**Next**
- Screens: Teach this, the teaching queue, Improve agent, publishing and the Hugging Face key; then the evidence screens (lessons, experiments, the capability breakdown, step playback); then the comparisons runner for decision 037.
- One GPU lease across the workspace, the engine and the command, so two llama-servers or a llama-server and Ollama never hold the GPU at once.

**Open issues**
- Live Hugging Face validation (A01, A12) waits for a token with write access on an account with credit.

## 2026-10-28 (Wed), the architect command and Hugging Face

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

## 2026-10-28 (Wed), failure-specific mentoring, Teach this and Improve agent

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

## 2026-10-28 (Wed), graduates with an adapter run

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

## 2026-10-28 (Wed), graduate versions and portable packages

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

## 2026-10-28 (Wed), before dawn: two merges, a checker gap, and the plan fixed

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

## 2026-10-28 (Wed), runtime v2: a coding agent's harness

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

## 2026-10-28 (Wed): the adapter runtime and the training worker

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

## 2026-10-28 (Wed), morning: any model

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

## 2026-10-28 (Wed), the expanded spec arrives

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

## 2026-10-28 (Wed), early morning

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

## 2026-10-28 (Wed), overnight

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

## 2026-10-27 (Tue), a second sample job

**Done**
- `examples/gear-returns` (decision 028): Returns desk at Larchwood Outfitters, a made-up outdoor-gear shop, as of Tuesday, November 24, 2026. 180 tasks: 60 refunds written to returns.csv, 60 order questions, 60 pickups written to pickups.csv. The policy states every rule with an example. In 17 to 22 percent of the rows of each exported table a date, an amount, a SKU, an email or a category code is written another way; the first five rows of every file are plain. 88 tasks turn on such a value. The package README has the details.
- Tests: the reference solutions use only the student's built-in tools and solve every task in at most 12 turns; a second implementation of the policy agrees with every task; the checker passes every ground truth, in node and in the engine's sandbox; no answer is right for more than three tasks of a type; with the runner's split, train attempts read rows written another way in every exported table.

**Next**
- Calibrate the bare student on it (calibration and dev on hosted Glimmer), then run the comparison as decision 028 says.

**Open issues**
- Not run on any model yet. `category_map.csv`, the key to the old codes, is the one table written plainly throughout.

## 2026-10-27 (Tue), installers

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

## 2026-10-27 (Tue), Phase 0 into Phase 1

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
