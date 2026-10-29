# Gotchas

Things that bit us, and how to avoid them. Newest first.

## A cached read doesn't hear what happened while its screen was closed

The renderer's query cache (`api/query.ts`) reads a key when it is first asked for and keeps it, and a screen hears the engine's events only while it is open. A run's records and detail change with nobody looking: Spark asks a question, a test on this computer ends or stops. Coming back, the screen showed its last visit: a question as a placeholder that no read was filling, a test that said "Testing" for good, with no verdict and no Try again. Data a run changes is read with `refreshOnMount`, which reads it again whenever a screen using it opens (`useRunDetail`, `useMentoringRecords`). And an ask for a key that is already being read is answered by one more read that starts after it (`fetchQuery`), since the read under way may have started before the event that made the ask, and would keep the old answer. A new screen that shows something a run changes needs the same option. Decision 062.

## A prompt that fills the 16K context is cut off, and Ollama calls the cut call unreadable

`num_ctx` is the whole window, the prompt and the reply together. When a conversation fills it, the runtime stops the reply wherever it is (Ollama's log says `stop processing: n_tokens = 16383, truncated = 1`), and when that is inside a tool call, Glimmer's parser says "missing ATEM function_calls wrapper", the same words as for a call the model wrote badly (decision 053). On Oct 28 the returns desk's agent met it three times in a row after seven reads of 60 to 200 rows. Tables spend tokens fast: a digit costs about a token in Glimmer's vocabulary, so a read of 119 lines of `orders.csv` is 4,704 tokens, and a 16K context holds about two of them beside the instructions and the tool list (about 1,100 tokens). The loop now keeps every prompt inside the context less the reply's room and clears the oldest tool results to do it (decision 057). If a run on this model still fails with a parse error, look in Ollama's log for `truncated = 1` before blaming the model's calls. A job that reads a lot is better with a 32K context (`contextLength` in the job's student settings), which docs/MODELS.md puts at about 0.2 GiB more for this model (an estimate). To count tokens, `llama-tokenize -m <the GGUF> -f <file> --no-bos --show-count` from a llama.cpp folder reads the vocabulary only and loads no weights; `CUDA_VISIBLE_DEVICES=-1` keeps the GPU out of it.

## A wait on `AbortSignal.timeout` doesn't keep a command running

Node's `AbortSignal.timeout` doesn't hold the process open, and the clock's `timeout` is built on it. In the app something else always keeps the process alive, so waits there were fine. In a command, a wait was sometimes the only work left: the comparisons runner, retrying after OpenRouter dropped a connection, said it would try again in 30 s and then exited with code 0. Waits that stand for pending work (retries, a training job checked again later) go through `waitOnClock`, which holds the process until the wait ends. Deadlines (the GPU window, the time budget) stay on the bare timeout, so they never keep a finished command alive.

## llama-server reports its build inside parentheses now

Build 10472 prints `version: 0.1.1-dev (build 10472, commit 60eeeb608)`. Older builds, and the test stand-in, print `version: 10472 (60eeeb6)`. Reading the first number after `version:` took the real build for build 0, so Settings would have called a current llama.cpp too old and every agent with trained weights would have been blocked. The parser now reads `(build N, commit C)` first. A stand-in proves only the format it prints; check a parser against the real program's output.

## A stubbed engine channel stays stubbed for the rest of the spec

`stubEngine` replaces a channel's handler in the main process, and nothing puts the engine's own back, so a later test in the same app gets the earlier stub. In `apps/desktop/e2e/screenshots.spec.ts` the dark theme's run routes ask the engine itself and show "There is no run", while the light theme's run after the sample replies were installed and show the sample run (`train-light`, `report-light`, `improvement-light`). A spec that needs the engine's own answer again stubs that answer itself, or launches a new app.

## A reload in an e2e spec keeps the route, and a read that failed stays failed

