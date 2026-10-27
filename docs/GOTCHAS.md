# Gotchas

Things that bit us, and how to avoid them. Newest first.

## Electron 45 has no postinstall download

Electron 45's package no longer downloads its binary on install; it ships an `install-electron` script instead, and on this machine that script stalled at 0 bytes. Fix: download `electron-v45.0.0-win32-x64.zip` from the GitHub release, check it against `SHASUMS256.txt`, unzip it into `node_modules/electron/dist`, and write `electron.exe` (macOS: `Electron.app/Contents/MacOS/Electron`) into `node_modules/electron/path.txt`.

## pnpm 12 blocks dependency build scripts

pnpm 12 runs no install scripts unless the package is listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>` edits it). It also refuses very new releases unless they're listed under `minimumReleaseAgeExclude`.

## Muse Glimmer is a dense 30B model

The Ollama tag `muse-glimmer:30b` is 18 GB at 4-bit. On a 12 GB GPU it spills about 7 GB into system memory, so generation speed depends on free RAM and memory bandwidth. Check available memory before a long local run; other programs holding RAM will push the model into paging.

## typescript-eslint caps the TypeScript version

typescript-eslint 8 supports TypeScript below 6.1. Keep the workspace on TypeScript 6.0.x until that changes.

## The Meta Model API key name

The Meta docs call the key `MODEL_API_KEY`, and the OpenAI SDK does not read it automatically: pass `apiKey` explicitly. In the app the key comes from Settings, never from the environment.
