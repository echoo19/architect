# Persona testing driver

`qa/driver.ts` opens the built app, hidden, in a ready-made world and keeps it open, so a tester (a person or an agent) can use it step by step over a small JSON API on 127.0.0.1. In the three mock worlds (first-run, personal, lab) nothing real runs: the models are the e2e suite's stand-ins on 127.0.0.1 and its IPC stubs. No remote model, Hugging Face, GPU, or this computer's Ollama or llama-server is reached, and every provider key variable is blanked in the app's environment. The live world is the exception, and real: see its section below.

## Build once

```powershell
pnpm install
pnpm --filter @architect/desktop exec electron-vite build
```

Build again after changing the app.

## Start a world

From `apps/desktop`, one app per driver:

```powershell
node --import tsx qa/driver.ts --world first-run --port 4801 --out C:\tmp\qa-first-run
node --import tsx qa/driver.ts --world personal  --port 4802 --out C:\tmp\qa-personal
node --import tsx qa/driver.ts --world lab       --port 4803 --out C:\tmp\qa-lab
node --import tsx qa/driver.ts --world live      --port 4804 --out C:\tmp\qa-live
```

It prints its address when ready. `--out` defaults to a new temp folder; screenshots go to `<out>/shots` and every act and its result to `<out>/actions.log`.

## API

```bash
curl localhost:4801/snapshot     # {route, snapshot: ARIA tree of the page, truncated}
curl -X POST localhost:4801/act -d '{"action":"click","target":{"role":"button","name":"Continue"}}'
curl -X POST localhost:4801/act -d '{"action":"type","target":{"role":"textbox","name":"Describe the job"},"value":"Answer questions about our orders"}'
curl -X POST localhost:4801/act -d '{"action":"file","value":["C:/tmp/qa-first-run/files/orders.csv"]}'
curl -X POST localhost:4801/act -d '{"action":"route","value":"/models"}'
curl -X POST localhost:4801/shot -d '{"name":"define"}'   # {path} of the PNG
curl localhost:4801/errors       # page and console errors, and system dialogs or links that were swallowed
curl -X POST localhost:4801/quit # closes the app, deletes its profile, stops the driver
```

`/act` takes `action`, an optional `target` and a `value`, and returns `{ok, ms, route, error?}`; `ms` is the time until nothing on screen is loading. Targets: `{role, name, exact?, nth?}`, `{text}`, `{label}`, `{placeholder}`, `{testid}` or `{css}`, each with an optional `nth`. A target that matches several elements fails with the list of them; add `nth` or a fuller name.

| action                                     | value                                                                                |
| ------------------------------------------ | ------------------------------------------------------------------------------------ |
| `click`, `dblclick`, `hover`               | none                                                                                 |
| `fill`                                     | text, set at once                                                                    |
| `type`                                     | text, typed key by key; without a target, into whatever has focus                    |
| `press`                                    | a key such as `Enter` or `Control+k`                                                 |
| `select`, `check`                          | the option(s); `false` to uncheck                                                    |
| `scroll`                                   | pixels for the wheel (over the target, if named); without a value, target into view  |
| `route`                                    | a hash route such as `/fields`                                                       |
| `resize`                                   | `{"width":1280,"height":800}` (the window starts at 1440 × 900)                      |
| `wait`                                     | milliseconds (30 s at most), or a target to wait for                                 |
| `file`                                     | path or paths the next file dialog picks; a dialog with no `file` before it cancels  |

## The live world

**live**: a new profile, not set up, on the real engine with no stand-in and no IPC stub. Spark and the hosted Glimmer are really called, so it spends real money; set the job's caps in the app before training. The app reads two keys from the driver's environment by name, `META_API_TOKEN` and `OPENROUTER_API_KEY` (`ARCHITECT_KEYS_FROM_ENV=1`, which an unpackaged build only honours); every other provider key stays blanked, and nothing reaches Hugging Face. Load each key into the one command that starts the driver, never into a file or the shell's history, and never type a key into the app.

The window is recorded to `<out>/video` (Playwright's `recordVideo`, written when the app closes). On `/quit` the profile's data is copied to `<out>/profile` before the throwaway profile is deleted, so the job, its run, its lineage and its agent stay. To go on from there, such as to resume an experiment after a rebuild, start the live world with `--data <out>/profile` and a new `--out`: the app opens on a copy of that profile, which itself is left as it was.

This computer's Ollama is not stubbed here. Training and the final test on the hosted copy never call it, but a chat with a trained agent, a check that loads its model, or a download does. Leave those alone when the local GPU is not to be used. Run one app at a time, and none while a Playwright run is going.

## What is stubbed in each mock world

Do not report these fixed replies as product bugs.

**first-run**: a new profile, not set up, personal edition. Real engine. The teacher is a scripted one on 127.0.0.1: the first drafting turn always asks whether cancelled orders count, and the next always drafts "Shop desk", whatever was described. The shop's records to attach are in `<out>/files`. The student is a fake Ollama listing Glimmer as downloaded, and it answers `ANSWER: {}` to every task, so training runs for real and ends at 0%. This computer is fixed as an RTX 4070 (12 GB) with Ollama and llama-server ready; downloading another Glimmer build fails.

**personal**: set up, personal edition, on the recorded returns-desk run (`examples/gear-returns/scripts/record-run.ts`, recorded into `<out>/recorded` on first start). The job, run, rounds, evidence and agent are real records read by the real engine. The agent's chat runs in the real agent host against the fake Ollama: it reads `data/policy.md` once, then gives the same approval sentence to every message. Its home has sessions laid out over the days after its version was accepted, which on the recording's clock is Nov 24, 2026. The job now uses the scripted teacher and the fake student, so training it again behaves as in first-run.

**lab**: Lab edition, entirely IPC stubs from the e2e fixtures (fields, organizations, science desks, experiments, models, teams, a certificate on Academy desk's report, fine-tuning data), with the recorded dry comparison (`<out>/comparison`) as Sweep desk's experiment. Keys show as saved but none exists. Start training on any job plays the service desk's story run (about 25 s: rounds 4 to 7 decided, the final test, then its report). A started or resumed experiment finishes 45 s later, and so does every other running one, with the recorded report. Compute reads Glimmer's stand-in config from a fake Hub; a launch bundle is written to the folder you pick, and nothing is submitted. Any agent's chat gives one fixed stand-in reply to every message. Service desk, Academy desk, Inventory desk and Assay desk have sessions from their version's acceptance to now (`e2e/fixtures-activity.ts`), so their homes show activity; Academy desk also has a hosted retest and a meter record of its final test here, and Glimmer shows as loaded. Assay desk counts as taught here, so its agent opens like the others. Changes you make (promotions, new teams, new experiments) last until the driver quits.
