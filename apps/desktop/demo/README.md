# Hidden demo recorder

Build Architect, then run a TypeScript scene script from `apps/desktop`:

```powershell
pnpm --filter @architect/desktop exec electron-vite build
cd apps/desktop
pnpm exec playwright test --config demo/playwright.config.ts record.spec.ts
```

The sample uses the e2e stand-in engine and a repository file. It makes no model call. The recorder uses `launchApp`, which creates a throwaway profile and forces `ARCHITECT_HIDDEN=1`; each scene checks that the Electron window remains hidden. Work frames, measured timestamps (`frames.json`), concat lists, and intermediate segments are written under `demo/work/`. The final MP4 is 1440×900, H.264, 30 fps, without audio. Run `pnpm exec playwright test --config demo/playwright.config.ts timeline.spec.ts assemble.spec.ts` from `apps/desktop` for the recorder's isolated tests. The normal `pnpm e2e` config points only at `e2e/`.

Export a default `DemoScript` from a new `.ts` file. Set `ARCHITECT_DEMO_SCRIPT` to its path and `ARCHITECT_DEMO_OUTPUT` to the MP4 path before running `record.spec.ts`; the defaults are `demo/sample.ts` and `demo/work/sample.mp4`. To record some scenes only, set `ARCHITECT_DEMO_ONLY` to their names, separated by commas; to use a scene's earlier capture under the same output name again, name it in `ARCHITECT_DEMO_REUSE`, or in `ARCHITECT_DEMO_RETITLE` to keep its steps and record its title card again. A scene's `prepare` steps run before its title and aren't recorded, so the title opens onto the scene's first screen; a scene with a title and no steps is a closing card; `keepData` copies the app's data folder somewhere when the scene ends, such as a job drafted on camera that is trained afterwards. A scene's `launch` accepts `settings`, `data`, `comparison`, `env` and `prepare` just like the e2e helper, `prepare` changing the throwaway copy of `data` before the app starts; `setup` can install stand-in IPC replies. Steps support `route`, `click`, `type`, `visible`, `text`, `wait`, `scroll`, `answerFileDialog`, `resize`, and `run`, a step the scene writes itself for what it can't name in advance, such as a model's reply. Step indices are zero-based. `speedups: [{ fromStep: 3, throughStep: 5, factor: 4 }]` compresses that inclusive range and shows a small `4×` mark. `title` adds a card before the scene, and `tailMs` holds its last app view. Set `width: 1920, height: 1200` to scale the output.

Captured JPEGs retain their actual capture times. ffmpeg's concat demuxer holds each frame for its measured duration, adjusted for speed-ups, before rendering 30 fps segments and cross-fading scenes. The final command uses `-an`; to add sound later, mux the finished MP4 with a licensed audio file using a separate ffmpeg pass (`-i video.mp4 -i audio.wav -c:v copy -c:a aac -shortest output.mp4`).

Do not put model keys in scripts or work files. An optional `launch.env` can pass non-secret settings; if a real-key demonstration is needed, use environment variables inherited by the process and `ARCHITECT_KEYS_FROM_ENV=1` only in a development build. The recorder never prints environment values.
