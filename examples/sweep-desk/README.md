# Sweep desk: reading a research group's training runs

Sweep desk helps a machine-learning research group read its training runs. Someone in the group asks a question about a sweep ("Did adding warmup help on the 1.3B runs?"), and Sweep desk answers from the group's own files: its sweeps, its runs and their configs, every loss its tracker logged, and the group's policy for reading them. It names a sweep's best config, finds the runs that diverged, says where early stopping would have stopped a run, says whether a change helped, proposes the next round of runs and writes up a sweep. It writes only to `proposed_runs.csv` and `decisions.csv`. `docs/FIELD.md` says why a job covers a whole field.

The job holds four made-up research groups, built from seeds. Three are taught on (Halden Lab, Quill Systems Group, Marlow Learning Group) and one, Fennick Research, is never seen: Sweep desk is never trained on it, and it is there to show whether what it learned carries over to a group whose files and rules it has not met. Every person and group in the files is invented.

## How the groups differ

Every group runs the same kind of sweep, a learning rate and a warmup length over a few seeds, and each keeps and judges its runs its own way, the way real groups' tooling differs:

- **Its date.** Each group's records end on a day of its own, and its requests say what day it is ("It's Tuesday, November 3, 2026."). The job's header date, November 20, is the date of none of them.
- **Metric names.** `train_loss` and `val_loss`, `train/loss` and `eval/loss`, `training_loss` and `validation_loss`, or `loss` and `val_loss`. The policy names them.
- **Steps or epochs.** Three groups log an eval every 500, 250 or 200 steps, and about one run in eight logs every 100 steps instead. Quill logs once per epoch. An eval is one logged validation loss, however often the run logged.
- **Configs.** Halden and Marlow keep the config in columns of `runs.csv`; Quill and Fennick keep it in `configs.json`, by run id. The knobs are called `lr` or `learning_rate`, `warmup` or `warmup_steps`.
- **The scheduler's words.** `status` reads `finished`, `FINISHED`, `done`, `succeeded`, `failed`, `crashed`, `PREEMPTED` and so on, and it says nothing about whether a run diverged: about three in ten runs that blew up still say they finished.
- **The policy.** Written one of two ways: prose with its numbers in a table at the end (`table`), or prose alone with the numbers in its sentences, some in words (`prose`). Every policy has the same kinds of rule with its own numbers.

| Group                 | Role       | Date   | Evals     | Policy | Run score      | Diverged seed        | Factor | Patience, smallest gain | Interval            | Budget | Seeds       |
| --------------------- | ---------- | ------ | --------- | ------ | -------------- | -------------------- | ------ | ----------------------- | ------------------- | ------ | ----------- |
| Halden Lab            | taught on  | Nov 3  | 500 steps | table  | mean of last 3 | left out             | 3      | 4, 0                    | 95% t               | 6      | 0, 1, 2     |
| Quill Systems Group   | taught on  | Oct 20 | epochs    | prose  | lowest eval    | rules the config out | 2      | 3, 0.005                | two std. errors     | 4      | 1, 2, 3, 4  |
| Marlow Learning Group | taught on  | Nov 11 | 250 steps | prose  | mean of last 5 | left out             | 1.5    | 5, 0.01                 | smallest to largest | 6      | 13, 42, 77  |
| Fennick Research      | never seen | Oct 28 | 200 steps | table  | mean of last 4 | rules the config out | 2.5    | 6, 0.002                | 95% t               | 8      | 7, 8, 9, 10 |

The groups taught on use every kind of rule between them. Fennick's divergence factor, patience and seeds are ones no taught group uses.

## The rules

Each policy states these, with its own numbers:

