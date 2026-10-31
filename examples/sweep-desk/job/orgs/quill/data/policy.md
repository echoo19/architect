# Quill Systems Group: reading our runs

This is how Quill Systems Group reads its training runs and plans the next ones. Sweep desk, our assistant, follows it, and so do we.

Validation loss is logged as `eval/loss` and training loss as `train/loss`.

## The files

- `sweeps.csv`: each sweep, with its model, its grid (the values each knob may take) and its baseline config.
- `runs.csv`: each run of a sweep, with its seed and how the job ended. Its config is in `configs.json`, by run id.
- `metrics.csv`: every loss our tracker logged, by run, epoch and metric.
- `proposed_runs.csv`: the runs proposed for the next round. New rows go at the end.
- `decisions.csv`: our decisions log. New rows go at the end.

`status` in runs.csv is what the scheduler wrote when the job ended. It says nothing about whether a run diverged; that is decided from the losses alone, as below.

## Evals

An eval is one logged validation loss. Evals are counted in epochs and taken in order of epoch, however often a run logged.

## A run's score

A run's score is its lowest validation loss at any eval.

## Divergence

A run diverged if its training loss is NaN or infinite at any eval, or goes above 2 times its first logged training loss, the one at its earliest epoch.

## The best config

A config is a learning rate and a warmup length; its runs are its seeds. A config's score is the mean of its seeds' run scores. If any seed of a config diverged, the config is ruled out: it has no score and cannot be best. The best config of a sweep is the one with the lowest score.

## Early stopping

We stop a run once its validation loss has gone three evals in a row without improving. An eval improves when it is lower than the best so far by more than 0.005. The run stops at the eval that makes it three in a row, and its best eval is the best so far at that point. If that never happens the run goes to its end, and stops at its last eval.

## Did a change help

Compare the config with the change against the config without it, seed by seed. Pair the two configs' runs that have the same seed, leaving out a seed either config lacks and a seed where either run diverged. Each difference is the run score without the change minus the run score with it, so a difference above zero means the change lowered the loss. With n pairs, the mean difference is their mean, and the 95% interval is the mean plus or minus two standard errors, 2 x sd / sqrt(n), sd being the standard deviation of the differences (dividing by n - 1). The change helped if the whole interval is above zero and hurt if it is all below zero; otherwise it is unclear. Fewer than two pairs is no comparison.

## Proposing the next runs

A proposal round adds at most four runs to proposed_runs.csv. Propose configs one grid step from the sweep's best config: one knob moved to the next value up or down on the sweep's grid, the other kept. Leave out a config the sweep has run with any seed and one an earlier row of proposed_runs.csv names for the sweep. Each config goes in with every one of our seeds, 1, 2, 3 and 4, so a round proposes as many whole configs as fit in it, or every config that qualifies when there are fewer. Number the rows on from the last proposal_id, and date them with today's date.

## Writing up a sweep

A sweep report gives the best config with its score, the runs that diverged, and how the best config compares with the sweep's baseline from sweeps.csv, the baseline being the config without the change. Record it in decisions.csv: one row, numbered on from the last decision_id, dated today, with the best config's values and the decision, `adopt` when the best config helped against the baseline and `keep` otherwise.

## Numbers

Give losses and differences to three decimals.