`page.reload()` keeps the location hash, so the app comes back on the screen the last test ended on, and asks the stand-in engine just installed for records it doesn't have yet. The renderer's query cache keeps that error, and a screen mounted on the same key later shows it instead of asking again. A spec that reinstalls its stand-in between tests sets the hash to `#/` before it reloads (`apps/desktop/e2e/teaching.spec.ts`).

## A toast's text is on the page twice for a moment

Radix's toast also announces its message for screen readers, in a hidden `role="status"` element ("Notification Exported Service desk ..."), for about a second after it opens. An e2e check like `page.getByText('Exported Service desk')` then matches two elements, and Playwright stops on a strict mode violation, so it passes or fails by timing. Match the toast's own text exactly (`getByText('Exported Service desk', { exact: true })`). It failed `versions.spec.ts` once in a full hidden run.

## A busy computer makes a server slow to say who it is

Before a llama-server starts in a folder, the one that folder's record names is stopped, but only once it answers to the record's key, since the record's process id may belong to another program by now. That check once gave the server 2 seconds. A server slower than that, as the stand-in can be in a full test run with many processes starting at once, was taken for another program and left running, and the new server started beside it: on a real GPU, two models at once. A test of it failed once that way under load. The check now waits 10 seconds; nothing listening, or another program, answers at once anyway. `local-runtime.test.ts` keeps an orphan that takes 2.5 seconds to answer (`--fake-list-ms`).

## Vitest run from a package's folder misses the root config

The only Vitest config is the repository root's `vitest.config.ts`, which sets a 20-second test timeout. `npx vitest run` from inside `apps/cli` or a package finds no config there and falls back to Vitest's 5 seconds, so a slower test, such as the command's run against a stopped model runtime (about 9 seconds while the client retries), fails there and passes in `pnpm test`. Run a subset from the root instead: `npx vitest run apps/cli` or `npx vitest run packages/engine/test/gpu-lease.test.ts`.

## A loading llama-server answers "Loading model" before it checks any key

While llama-server loads its model, it answers API requests with 503 and "Loading model" before it checks the API key. So a server can't prove it is the one a record names until it has loaded. Code that stops a server a dead process left behind (`stopServerLeftIn`) takes a 503 "Loading model" on the recorded port, from the recorded process, as that server, or a holder that died mid-start would leave a 10 GB load running beside the next one. The stand-in llama-server answers the same way.

## On Windows a child process dies with its parent; elsewhere it doesn't

Node (libuv) puts every child it spawns on Windows into a job object that closes with the parent, unless the child is detached, so a llama-server goes when the app or the command that started it is killed. On macOS and Linux it outlives its parent and keeps the GPU until something stops it. The GPU lease stops a server that a dead holder left running before anyone else takes the GPU (decision 046), and a test that kills a holder can't expect its server to still be running afterwards on every platform: `gpu-lease.test.ts` leaves a server running on purpose to test that path.

## The digest Ollama's API reports isn't the digest of the weights

`/api/tags` lists each model with a `digest` that Ollama derives from the model's manifest, so it says nothing about which GGUF weights are underneath. An adapter is tied to the weights, so its `base_digest` is the digest of the GGUF blob the manifest's model layer names (`resolveOllamaModel(...).digest`, which only the adapter runtime reads). Comparing it with the Ollama student's `describe()` would call every base another build. The installation checks of a version with an adapter ask the adapter runtime instead.

## Ollama 0.40 keeps the models it makes in a second manifest folder

`muse-glimmer:30b-iq2`, which Architect makes with `/api/create`, has no manifest under `manifests/registry.ollama.ai/`: Ollama 0.40.9 writes it to `manifests-v2/ollama.com/library/muse-glimmer/30b-iq2`, while models pulled by older versions stay in the first folder. Anything that finds a model's GGUF through the manifests has to look in both (`packages/engine/src/local-runtime/ollama-models.ts` does).

## llama-server sets every adapter a request leaves out to 0