- **A run's score** is the mean of its validation loss over its last few evals, or its lowest eval.
- **A run diverged** if its training loss is ever NaN or infinite, or goes above a factor times its first logged training loss. A loss spike that recovers still counts when it crosses the line.
- **A config's score** is the mean of its seeds' run scores. A diverged seed is either left out or rules its whole config out. The best config is the one with the lowest score.
- **Early stopping** stops a run once its validation loss has gone some number of evals in a row without beating the best so far by more than a smallest gain.
- **Did a change help** pairs the two configs' runs by seed, leaving out seeds either lacks or where either diverged. Each difference is the score without the change minus the score with it. The 95% interval is a t interval, two standard errors, or the smallest to the largest difference. The change helped if the whole interval is above zero, hurt if it is all below, and otherwise it is unclear.
- **Proposing runs**: configs one grid step from the best config, not yet run and not already proposed, each with every seed, as many whole configs as the budget holds.
- **A sweep report** gives the best config, the diverged runs and the best config against the sweep's baseline, and logs one row in `decisions.csv`: `adopt` when the best config helped, `keep` otherwise.

## Files

Every group has the same files in `job/orgs/<id>/data/`, and `configs.json` where it keeps configs apart.

| File              | What it holds                                                         | Rows           |
| ----------------- | --------------------------------------------------------------------- | -------------- |
| policy.md         | the group's rules, in its own style                                   |                |
| sweeps.csv        | sweep_id, name, model, grid, baseline, started_on                     | 8              |
| runs.csv          | run_id, sweep_id, the config at some groups, seed, status             | 112 to 157     |
| configs.json      | each run's config by run id, at Quill and Fennick                     | 157            |
| metrics.csv       | run_id, step or epoch, metric, value                                  | 3,448 to 5,220 |
| proposed_runs.csv | proposal_id, sweep_id, the two knobs, seed, proposed_on (writable)    | 9 to 12        |
| decisions.csv     | decision_id, sweep_id, decided_on, the two knobs, decision (writable) | 3              |

A grid is written `lr=1e-4/2e-4/3e-4/6e-4; warmup=0/500/2000`, with the group's own knob names. Each sweep ran five of its twelve grid points, the baseline among them, with every seed, now and then missing one.

**Written another way.** In about a fifth of the rows of `metrics.csv` past the first five, a metric name comes with other capitals, separators or spaces (`VAL_LOSS`, `Eval/Loss`, `train-loss`, ` val_loss`), or a loss in scientific notation (`3.4988e+00`). NaN and infinity come in the tracker's own spellings (`nan`, `NaN`, `-nan`, `inf`, `Infinity`). About one run in eight is listed newest first, as a resumed run's export does. In `runs.csv` or `configs.json` a learning rate is sometimes `3e-4` or `3.0e-04` for 0.0003. Every form reads back to one value: a metric name to exactly one of the group's two metrics with its capitals, separators and spaces set aside, a loss or a learning rate to its number.

**The losses** come from a simple model of training: a curve that falls toward a floor set by the config and the model size, a seed effect shared by every config of a sweep (which is why pairing by seed matters), noise, some runs that start to overfit, some at high learning rates that blow up to NaN, to infinity or to a large plateau, and a few that spike once and recover. Each sweep is drawn again until every skill's task on it is clear: the best config leads the next by at least 0.004 and is not the baseline, and every verdict asked about stays at least 0.002 away from flipping.

## Tasks

192 tasks: 48 at each group, one of each skill for each of its eight sweeps. Ids carry the group (`halden-did_it_help-03`), and the six tasks on a sweep form one family, so a sweep's answers never leak from practice into the final test. The 144 tasks of the three taught groups split into 12 calibration, 60 train, 36 dev and 36 locked test. Fennick's 48 are for the locked test only. Each task names its group in `org`, and its data folder is that group's.

