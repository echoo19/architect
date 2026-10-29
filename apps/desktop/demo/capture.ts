import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { expect, type Locator, type Page } from '@playwright/test';
import { goTo, launchApp } from '../e2e/app';
import { drawPointer, hideTitle, setSpeedMark, showTitle, type PointerState } from './overlay';
import type { DemoScene, DemoStep } from './script';
import type { SpeedInterval } from './timeline';

export interface CapturedFrame {
  file: string;
  timestampMs: number;
  kind: 'title' | 'app';
}

export interface CapturedScene {
  name: string;
  frames: CapturedFrame[];
  speedIntervals: SpeedInterval[];
}

const FRAME_MS = 1000 / 30;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Moves the drawn pointer to a target, clicks it and starts the click's ripple. */
async function clickWithPointer(page: Page, target: Locator, pointer: PointerState, what: string) {
  const box = await target.boundingBox();
  if (!box) throw new Error(`Click target is not visible: ${what}`);
  pointer.x = box.x + box.width / 2;
  pointer.y = box.y + box.height / 2;
  await page.mouse.move(pointer.x, pointer.y);
  await target.click();
  pointer.rippleAt = performance.now();
}

async function executeStep(
  step: DemoStep,
  page: Page,
  app: Awaited<ReturnType<typeof launchApp>>['app'],
  pointer: PointerState,
): Promise<void> {
  switch (step.kind) {
    case 'route':
      await goTo(page, step.path);
      break;
    case 'click':
      await clickWithPointer(
        page,
        page.getByRole(step.role, { name: step.name, exact: true }),
        pointer,
        `${step.role} ${step.name}`,
      );
      break;
    case 'run':
      await step.run({
        page,
        app,
        click: (target) => clickWithPointer(page, target, pointer, step.label),
      });
      break;
    case 'type':
      await page
        .getByRole(step.role, { name: step.name, exact: true })
        .pressSequentially(step.text, {
          delay: step.delayMs ?? 80,
        });
      break;
    case 'visible':
      await expect(page.getByRole(step.role, { name: step.name, exact: true })).toBeVisible();
      break;
    case 'text':
      await expect(page.getByText(step.text, { exact: false }).first()).toBeVisible();
      break;
    case 'wait':
      await sleep(step.ms);
      break;
    case 'scroll':
      pointer.x = step.x ?? (await page.evaluate(() => window.innerWidth / 2));
      pointer.y = await page.evaluate(() => window.innerHeight / 2);
      await page.mouse.move(pointer.x, pointer.y);
      await page.mouse.wheel(0, step.y);
      await sleep(250);
      break;
    case 'answerFileDialog':
      await app.evaluate(({ dialog }, picked) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: picked });
      }, step.files);
      break;
    case 'resize': {
      const visible = await app.evaluate(({ BrowserWindow }, size) => {
        const [window] = BrowserWindow.getAllWindows();
        if (!window) throw new Error('Architect window is missing');
        window.setContentSize(size.width, size.height);
        return window.isVisible();
      }, step);
      if (visible) throw new Error('Demo window became visible');
      await page.waitForFunction(
        ({ width, height }) => window.innerWidth === width && window.innerHeight === height,
        step,
      );
      break;
    }
  }
}

/**
 * Readies a launched scene: checks the window stays hidden, sizes it, installs stand-ins, waits
 * for the fonts and runs the scene's unrecorded prepare steps.
 */
async function openScene(
  scene: DemoScene,
  launched: Awaited<ReturnType<typeof launchApp>>,
  pointer: PointerState,
): Promise<void> {
  const { app, page } = launched;
  const visible = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.isVisible()),
  );
  if (visible) throw new Error('Architect window is visible');
  await app.evaluate(({ BrowserWindow }) => {
    const [window] = BrowserWindow.getAllWindows();
    window?.setContentSize(1440, 900);
  });
  await scene.setup?.(launched);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  for (const step of scene.prepare ?? []) await executeStep(step, page, app, pointer);
}

/**
 * A fresh window's first screenshots, and the first after the title card is drawn, take a second
 * or more. Screenshots that aren't kept are taken until one comes quickly, so the recorded frames
 * keep their pace.
 */
async function warmUp(page: Page, title: DemoScene['title']): Promise<void> {
  if (title) await showTitle(page, title, 0, 1);
  const until = performance.now() + 8000;
  while (performance.now() < until) {
    const start = performance.now();
    await page.screenshot({ type: 'jpeg', quality: 10, timeout: 15000 });
    if (performance.now() - start < 120) return;
  }
}

/**
 * Records the title card for its seconds. The words fade in on a dark card; at the end the whole
 * card fades onto the screen, unless the card closes the film.
 */
async function recordTitle(
  page: Page,
  title: NonNullable<DemoScene['title']>,
  closing: boolean,
  capture: () => Promise<void>,
): Promise<void> {
  const start = performance.now();
  const durationMs = title.seconds * 1000;
  let frameIndex = 0;
  while (performance.now() - start < durationMs) {
    const progress = (performance.now() - start) / durationMs;
    await showTitle(
      page,
      title,
      Math.max(0, Math.min(1, progress / 0.17)),
      closing ? 1 : Math.max(0, Math.min(1, (1 - progress) / 0.17)),
    );
    await capture();
    frameIndex++;
    await sleep(Math.max(0, start + frameIndex * FRAME_MS - performance.now()));
  }
}