With adapters loaded, a request's `lora` field sets the scale of each adapter it names, and build 10472's help text says the ones it leaves out "default to scale 0.0". A request without the field uses the server-wide scales instead, which Architect starts at 0 (`--lora-init-without-apply`). Name every loaded adapter in every request (the llama.cpp student does), and expect the server to throw away its prompt cache when the scales change between requests.

## electron-builder fails when a GitHub token is set and it finds no repository

With `GH_TOKEN` or `GITHUB_TOKEN` in the environment, electron-builder decides to publish to GitHub and looks in `.git/config` for the repository. A git worktree has no `.git/config`, so it finds none and ends the build, after the installer is already made, with `Cannot read properties of null (reading 'channel')`. `publish: null` in `electron-builder.yml` stops it looking, and the release workflow attaches the installers itself.

## One electronDist is one architecture

`electronDist` in `electron-builder.yml` points at a single unpacked Electron, and electron-builder copies it into every build it makes. An architecture list under `mac.target` would put the same Electron in the arm64 and x64 disk images, and it also overrides the `--arm64` and `--x64` flags. So `mac.target` names no architecture, and the release workflow builds each one on its own with the matching Electron.

## A utility process's output does not reach Playwright

On Windows, `app.process().stderr` carries what the main process prints, not what the engine and agent host utility processes print, so a test can't read the network guard's log line. Test the guard by what it stops instead: `e2e/agent-host.spec.ts` has the model's reply send the host to `localhost.`, which the guard refuses and the machine would otherwise resolve to itself, and checks that the model never sees a request addressed to it.

## Node's fetch gives up on a silent response after 5 minutes

Node's built-in `fetch` (undici) drops a response that sends nothing for 300 seconds. Meta's Chat Completions stream doesn't send reasoning deltas, so a mentor call that reasons silently for longer would fail with a retryable timeout. Mentor calls run at `medium` effort, well under that; raising effort to `high` on very large prompts is where this would show up.

## Electron 45 has no postinstall download

Electron 45's package no longer downloads its binary on install; it ships an `install-electron` script instead, and on this machine that script stalled at 0 bytes. Fix: download `electron-v45.0.0-win32-x64.zip` from the GitHub release, check it against `SHASUMS256.txt`, unzip it into `node_modules/electron/dist`, and write `electron.exe` (macOS: `Electron.app/Contents/MacOS/Electron`) into `node_modules/electron/path.txt`. `scripts/install-electron.sh <win32|darwin> <x64|arm64> [folder]` does these steps from the repository root (Git Bash on Windows), and the release workflow runs it. The zip is 158 MB and arrived at about 250 KB/s here, so expect ten minutes on a slow connection.

## pnpm 12 blocks dependency build scripts

pnpm 12 runs no install scripts unless the package is listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>` edits it). It also refuses very new releases unless they're listed under `minimumReleaseAgeExclude`.

## Muse Glimmer is a dense 30B model

The Ollama tag `muse-glimmer:30b` is 18 GB at 4-bit. On a 12 GB GPU it spills about 7 GB into system memory, so generation speed depends on free RAM and memory bandwidth. Check available memory before a long local run; other programs holding RAM will push the model into paging.

## typescript-eslint caps the TypeScript version

typescript-eslint 8 supports TypeScript below 6.1. Keep the workspace on TypeScript 6.0.x until that changes.

## The Meta Model API key name

The Meta docs call the key `MODEL_API_KEY`, and the OpenAI SDK does not read it automatically: pass `apiKey` explicitly. In the app the key comes from Settings, never from the environment.

## Running the app with real keys while developing

A packaged app reads keys only from Settings. An unpackaged build started with `ARCHITECT_KEYS_FROM_ENV=1` also reads them from the environment, by the names the developer scripts use (`META_API_TOKEN`, `OPENROUTER_API_KEY`, and so on), so it can be run or recorded with real models without typing a key into it. The environment is only read: a key saved in Settings wins, and nothing from the environment is ever saved.
