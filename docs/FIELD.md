# Field specialists: the plan

Adopted on Oct 30 from `docs/SPEC_FIELD_SPECIALIZATION.md`, at the owner's word: make Architect more ambitious and useful in the real world, keep the one-job version as a fallback (`base/one-job` branch, `base-one-job` tag), and build on top of it. This page is the working plan and the contract every branch builds against. Where it differs from the field spec, it wins; where it says nothing, the field spec and `docs/SPEC_EXPANSION.md` hold.

## The claim

Architect turns an organization's own material into a specialist that runs on its own computer. Spark studies the material (the question bank, the topics, the lessons, the records, the policy), writes the specialist's skills, tools and practice, teaches Glimmer, and qualifies it on organizations it never saw, one of them real. The bigger picture, stated as direction and not as a result: the same loop run across many organizations of one field yields verified curricula and checkable rewards, which is what field-specific models need.

## The flagship: Phil, a tutor for a test-prep academy

Phil helps a student right after a wrong answer. It knows the academy's own curriculum: its topic labels and rule numbers, its question bank, its lesson videos, each student's history and the academy's tutoring policy.

**Organizations.**
- Synthetic academies, generated from seeds (`examples/academy`): each has its own topic taxonomy and naming, question bank with full text (math generated with exact answers and the key intermediate value; grammar items generated from rules, each wrong choice tied to a named error), video catalog, students and attempt history, and a `policy.md` whose numbers differ (how many practice questions to assign, the difficulty band, when to escalate to staff, the hint rule). Public and committed.
- A real academy, anonymized (it uses the owner's Lectern platform; called "Real academy" everywhere in the repo): pulled read-only through the Lectern connector, every name, email, id and free-text note replaced or dropped, video passcodes dropped, dates kept. Never committed; it lives in `C:/JakeOS/projects/architect-runs/academy-real/` and is used only as an organization the student never trained on. The platform's read-only connector gives labels, correct and chosen answers, difficulty and history, not question text, so on the real academy Phil is qualified only on the skills those records check (below), unless the owner exports the question text.

**Skills** (task types). Every one is checked by a deterministic checker; wording is never scored.
| Type | The request | What is checked |
| --- | --- | --- |
| `diagnose` | a student missed question N, chose X | the topic label, the correct choice, and (synthetic) the named error behind X |
| `solve` | work the question | the answer and the key intermediate value |
| `hint` | a first hint before the student tries again | `{ topic, hint_id }` from the academy's approved hint catalog for that topic |
| `history` | how is this student doing on this topic | accuracy on the topic over the policy's window, with counts; whether escalation is due |
| `assign` | set the follow-up practice | rows written to `assignments.csv`: the policy's count of questions of the same topic, not yet attempted by the student, in the difficulty band; nothing else written |
| `after_wrong` | the whole tutoring turn | diagnose, hint, assign and, when the policy says so, a staff note in `staff_notes.csv`; facts and end state together |

On the real academy (no question text): `history` and `assign` fully, and `diagnose` for the topic and correct choice.

## The contract (frozen before branches diverge)

1. **Organizations in a job.** `job.json` may list `organizations: [{ id, name, synthetic, role }]`, role `train` or `transfer`. Each organization's files sit at `orgs/<id>/data/` in the job folder (`policy.md` among them). A job without `organizations` is a one-organization job exactly as today.
2. **Tasks name their organization.** `Task.org` (optional; required when the job lists organizations). The task's `data/` binds to its organization's folder; the checker gets that folder.
3. **Splits.** Tasks of `train` organizations split as today (calibration, train, dev, test, family-stratified). Every task of a `transfer` organization is test-only and sealed in the vault with the test split; the mentor never sees a transfer organization's name, files, tasks or scores (invariant 1 covers them). A transfer organization's files are opened only by the runner when the frozen candidate takes its tests.
4. **One specialist.** The harness is shared across organizations; facts come from each organization's files. The mentor's prompt says so, and a lookup table of one organization's facts in the harness is refused like a lookup table of answers.
5. **Qualification.** After freeze, the locked test runs on the train organizations' test split and on each transfer organization. Results are kept per skill and per organization, labeled seen or unseen and synthetic or real. Hard failures (a write the task didn't ask for, a hidden-test read, a non-local call from the graduate) fail the task whatever the average.
6. **Installing for a new organization** is the existing rebinding: the graduate's `data/` points at that organization's folder. An install check is not a qualification.