export async function captureScene(scene: DemoScene, sceneDir: string): Promise<CapturedScene> {
  // A folder that already holds data would mix an earlier take into this one.
  if (scene.keepData && existsSync(scene.keepData)) {
    throw new Error(`${scene.keepData} exists already; the scene keeps its data in a new folder.`);
  }
  const framesDir = join(sceneDir, 'frames');
  await mkdir(framesDir, { recursive: true });
  process.stdout.write('Launching hidden Electron window\n');
  const launched = await launchApp(scene.launch);
  process.stdout.write('Hidden Electron window ready\n');
  const { app, page } = launched;
  const epoch = performance.now();
  const frames: CapturedFrame[] = [];
  const speedIntervals: SpeedInterval[] = [];
  const pointer: PointerState = { x: 140, y: 130 };
  let count = 0;
  const capture = async (kind: CapturedFrame['kind']) => {
    const now = performance.now();
    if (kind === 'app') await drawPointer(page, pointer, now);
    const file = `${String(count++).padStart(6, '0')}.jpg`;
    await page.screenshot({
      path: join(framesDir, file),
      type: 'jpeg',
      quality: 90,
      timeout: 15000,
    });
    frames.push({ file: `frames/${file}`, timestampMs: now - epoch, kind });
  };
  try {
    await openScene(scene, launched, pointer);
    await warmUp(page, scene.title);
    // A scene of a title alone is a closing card: it stays on the card to the end.
    const closing = scene.steps.length === 0;
    if (scene.title) {
      await recordTitle(page, scene.title, closing, () => capture('title'));
      if (!closing) await hideTitle(page);
    }
    if (closing) {
      const result = { name: scene.name, frames, speedIntervals };
      await writeFile(join(sceneDir, 'frames.json'), JSON.stringify(result, null, 2));
      return result;
    }

    let stopped = false;
    const captureLoop = (async () => {
      const start = performance.now();
      let frameIndex = 0;
      do {
        await capture('app');
        frameIndex++;
        await sleep(Math.max(0, start + frameIndex * FRAME_MS - performance.now()));
      } while (!stopped);
    })();
    try {
      for (const [index, step] of scene.steps.entries()) {
        const starting = scene.speedups?.find((speed) => speed.fromStep === index);
        if (starting) {
          speedIntervals.push({
            startMs: performance.now() - epoch,
            endMs: Infinity,
            factor: starting.factor,
          });
          await setSpeedMark(page, starting.factor);
        }
        await executeStep(step, page, app, pointer);
        const ending = scene.speedups?.find((speed) => speed.throughStep === index);
        if (ending) {
          const interval = speedIntervals.find(
            (candidate) => candidate.factor === ending.factor && candidate.endMs === Infinity,
          );
          if (!interval) throw new Error(`Speed interval ending at step ${index} was not started`);
          interval.endMs = performance.now() - epoch;
          await setSpeedMark(page);
        }
      }
      await sleep(scene.tailMs ?? 350);
    } finally {
      stopped = true;
      await captureLoop;
    }
    const result = { name: scene.name, frames, speedIntervals };
    await writeFile(join(sceneDir, 'frames.json'), JSON.stringify(result, null, 2));
    return result;
  } finally {
    await launched.close(scene.keepData);
  }
}

/**
 * Records a scene's title card again, on the scene's first screen, and puts it in place of the
 * title in the scene's earlier capture, so a take that can't be made again keeps its own steps.
 */
export async function recaptureTitle(scene: DemoScene, sceneDir: string): Promise<CapturedScene> {
  if (!scene.title) throw new Error(`${scene.name} has no title to record again`);
  const earlier = JSON.parse(
    await readFile(join(sceneDir, 'frames.json'), 'utf8'),
  ) as CapturedScene;
  const launched = await launchApp(scene.launch);
  const { page } = launched;
  const frames: CapturedFrame[] = [];
  let count = 0;
  try {
    await openScene(scene, launched, { x: 140, y: 130 });
    await warmUp(page, scene.title);
    const epoch = performance.now();
    await recordTitle(page, scene.title, scene.steps.length === 0, async () => {
      const now = performance.now();
      const file = `title-${String(count++).padStart(6, '0')}.jpg`;
      await page.screenshot({
        path: join(sceneDir, 'frames', file),
        type: 'jpeg',
        quality: 90,
        timeout: 15000,
      });
      frames.push({ file: `frames/${file}`, timestampMs: now - epoch, kind: 'title' });
    });
  } finally {
    await launched.close();
  }
  const kept = earlier.frames.filter((frame) => frame.kind === 'app');
  const last = frames.at(-1);
  if (!last) throw new Error(`No title frames were recorded for ${scene.name}`);
  // The new title ends where the scene's first recorded screen begins.
  const shift =
    (kept[0]?.timestampMs ?? last.timestampMs + FRAME_MS) - (last.timestampMs + FRAME_MS);
  const result: CapturedScene = {
    ...earlier,
    frames: [
      ...frames.map((frame) => ({ ...frame, timestampMs: frame.timestampMs + shift })),
      ...kept,
    ],
  };
  await writeFile(join(sceneDir, 'frames.json'), JSON.stringify(result, null, 2));
  return result;
}