| Skill          | The request                                                         | What is checked                                                                                            |
| -------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `best_config`  | "Which config won sweep sw-13? Go by our rule for the best config." | the learning rate, the warmup and the config's score                                                       |
| `early_stop`   | "Where would our early-stopping rule have stopped hl-0446?"         | the step or epoch it stops at, and the one of its best eval                                                |
| `diverged`     | "Which runs in sweep S214 diverged by our definition?"              | exactly the runs that diverged, in any order; an empty list when none did                                  |
| `did_it_help`  | "Did adding warmup help on the 1.3B runs?"                          | the number of pairs, the mean difference, the interval's ends and the verdict                              |
| `next_runs`    | "Plan the next round for sweep_5."                                  | the rows added to `proposed_runs.csv` and the count in the ANSWER                                          |
| `sweep_report` | "Write up FS-058 for the group meeting, and log the decision."      | the best config, the diverged runs, the comparison with the baseline, and the row added to `decisions.csv` |

`next_runs` accepts any round that follows the rules: configs one grid step from the best, on the grid, not run and not already proposed for the sweep, each with every seed, as many whole configs as the budget holds (or every config that qualifies when fewer do), ids numbered on from the file, the group's date as `proposed_on`, and nothing else written. In 12 of the 32 rounds the budget holds back configs that qualify; in the rest every config that qualifies fits. Three sweeps at each group already have a proposal, which a new round must not repeat.

Of the 32 comparisons `did_it_help` asks about, 14 helped, 6 hurt and 12 are unclear. 17 sweep reports adopt the best config and 15 keep the baseline. 27 of the 32 early-stopping tasks stop a run before its end. Three sweeps have no diverged run.

## Checker

`src/checker.js`, copied into the job folder, holds the six validators. It reads no clock and no randomness. The expected values come with each task, worked out from the group's true records before any export wrote them (`src/group/rules.ts`). A loss or a difference passes within 0.001, so one rounded to three decimals passes and one from another rule fails. A learning rate passes however it is written. For a proposal round the checker reads the original and the new `proposed_runs.csv` and checks every new row against the grid, the configs the sweep ran, the earlier proposals and the best config. Every validator fails a write to a table the task didn't ask for. A failure's reason starts with the field or table that is wrong.

## Reference solutions

`src/reference/solver.ts` solves every task with the agent's built-in tools only: it reads policy.md, sends one piece of code to `run` that reads the group's files and applies the policy to the sweep the request names, and appends any rows. It knows nothing about any one group: the metric names and numbers come from policy.md, the knob names, grid, configs and ids from the files. What it knows on its own is how training logs differ: configs in `runs.csv` or `configs.json`, knob names in their usual spellings, metric names matched with capitals, separators and spaces set aside, NaN and infinity in any spelling, a run's evals sorted by step or epoch, and `status` left alone. Every task takes at most three tool calls and 6,365 characters of tool results, the policy included.

## Tests

- The committed folder matches the generator byte for byte, and the same seeds always give the same bytes.
- The four groups differ in metric names, logging, knob names, config layout and policy; the taught groups use every kind of rule; Fennick's numbers are new.
- The policy's numbers, in either style, read back to the ones the group was built with.
- Each group has its own date: every request states it, every record is dated before it, and none is the header's date.
- In `metrics.csv`, 15 to 25 percent of each group's rows past the first five are written another way, none in the first five and some in every quarter. Every metric name reads back to exactly one metric and every loss to its value; every learning rate, grid and baseline reads back to its number.
- The checker passes the ground truth and any other round the policy allows. It fails the common mistakes for the right reason: the best config by the other score or the other handling of diverged seeds, a patience off by one, divergence by `status` or by NaN alone, the difference the wrong way round, an unpaired interval, a round over or under the budget, a config already run, already proposed, off the grid or not next to the best, the wrong date or ids, a missing decision row and a write to the other table.
- The tasks split into the sizes the job asks for, every family in one split.
- The reference solutions fit 16 turns and 24,000 characters. Their calls are replayed through the engine's own tools on each group's files, the text they get back is compared, and every task passes the engine's checker.

## Known gaps

- The job has not been calibrated on the bare student yet.
- Every sweep is a learning rate by warmup grid; other knobs (batch size, schedule) sit in the configs but no rule reads them.
- The groups are synthetic. No real group's runs are in the job.

## Regenerate

```
pnpm --filter @architect/example-sweep-desk generate
```
