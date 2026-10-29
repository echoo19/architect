# The ready-made returns desk

This is the agent Architect offers under **Try a ready-made agent**: `returns-desk.architect.zip` is the agent, and `data/` holds the records of the shop it works on.

It is the agent Spark taught in comparison 2 ([the report](../../../docs/comparisons/returns-desk-2.md), and [the plan](../../../docs/comparisons/returns-desk-2-plan.md), which named this agent as the one to ship before any final test ran). Spark's teaching took four rounds and kept two changes, both helpers that clean up messy values in the shop's records. On the final test, 60 requests that teaching never saw, it passed 58.

That score was measured with Glimmer served online. On your computer the agent runs on the 2-bit Glimmer build that fits a 12 GB graphics card (`muse-glimmer:30b-iq2`), which hasn't taken that test, so Architect marks the agent as experimental.

The shop is made up. Its records come from the returns desk generator with seed 20261029, and this command writes the same files byte for byte:

```
pnpm --filter @architect/example-gear-returns generate --seed 20261029 --out <folder>
```
