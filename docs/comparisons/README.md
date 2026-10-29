# Comparisons

Each comparison measures whether Spark's teaching makes Glimmer better at a job. Every version of Glimmer takes the same final test of 60 requests that no teaching ever saw, and a fixed checker, not a model, marks each answer right or wrong. The reports are made from the stored records of each run, and nothing in them is edited by hand.

| | Business | Teaching | Final test, out of 60 | Teaching against Glimmer on its own |
| --- | --- | --- | --- | --- |
| [Comparison 1](returns-desk-1.md) | The returns desk that ships with Architect (seed 20261124) | up to 2 rounds | on its own 43, one-shot setup 47, taught 45, Spark itself 60 | +3.3 points (-11.5 to +18.0): no gain shown |
| [Comparison 2](returns-desk-2.md) | A new returns desk (seed 20261029) | up to 8 rounds, $5 of Spark | on its own 44, one-shot setup 38, taught 58 | +23.3 points (+10.9 to +35.9): a gain |

The intervals are 95% intervals for the paired difference (Newcombe's method). Comparison 2 was planned after comparison 1, and [its plan](returns-desk-2-plan.md) was published before it ran, with two amendments made before any final test was read: a higher spending cap, and a first run that was set aside when the runner opened two arms' final tests before the third had trained.

Both comparisons ran Glimmer online, the full model served through OpenRouter. The agents run on your computer with a smaller build that hasn't taken these tests.

An earlier comparison, on the service desk sample job with the first version of Glimmer's tools, is described in the README's Results section and in [docs/PROGRESS.md](../PROGRESS.md).
