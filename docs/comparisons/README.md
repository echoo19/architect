# Comparisons

Each comparison measures whether Spark's teaching makes Glimmer better at a job. Every version of Glimmer takes the same final test of 60 requests that no teaching ever saw, and a fixed checker, not a model, marks each answer right or wrong. The reports are made from the stored records of each run, and nothing in them is edited by hand.

| | Business | Teaching | Final test, out of 60 | Teaching against Glimmer on its own |
| --- | --- | --- | --- | --- |
| [Comparison 1](returns-desk-1.md) | The returns desk that ships with Architect (seed 20261124) | up to 2 rounds | on its own 43, one-shot setup 47, taught 45, Spark itself 60 | +3.3 points (-11.5 to +18.0): no gain shown |
| [Comparison 2](returns-desk-2.md) | A new returns desk (seed 20261029) | up to 8 rounds, $5 of Spark | on its own 44, one-shot setup 38, taught 58 | +23.3 points (+10.9 to +35.9): a gain |

The intervals are 95% intervals for the paired difference (Newcombe's method). Comparison 2 was planned after comparison 1, and [its plan](returns-desk-2-plan.md) was published before it ran, with two amendments made before any final test was read: a higher spending cap, and a first run that was set aside when the runner opened two arms' final tests before the third had trained.

Both comparisons ran Glimmer online, the full model served through OpenRouter. The agents run on your computer with a smaller build that hasn't taken these tests.

Academy desk, the field runs on test-prep academies, has its own reports. Their sealed tests cover academies neither model saw, one of them real:

- [academy-desk-1.md](academy-desk-1.md): the first field run, with [academy-desk-1-real-academy-misses.md](academy-desk-1-real-academy-misses.md) on its misses at the Real academy, and [academy-desk-1-local.md](academy-desk-1-local.md), the same frozen agent on the 2-bit build that runs on one graphics card.
- [academy-desk-3.md](academy-desk-3.md): the third field run, which replaced a second run that stopped before any result was read, with [academy-desk-3-misses.md](academy-desk-3-misses.md).
- [academy-desk-cert-1.md](academy-desk-cert-1.md): the first live certificate run, on the third run's Academy desk. No certificate was issued.

An earlier comparison, on the service desk sample job with the first version of Glimmer's tools, is described in the README's Results section and in [docs/PROGRESS.md](../PROGRESS.md).

`screens/` holds captures of comparison 2's taught agent in the app, made by opening that run's own records in Architect: its training, its first round and its results page.