## Amendments after the second reading (Oct 30, GPT-6 Astra)

- *Transfer organizations are sealed as snapshots, not just tasks.* Their files and tasks live in a runner-only transfer store outside the job folder the mentor reads (hashed at seal time), are removed before ordinary splitting, and are opened only after the candidate is frozen. Study, traces sent to Spark, lineage and exports never carry them.
- *Binding is per attempt.* The student and the checker get the same scratch snapshot of the task's organization, replay included. Task ids are unique across organizations; families never cross organizations.
- *A hint is chosen, not written.* Each topic has a small catalog of approved first hints (`hint_id`, text) in the academy's files; `hint` and `after_wrong` answer with `{ topic, hint_id }`, checked exactly. A keyword filter cannot prove a hint gives nothing away; a reviewed catalog can.
- *`diagnose` names the distractor's constructed error*, from an evaluator-owned map (ambiguous distractors list a set). It is not a claim about what the student was thinking. On the real academy it is topic and correct choice only.
- *`solve` asks about a question given in the request*, not one in the keyed bank, so the answer key can't be read off. `history` states its cutoff date, window, what counts (first attempts or every attempt) and the denominator; `assign` states what happens with too few eligible questions (assign all eligible and say how many) and allows no duplicates.
- *Academy facts stay in the academy's files.* Study writes the shared procedure and the brief, never per-academy tables or per-topic files of one academy's facts. The lookup guard is a heuristic, not proof; transfer is shown by the measurements (dev tasks change labels and policy numbers while the harness stays fixed).
- *Cut now:* weights, source-provenance machinery, automatic per-topic knowledge files, study-screen polish. Keep a small cited brief and the whole tutoring turn.
- *Dates:* scope frozen Nov 1, candidates frozen Nov 2, Nov 3 for qualification and recording. Hosted results are hosted results; Phil's local qualification is marked unmeasured unless hardware is allowed.
- *The demo:* the same wrong answer at two academies with different policies, the same frozen Phil, two different correct actions.

## Architect gains (generic, not tutor-specific)

1. **Study** (the field spec's research stage, bounded to the organization's own material): on Define, Spark reads the material and proposes a study brief: the skills, how they connect, what each needs, the rules it found (each with its passage), what is unclear, and what is out of scope. The person confirms. Then Spark writes the specialist's knowledge: a `skills/<topic>/SKILL.md` per topic, an index from topic to lessons and questions, and the procedure. Uncited claims are marked as Spark's own.
2. **Organizations** in the engine (the contract above).
3. **The report** shows a skill by organization grid: seen academies, an unseen synthetic academy, the real academy, with counts; proposed, practiced and qualified kept apart.
4. **Phil in the workspace**: a staff member or student asks after a wrong answer; writes to `assignments.csv` and `staff_notes.csv` ask for approval.
5. **Weights**: cut for this delivery (see the amendments); the existing training worker stays as it is.

## Lanes

| Lane | Branch | Owns |
| --- | --- | --- |
| Academy field | `field/academy-example` | `examples/academy`: generator, policies, tasks, reference solver, checker, tests |
| Organizations | `field/orgs-engine` | shared schemas, runner binding, splits, vault, transfer qualification, per-org scores |
| Study | `field/study` | the study brief and knowledge writing in drafting, the Define screen |
| Report and workspace | `field/report` | the skill by organization grid, Phil in the workspace |
| Real academy | outside the repo | the anonymized real academy snapshot in the academy schema, and a check of the reference rules against Lectern's own computed reports |

Integration branch: `field/main`, merged into `main` only when `pnpm check` passes and the app still runs the one-job sample. Runs (hosted, frugal, caps stated first): calibrate, teach on synthetic academies, freeze, qualify on the unseen synthetic academy and on the real academy.

## Cut lines

Cut in this order if time runs short: weights, the study screen's polish, the real academy's `diagnose`, the unseen synthetic academy (never the real one). Never cut: the vault around transfer organizations, deterministic checks, the offline graduate.
