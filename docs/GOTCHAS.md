# Gotchas

Things that bit us, and how to avoid them. Newest first.

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
