# Comparisons

Each comparison measures whether Spark's teaching makes Glimmer better at a job. Every version of Glimmer takes the same final test of 60 requests that no teaching ever saw, and a fixed checker, not a model, marks each answer right or wrong. The reports are made from the stored records of each run, and nothing in them is edited by hand.

| | Business | Teaching | Final test, out of 60 | Teaching against Glimmer on its own |
| --- | --- | --- | --- | --- |
| [Comparison 1](returns-desk-1.md) | The returns desk that ships with Architect (seed 20261124) | up to 2 rounds | on its own 43, one-shot setup 47, taught 45, Spark itself 60 | +3.3 points (-11.5 to +18.0): no gain shown |
| [Comparison 2](returns-desk-2.md) | A new returns desk (seed 20261029) | up to 8 rounds, $5 of Spark | on its own 44, one-shot setup 38, taught 58 | +23.3 points (+10.9 to +35.9): a gain |
| [Comparison 3](returns-desk-open-1.md) | Comparison 2's returns desk, taught by Muse Spark Open on BaseTen, on a later engine | 2 rounds, $0.19 of Spark Open | on its own 18, one-shot setup 31, taught 39 | +35.0 points (+16.8 to +50.2): a gain |

The intervals are 95% intervals for the paired difference (Newcombe's method). Comparison 2 was planned after comparison 1, and [its plan](returns-desk-2-plan.md) was published before it ran, with two amendments made before any final test was read: a higher spending cap, and a first run that was set aside when the runner opened two arms' final tests before the third had trained.

All three comparisons ran Glimmer online, the full model served through OpenRouter. The agents run on your computer with a smaller build that hasn't taken these tests.

Academy desk, the field runs on test-prep academies, has its own reports. Their sealed tests cover academies neither model saw, one of them real:

- [academy-desk-1.md](academy-desk-1.md): the first field run, with [academy-desk-1-real-academy-misses.md](academy-desk-1-real-academy-misses.md) on its misses at the Real academy, and [academy-desk-1-local.md](academy-desk-1-local.md), the same frozen agent on the 2-bit build that runs on one graphics card.
- [academy-desk-3.md](academy-desk-3.md): the third field run, which replaced a second run that stopped before any result was read, with [academy-desk-3-misses.md](academy-desk-3-misses.md).
- [academy-desk-cert-1.md](academy-desk-cert-1.md): the first live certificate run, on the third run's Academy desk. No certificate was issued.

An offshore wind farm's maintenance desk, run in the app end to end with real models, has its own report: [edge-1.md](edge-1.md). On its sealed final test, Glimmer with Spark's harness passed 32 of 32 and Glimmer on its own 11 of 32, +66 points (+45 to +80), measured with the Lab's Experiments for $0.47 in all.
Inventory desk, which reserves screening labs' compound stock for re-tests, has its own report: [inventory-desk-1.md](inventory-desk-1.md), the first run. Its sealed test covers a generated lab it never saw.
Assay desk, a field of screening labs, has its first report: [assay-desk-1.md](assay-desk-1.md). No gain was shown on the lab neither model saw, and the taught arm's refinement never ran, so it measures Spark's one-shot setup against Glimmer on its own.
The first agent-team run, Inventory desk asking Assay desk as a teammate on plate-only requests, has its report: [team-1.md](team-1.md). Neither the team nor Inventory desk alone passed any of 20 attempts, and the lead asked its teammate in only 2. The second, [team-2.md](team-2.md), after the lead was told when to ask: it asked in 18 of 20 replies, but no ask brought back a plate's list, and both arms passed 0 of 20 again. The third, [team-3.md](team-3.md), after a helper's result too long to show was kept whole for `run` code (decision 106): both arms passed 0 of 20 again. Assay desk used the whole result in only 5 of 47 asks. Once it found exactly the plate's list, then its queueing write ended the reply, since no one could approve it. The fourth, [team-4.md](team-4.md), after a teammate's writes stopped ending the reply and `read` could open the kept result (decision 107): 0 of 8 in both arms, a short run of 8 pairs because the key ran low. Assay desk read the kept result in 15 of 18 asks, but every one of them still ran out of steps or filled its context.
Sweep desk, which reads ML research groups' training runs, has its first report: [sweep-desk-1.md](sweep-desk-1.md). No gain was shown at Fennick Research, the group neither model saw. The leak check stopped the taught arm's only round, because two practice tasks matched final-test tasks, so the report measures Spark's one-shot setup against Glimmer on its own. Its second, [sweep-desk-2.md](sweep-desk-2.md), ran after the generator was fixed: the leak check passed, but the taught arm's Spark cap stopped its first round, so again the draft took the test. At Fennick, the taught arm (the draft's harness) showed no gain over Glimmer on its own, +10.4 points (-3.4 to +23.6); the draft's own run of the same harness did, +16.7 (+2.6 to +29.6).

An earlier comparison, on the service desk sample job with the first version of Glimmer's tools, is described in the README's Results section and in [docs/PROGRESS.md](../PROGRESS.md).

`screens/` holds captures of comparison 2's taught agent in the app, made by opening that run's own records in Architect: its training, its first round and its results page.

Fine-tuning has its own report: [qlora-1.md](qlora-1.md), the first real QLoRA job. Inventory desk's 22 checker-passed practice attempts trained a LoRA adapter on Glimmer's open weights on one A100 on Hugging Face Jobs, in 8.2 minutes for $0.34 (about $0.98 with the three failed jobs that found and fixed three faults). The adapter passes the product's file-level checks against the local base. Its effect on the sealed final test is in [adapter-eval-1.md](adapter-eval-1.md): with the taught harness, on one rented A100 serving Glimmer with and without it, the adapter passed 32 of 32 at Corvid Hill against 22 of 30 without it, +26.7 points (+9.8 to +44.4), 8 wins and no losses. It also dropped Glimmer's reasoning, which may account for part of that. With the blank harness it showed nothing. The GPU cost at most $4.42.

A second fine-tune, [qlora-2.md](qlora-2.md), ran on Sweep desk's export after its generator fix: 6 checker-passed practice attempts, one A100, 5.1 minutes, $0.21, clean the first time. With so few examples the adapter took one update during warmup, so it shows the path on an AI lab's data rather than anything taught.
